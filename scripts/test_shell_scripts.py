"""Smoke tests for the shell scripts under scripts/.

Each script runs for real, through bash, with the commands it reaches outside the
repository (aws, docker, ps, sleep) replaced by stubs placed first on PATH. A stub
records every call it receives and answers from fixtures the test writes, so no test
touches AWS, the network, a container or a database, and each one can assert what the
script would have run.

Not covered: local-env.sh `status` and `stop`. `status` only reports, and `stop` signals
processes with the shell's own `kill`, which a stub on PATH cannot intercept.

Run with: make test-scripts
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent

# Every stub appends one line per call: its name, then each argument, separated by the
# unit separator so arguments that contain spaces stay whole.
_SEP = "\x1f"
_LOG_CALL = 'printf "%s' + _SEP + '" "$(basename "$0")" "$@" >> "$STUB_LOG"; echo >> "$STUB_LOG"\n'


def _stub(bin_dir, name, body=""):
    path = bin_dir / name
    path.write_text("#!/usr/bin/env bash\n" + _LOG_CALL + body)
    path.chmod(0o755)


def _calls(log):
    if not log.exists():
        return []
    return [line.rstrip(_SEP).split(_SEP) for line in log.read_text().splitlines() if line]


# Every variable the scripts read from the caller's shell. A test sets the ones it
# means; the rest are cleared so a developer's exported AWS_REGION, or a NAME_PREFIX
# Make passes down, cannot change what a test sees.
_SCRIPT_ENV = (
    "DATABASE_URL", "DEV_DB_NAME", "ENV", "NAME_PREFIX",
    "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
)

# The commands that reach outside the repository. Each is stubbed to refuse by
# default; a test that means a script to call one installs its own stub.
_DENY = 'echo "unexpected call: $(basename "$0") $*" >&2; echo "$(basename "$0") $*" >> "$STUB_DIR/denied"; exit 97\n'


@pytest.fixture
def sandbox(tmp_path):
    """A stub directory on PATH, a call log, and a runner for a script under scripts/.

    aws, docker and ps refuse any call a test did not stub, and the test fails if one
    was refused, so no test reaches the real command by accident."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    _stub(bin_dir, "sleep")
    for name in ("aws", "docker", "ps"):
        _stub(bin_dir, name, _DENY)

    def run(script, *args, cwd=tmp_path, env=None):
        full_env = {k: v for k, v in os.environ.items() if k not in _SCRIPT_ENV}
        full_env.update(PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}", STUB_LOG=str(log), STUB_DIR=str(tmp_path))
        full_env.update(env or {})
        return subprocess.run(
            ["bash", str(SCRIPTS / script), *args],
            cwd=cwd, env=full_env, capture_output=True, text=True,
        )

    run.bin = bin_dir
    run.log = log
    run.dir = tmp_path
    yield run
    denied = tmp_path / "denied"
    assert not denied.exists(), f"a script made a call no test stubbed: {denied.read_text()}"


# --- dr-restore-test.sh ------------------------------------------------------

_AWS = r"""
case "$*" in
  *create-db-snapshot*) [ -n "${FAIL_SNAPSHOT:-}" ] && exit 254; echo creating ;;
  *DBInstanceClass*) echo db.t4g.micro ;;
  *VpcSecurityGroupId*) echo sg-0123 ;;
  *DBSubnetGroupName*) echo subnets-a ;;
  *DBParameterGroupName*) echo params-a ;;
  *describe-db-snapshots*) echo "${SNAPSHOTS:-}" ;;
esac
"""

# Every AWS call the script may make: rds, and these verbs. Anything else (another
# service, a reboot, a stop) fails the test rather than slipping past a list of
# verbs to watch for.
_RDS_VERBS = {
    "create-db-snapshot", "wait", "describe-db-instances", "describe-db-snapshots",
    "restore-db-instance-from-db-snapshot", "modify-db-instance",
    "delete-db-instance", "delete-db-snapshot",
}
# The only calls that may name the live instance: it is snapshotted and read, never changed.
_MAY_NAME_LIVE = {"create-db-snapshot", "describe-db-instances"}


def _rds_calls(run):
    return [c[2:] for c in _calls(run.log) if c[:2] == ["aws", "rds"]]


def _assert_only_allowed_calls(run, live):
    for call in [c for c in _calls(run.log) if c[0] == "aws"]:
        assert call[1] == "rds", f"unexpected AWS service: {call[1:]}"
        assert call[2] in _RDS_VERBS, f"unexpected rds call: {call[2:]}"
        if live in call[3:]:
            assert call[2] in _MAY_NAME_LIVE, f"{call[2]} names the live instance {live}"


def _arg(call, flag):
    return call[call.index(flag) + 1]


def _dr(run, action, **env):
    _stub(run.bin, "aws", _AWS)
    return run("dr-restore-test.sh", action, env={"ENV": "dev", **env})


def test_dr_restore_snapshots_the_live_instance_and_restores_a_copy(sandbox):
    result = _dr(sandbox, "restore")
    assert result.returncode == 0, result.stderr
    calls = _rds_calls(sandbox)

    snapshot = next(c for c in calls if c[0] == "create-db-snapshot")
    assert _arg(snapshot, "--db-instance-identifier") == "ztdr-dev"
    snap_id = _arg(snapshot, "--db-snapshot-identifier")
    assert re.fullmatch(r"ztdr-dev-drtest-\d{8}-\d{4}", snap_id)

    restore = next(c for c in calls if c[0] == "restore-db-instance-from-db-snapshot")
    assert _arg(restore, "--db-instance-identifier") == "ztdr-dev-restore-test"
    assert _arg(restore, "--db-snapshot-identifier") == snap_id
    assert _arg(restore, "--db-instance-class") == "db.t4g.micro"
    assert _arg(restore, "--vpc-security-group-ids") == "sg-0123"
    assert _arg(restore, "--db-subnet-group-name") == "subnets-a"
    assert _arg(restore, "--db-parameter-group-name") == "params-a"
    assert "--no-publicly-accessible" in restore and "--no-multi-az" in restore

    modify = next(c for c in calls if c[0] == "modify-db-instance")
    assert _arg(modify, "--db-instance-identifier") == "ztdr-dev-restore-test"
    assert "--manage-master-user-password" in modify
    assert all(_arg(c, "--region") == "us-east-1" for c in calls)


def test_dr_restore_changes_nothing_but_the_throwaway_instance(sandbox):
    """The live database is only ever snapshotted and read: every call is an allowed rds
    verb, only a snapshot or a describe names the live instance, and the four reads of
    its configuration do."""
    _dr(sandbox, "restore")
    _assert_only_allowed_calls(sandbox, "ztdr-dev")
    reads = [
        c for c in _rds_calls(sandbox)
        if c[0] == "describe-db-instances" and _arg(c, "--db-instance-identifier") == "ztdr-dev"
    ]
    assert len(reads) == 4


def test_dr_restore_stops_when_a_call_fails(sandbox):
    result = _dr(sandbox, "restore", FAIL_SNAPSHOT="1")
    assert result.returncode != 0
    calls = _rds_calls(sandbox)
    assert [c[0] for c in calls] == ["create-db-snapshot"], "the run must reach the failing call and stop there"


def test_dr_teardown_deletes_the_copy_and_only_its_drtest_snapshots(sandbox):
    snaps = "ztdr-dev-drtest-20261001-0900\tztdr-dev-drtest-20261002-0900"
    result = _dr(sandbox, "teardown", SNAPSHOTS=snaps)
    assert result.returncode == 0, result.stderr
    calls = _rds_calls(sandbox)

    deleted = [_arg(c, "--db-instance-identifier") for c in calls if c[0] == "delete-db-instance"]
    assert deleted == ["ztdr-dev-restore-test"]
    listing = next(c for c in calls if c[0] == "describe-db-snapshots")
    assert "starts_with(DBSnapshotIdentifier,'ztdr-dev-drtest-')" in _arg(listing, "--query")
    removed = [_arg(c, "--db-snapshot-identifier") for c in calls if c[0] == "delete-db-snapshot"]
    assert removed == snaps.split("\t")
    _assert_only_allowed_calls(sandbox, "ztdr-dev")


def test_dr_name_prefix_and_env_name_every_instance(sandbox):
    result = _dr(sandbox, "restore", ENV="prod", NAME_PREFIX="abc")
    assert result.returncode == 0, result.stderr
    calls = _rds_calls(sandbox)
    snapshot = next(c for c in calls if c[0] == "create-db-snapshot")
    assert _arg(snapshot, "--db-instance-identifier") == "abc-prod"
    _assert_only_allowed_calls(sandbox, "abc-prod")
    modify = next(c for c in calls if c[0] == "modify-db-instance")
    assert _arg(modify, "--db-instance-identifier") == "abc-prod-restore-test"


def test_dr_unknown_action_prints_usage_and_calls_nothing(sandbox):
    result = _dr(sandbox, "rollback")
    assert result.returncode == 2
    assert "usage:" in result.stderr
    assert _rds_calls(sandbox) == []


# --- refresh-image-digests.sh -------------------------------------------------

_OLD = "sha256:" + "a" * 64
_NEW = "sha256:" + "b" * 64
_DB = "sha256:" + "c" * 64

# Answers `docker buildx imagetools inspect <ref>` from a "ref digest" file, the way
# the registry would: the digest JSON-quoted, or nothing for a tag it cannot resolve.
_DOCKER_DIGESTS = r"""
if [ "$1 $2 $3" = "buildx imagetools inspect" ]; then
  d=$(awk -v r="$4" '$1 == r { print $2 }' "$STUB_DIR/digests")
  [ -n "$d" ] && echo "\"$d\""
fi
"""


def _dockerfile(run, text, digests):
    (run.dir / "digests").write_text("".join(f"{ref} {d}\n" for ref, d in digests.items()))
    _stub(run.bin, "docker", _DOCKER_DIGESTS)
    path = run.dir / "Dockerfile"
    path.write_text(text)
    return path


_PINNED = (
    f"FROM dhi.io/node:24-alpine@{_OLD} AS builder\n"
    "RUN yarn build\n"
    f"FROM dhi.io/node:24-alpine@{_OLD} AS runner\n"
    f"FROM dhi.io/postgres:16@{_DB} AS db\n"
)


def test_refresh_rewrites_only_the_pin_whose_tag_moved(sandbox):
    path = _dockerfile(sandbox, _PINNED, {"dhi.io/node:24-alpine": _NEW, "dhi.io/postgres:16": _DB})
    result = sandbox("refresh-image-digests.sh", str(path))
    assert result.returncode == 0, result.stderr
    assert path.read_text() == _PINNED.replace(_OLD, _NEW)
    assert "Digests updated" in result.stdout


def test_refresh_leaves_a_current_file_byte_identical(sandbox):
    path = _dockerfile(sandbox, _PINNED, {"dhi.io/node:24-alpine": _OLD, "dhi.io/postgres:16": _DB})
    result = sandbox("refresh-image-digests.sh", str(path))
    assert result.returncode == 0, result.stderr
    assert path.read_text() == _PINNED
    assert "are current" in result.stdout


def test_refresh_rewrites_earlier_images_before_failing_on_an_unresolvable_one(sandbox):
    """Each image is rewritten as it resolves, in sorted order, so an image that cannot be
    resolved stops the run after the ones before it are already rewritten."""
    path = _dockerfile(sandbox, _PINNED, {"dhi.io/node:24-alpine": _NEW})
    result = sandbox("refresh-image-digests.sh", str(path))
    assert result.returncode == 1
    assert "Could not resolve dhi.io/postgres:16" in result.stderr
    assert path.read_text() == _PINNED.replace(_OLD, _NEW)


@pytest.mark.parametrize(
    "text, digests, message",
    [
        ("FROM node:24-alpine AS builder\n", {}, "No dhi.io FROM lines"),
        (_PINNED, {"dhi.io/node:24-alpine": _OLD}, "Could not resolve dhi.io/postgres:16"),
        ("FROM dhi.io/node:24-alpine AS builder\n", {"dhi.io/node:24-alpine": _NEW}, "pin it by hand once"),
    ],
    ids=["no-dhi-images", "unresolvable-tag", "unpinned-image"],
)
def test_refresh_fails_without_changing_the_file(sandbox, text, digests, message):
    path = _dockerfile(sandbox, text, digests)
    result = sandbox("refresh-image-digests.sh", str(path))
    assert result.returncode == 1
    assert message in result.stderr
    assert path.read_text() == text


# --- check-environment.sh -----------------------------------------------------

_DOCKER_COMPOSE_PS = r"""
case "$*" in
  "compose ps --format json") printf '%s' "${COMPOSE_PS:-}" ;;
esac
"""

_RUNNER = '{"Name":"zt-decoder-ring-app","State":"running"}\n'
_DEBUG = '{"Name":"zt-decoder-ring-app-debug","State":"running"}\n'
_DEV = "me  4242  0.0  0.1 node /repo/app/node_modules/.bin/next dev --port 3000\n"


@pytest.mark.parametrize(
    "ps, compose, expected",
    [
        ("", "", "NO ENVIRONMENT RUNNING"),
        (_DEV, "", "LOCAL DEVELOPMENT"),
        ("", _DEBUG, "DEBUG CONTAINER"),
        ("", _RUNNER, "CONTAINERIZED"),
        (_DEV, _RUNNER + _DEBUG, "LOCAL DEVELOPMENT"),
        ("", _RUNNER + _DEBUG, "DEBUG CONTAINER"),
    ],
    ids=["nothing", "dev-server", "debug-container", "runner-container",
         "dev-wins-over-containers", "debug-wins-over-runner"],
)
def test_check_environment_reports_what_is_running(sandbox, ps, compose, expected):
    _stub(sandbox.bin, "ps", 'printf "%s" "${PS_OUT:-}"\n')
    _stub(sandbox.bin, "docker", _DOCKER_COMPOSE_PS)
    result = sandbox("check-environment.sh", env={"PS_OUT": ps, "COMPOSE_PS": compose})
    assert result.returncode == 0, result.stderr
    headline = [line for line in result.stdout.splitlines() if expected in line]
    assert headline, result.stdout
    others = {"NO ENVIRONMENT RUNNING", "LOCAL DEVELOPMENT", "DEBUG CONTAINER", "CONTAINERIZED"} - {expected}
    assert not any(o in result.stdout for o in others), result.stdout


# --- local-env.sh -------------------------------------------------------------

# A container's state lives in $STUB_DIR as files named for it: exists-<name>,
# running-<name> and owner-<name> (the Compose working directory it was started from).
_DOCKER_LOCAL_ENV = r"""
name="${@: -1}"
case "$*" in
  *State.Running*) [ -f "$STUB_DIR/running-$name" ] && echo true || echo false ;;
  *working_dir*) cat "$STUB_DIR/owner-$name" 2>/dev/null ;;
  *Mounts*) echo zt-decoder-ring-dev-postgres ;;
  *Config.Image*) echo postgres:16 ;;
  *"config --images"*) echo postgres:16 ;;
  *pg_isready*) exit 0 ;;
  *"FROM pg_database WHERE datname"*) [ -f "$STUB_DIR/no-database" ] || echo 1 ;;
  "volume inspect zt-decoder-ring-dev-postgres") [ -f "$STUB_DIR/volume" ] || exit 1 ;;
  "inspect zt-decoder-ring-db") [ -f "$STUB_DIR/exists-$name" ] || exit 1 ;;
esac
"""


@pytest.fixture
def worktree(sandbox):
    """A git work tree to run local-env.sh in, since it finds its root with git."""
    root = sandbox.dir / "worktree"
    (root / "app").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    _stub(sandbox.bin, "docker", _DOCKER_LOCAL_ENV)
    return root.resolve()


def _container(run, name, owner, running=True):
    (run.dir / f"exists-{name}").touch()
    (run.dir / f"owner-{name}").write_text(str(owner))
    if running:
        (run.dir / f"running-{name}").touch()


def _local_env(run, root, *args, **env):
    return run("local-env.sh", *args, cwd=root, env={"DEV_DB_NAME": "zt_checkout_a", **env})


def _docker_calls(run):
    return [c[1:] for c in _calls(run.log) if c[0] == "docker"]


@pytest.mark.parametrize(
    "url, refused",
    [
        ("postgresql://u:p@localhost:5439/zt_checkout_a", False),
        ("postgresql://u:p@localhost:5439/zt_checkout_a?sslmode=disable", False),
        ("postgresql://u:p@localhost:5439/zt_checkout_b", True),
        ("postgresql://u:p@127.0.0.1:5439/zt_checkout_b?sslmode=disable", True),
        ("postgresql://u:p@localhost:5432/zt_checkout_b", False),
        ("postgresql://u:p@db.example.com:5439/zt_checkout_b", False),
    ],
    ids=["own-database", "own-database-with-options", "other-checkout", "other-checkout-by-ip",
         "other-port", "other-host"],
)
def test_guard_refuses_only_another_checkouts_database_on_the_shared_container(sandbox, worktree, url, refused):
    result = _local_env(sandbox, worktree, "guard", DATABASE_URL=url)
    assert result.returncode == (1 if refused else 0), result.stderr
    if refused:
        assert "Nothing was run" in result.stderr


@pytest.mark.parametrize(
    "line",
    [
        "DATABASE_URL=postgresql://u:p@localhost:5439/zt_checkout_b",
        "export DATABASE_URL=postgresql://u:p@localhost:5439/zt_checkout_b",
        "DATABASE_URL = postgresql://u:p@localhost:5439/zt_checkout_b",
        'DATABASE_URL="postgresql://u:p@localhost:5439/zt_checkout_b"',
        "DATABASE_URL='postgresql://u:p@localhost:5439/zt_checkout_b'",
        "DATABASE_URL=postgresql://u:p@localhost:5439/zt_checkout_b # another checkout",
        "DATABASE_URL=postgresql://u:p@localhost:5439/zt_checkout_b\r",
    ],
    ids=["plain", "export", "spaced", "double-quoted", "single-quoted", "comment", "crlf"],
)
def test_guard_reads_app_env_the_way_dotenv_does(sandbox, worktree, line):
    """Each form names another checkout's database, so each must be refused."""
    (worktree / "app" / ".env").write_text(f"NODE_ENV=development\n{line}\n")
    result = _local_env(sandbox, worktree, "guard")
    assert result.returncode == 1, result.stderr
    assert "names database 'zt_checkout_b'" in result.stderr


def test_guard_takes_the_last_assignment_and_prefers_the_environment(sandbox, worktree):
    (worktree / "app" / ".env").write_text(
        "DATABASE_URL=postgresql://u:p@localhost:5439/zt_checkout_a\n"
        "DATABASE_URL=postgresql://u:p@localhost:5439/zt_checkout_b\n"
    )
    assert _local_env(sandbox, worktree, "guard").returncode == 1
    own = "postgresql://u:p@localhost:5439/zt_checkout_a"
    assert _local_env(sandbox, worktree, "guard", DATABASE_URL=own).returncode == 0


def test_guard_with_no_database_url_has_nothing_to_check(sandbox, worktree):
    result = _local_env(sandbox, worktree, "guard")
    assert result.returncode == 0
    assert "nothing to check" in result.stderr


@pytest.mark.parametrize("name", ["", "Zt-Checkout-A", "zt; drop database x"])
def test_a_database_name_that_is_not_a_plain_identifier_is_refused(sandbox, worktree, name):
    result = _local_env(sandbox, worktree, "guard", DEV_DB_NAME=name)
    assert result.returncode == 1
    assert "plain lower-case identifier" in result.stderr


def test_reset_drops_and_recreates_only_this_checkouts_database(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", worktree)
    result = _local_env(sandbox, worktree, "reset")
    assert result.returncode == 0, result.stderr
    execs = [c for c in _docker_calls(sandbox) if c[0] == "exec" and c[2] in ("dropdb", "createdb")]
    assert execs == [
        ["exec", "zt-decoder-ring-db", "dropdb", "-U", "ztdecoder", "--if-exists", "--force", "zt_checkout_a"],
        ["exec", "zt-decoder-ring-db", "createdb", "-U", "ztdecoder", "zt_checkout_a"],
    ]
    assert not [c for c in _docker_calls(sandbox) if c[0] in ("rm", "stop") or c[:2] == ["volume", "rm"]]


def test_adopt_refuses_while_another_worktrees_app_uses_the_database(sandbox, worktree):
    elsewhere = sandbox.dir / "other-worktree"
    _container(sandbox, "zt-decoder-ring-db", elsewhere)
    _container(sandbox, "zt-decoder-ring-app", elsewhere)
    result = _local_env(sandbox, worktree, "adopt")
    assert result.returncode == 1
    assert "Nothing was changed" in result.stderr
    assert not [c for c in _docker_calls(sandbox) if c[0] in ("rm", "stop")]


def test_adopt_recreates_a_container_no_other_app_is_using(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", sandbox.dir / "other-worktree")
    result = _local_env(sandbox, worktree, "adopt")
    assert result.returncode == 0, result.stderr
    assert [c[0] for c in _docker_calls(sandbox) if c[0] in ("rm", "stop")] == ["stop", "rm"]


def test_adopt_leaves_this_worktrees_own_container_alone(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", worktree)
    result = _local_env(sandbox, worktree, "adopt")
    assert result.returncode == 0, result.stderr
    assert not [c for c in _docker_calls(sandbox) if c[0] in ("rm", "stop")]


def _changes(run):
    """The docker calls that start, stop, create or remove something."""
    verbs = {"start", "stop", "rm", "createdb", "dropdb"}
    return [
        c for c in _docker_calls(run)
        if c[0] in verbs
        or c[:2] == ["volume", "rm"]
        or (c[0] == "compose" and "up" in c)
        or (c[0] == "exec" and c[2] in verbs)
    ]


def test_up_creates_the_container_when_there_is_none(sandbox, worktree):
    result = _local_env(sandbox, worktree, "up")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == [["compose", "--profile", "db-only", "up", "-d"]]


def test_up_starts_a_stopped_container(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", worktree, running=False)
    result = _local_env(sandbox, worktree, "up")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == [["start", "zt-decoder-ring-db"]]


def test_up_reuses_a_running_container_another_worktree_started(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", sandbox.dir / "other-worktree")
    result = _local_env(sandbox, worktree, "up")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == []
    assert "Using the running zt-decoder-ring-db" in result.stdout


def test_ensure_creates_this_checkouts_database_when_it_is_missing(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", worktree)
    (sandbox.dir / "no-database").touch()
    result = _local_env(sandbox, worktree, "ensure")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == [["exec", "zt-decoder-ring-db", "createdb", "-U", "ztdecoder", "zt_checkout_a"]]


def test_down_removes_the_container_and_keeps_the_volume(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", worktree)
    (sandbox.dir / "volume").touch()
    result = _local_env(sandbox, worktree, "down")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == [["stop", "zt-decoder-ring-db"], ["rm", "zt-decoder-ring-db"]]
    assert "data in volume zt-decoder-ring-dev-postgres is kept" in result.stdout


def test_wipe_removes_the_container_and_the_shared_volume(sandbox, worktree):
    _container(sandbox, "zt-decoder-ring-db", worktree)
    (sandbox.dir / "volume").touch()
    result = _local_env(sandbox, worktree, "wipe")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == [
        ["stop", "zt-decoder-ring-db"],
        ["rm", "zt-decoder-ring-db"],
        ["volume", "rm", "zt-decoder-ring-dev-postgres"],
    ]


def test_wipe_with_nothing_there_removes_nothing(sandbox, worktree):
    result = _local_env(sandbox, worktree, "wipe")
    assert result.returncode == 0, result.stderr
    assert _changes(sandbox) == []
    assert "does not exist" in result.stdout


@pytest.mark.parametrize("args", [[], ["restart"]], ids=["no-command", "unknown-command"])
def test_local_env_without_a_known_command_prints_usage(sandbox, worktree, args):
    result = _local_env(sandbox, worktree, *args)
    assert result.returncode == 1
    assert "usage:" in result.stderr
    assert _docker_calls(sandbox) == []
