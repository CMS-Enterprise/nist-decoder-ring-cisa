"""Smoke tests for the shell scripts under scripts/.

Each script runs for real, through bash, with the commands it reaches outside the
repository (aws, docker, ps, sleep, terraform, trivy) replaced by stubs placed first on PATH. A stub
records every call it receives and answers from fixtures the test writes, so no test
touches AWS, the network, a container or a database, and each one can assert what the
script would have run.

Not covered: local-env.sh `stop`, which signals processes with the shell's own `kill`,
which a stub on PATH cannot intercept, and of `status` only the listeners it lists.

Run with: make test-scripts
"""

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
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

    aws, docker, ps, terraform and trivy refuse any call a test did not stub, and the test
    fails if one was refused, so no test reaches the real command by accident."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    _stub(bin_dir, "sleep")
    for name in ("aws", "docker", "ps", "terraform", "trivy"):
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


# --- scan-base.sh ----------------------------------------------------------------
#
# trivy is stubbed: it records each scan, and exits 1 for the image named in FAIL_REF,
# as a finding the policy fails, or a failed pull, would.

_TRIVY = r"""
for a in "$@"; do
  [ -n "${FAIL_REF:-}" ] && [ "$a" = "$FAIL_REF" ] && exit 1
done
exit 0
"""

_DEV_BASE = f"dhi.io/node:24-alpine3.22-dev@{_OLD}"
_RUN_BASE = f"dhi.io/node:24-alpine3.22@{_NEW}"
_STAGES = (
    f"FROM --platform=$BUILDPLATFORM {_DEV_BASE} AS base\n"
    "RUN apk add --no-cache libc6-compat\n"
    "FROM base AS deps\n"
    "from base as builder\n"
    f"FROM {_RUN_BASE} AS runner\n"
)


def _scan_base(run, dockerfile, **env):
    (run.dir / "Dockerfile").write_text(dockerfile)
    (run.dir / "trivy.yaml").write_text("exit-code: 1\n")
    _stub(run.bin, "trivy", _TRIVY)
    result = run("scan-base.sh", "Dockerfile", env=env)
    return result, [c[1:] for c in _calls(run.log) if c[0] == "trivy"]


def test_scan_base_scans_every_pinned_base_against_the_policy(sandbox):
    result, scans = _scan_base(sandbox, _STAGES)
    assert result.returncode == 0, result.stderr
    # One scan per pinned base, in file order; the stages built on `base` add none.
    assert scans == [
        ["image", "--config", "trivy.yaml", "--platform", "linux/arm64", _DEV_BASE],
        ["image", "--config", "trivy.yaml", "--platform", "linux/arm64", _RUN_BASE],
    ], "every base takes its policy, exit code included, from trivy.yaml"
    assert "Every pinned base image passes" in result.stdout


@pytest.mark.parametrize("failing", [_RUN_BASE, _DEV_BASE], ids=["runner-base", "build-base"])
def test_scan_base_fails_on_any_base_after_scanning_every_one(sandbox, failing):
    """A build stage's base gates as the runner's does. Every base is scanned first."""
    result, scans = _scan_base(sandbox, _STAGES, FAIL_REF=failing)
    assert result.returncode == 1
    assert [s[-1] for s in scans] == [_DEV_BASE, _RUN_BASE]
    assert "failed the scan, or could not be scanned" in result.stderr


@pytest.mark.parametrize(
    "dockerfile, message",
    [
        ("FROM scratch AS runner\n", "pins a base image by digest"),
        (f"FROM node:24-alpine AS base\nFROM {_RUN_BASE} AS runner\n", "Dockerfile:1: node:24-alpine"),
        (f"FROM {_DEV_BASE} AS base\nFROM node:24-alpine AS runner\n", "Dockerfile:2: node:24-alpine"),
    ],
    ids=["nothing-pinned", "build-base-by-tag", "runner-base-by-tag"],
)
def test_scan_base_refuses_a_dockerfile_it_cannot_vouch_for(sandbox, dockerfile, message):
    result, scans = _scan_base(sandbox, dockerfile)
    assert result.returncode == 1
    assert message in result.stderr
    assert scans == []


def _make(run, *args, **env):
    full = {k: v for k, v in os.environ.items() if k not in _SCRIPT_ENV and k != "CI"}
    full.update(PATH=f"{run.bin}{os.pathsep}{os.environ['PATH']}", STUB_LOG=str(run.log), STUB_DIR=str(run.dir))
    full.update(env)
    return subprocess.run(["make", "-s", "-C", str(SCRIPTS.parent), *args], env=full, capture_output=True, text=True)


@pytest.mark.parametrize("ci", [{}, {"CI": "true"}], ids=["by-hand", "in-ci"])
def test_make_test_integration_runs_the_suite_without_a_scan(sandbox, ci):
    """make -n prints each recipe line it would run, through the sub-makes."""
    result = _make(sandbox, "-n", "test-integration", **ci)
    assert result.returncode == 0, result.stderr
    assert "scan-base.sh" not in result.stdout, result.stdout
    assert "trivy" not in result.stdout, result.stdout
    assert "yarn test:integration" in result.stdout


def test_make_pre_push_scans_the_bases_before_the_code_checks(sandbox):
    result = _make(sandbox, "-n", "pre-push")
    assert result.returncode == 0, result.stderr
    out = result.stdout
    steps = ["scan-base.sh Dockerfile", "yarn run check", "version-guard", "yarn test:coverage", "check-seed-sql.py", "prisma validate"]
    positions = [out.index(s) for s in steps]
    assert positions == sorted(positions), out


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


# --- a listener only ss sees ---------------------------------------------------
#
# On Ubuntu under WSL2, lsof has been seen to return nothing for the Next.js dev server's
# listener while ss lists it. lsof is stubbed to see nothing here, and ss to see
# next-server on :3000 and the database container's port, which is outside the bands.

_SS = r"""
next='LISTEN 0 511 *:3000 *:* users:(("next-server (v16.3.8)",pid=4242,fd=21))'
case "$*" in
  *"sport = :3000"*) echo "$next" ;;
  *sport*) ;;
  -ltnpH) echo "$next"; echo 'LISTEN 0 4096 0.0.0.0:5439 0.0.0.0:*'
          echo 'LISTEN 0 511 127.0.0.1:3003 0.0.0.0:* users:(("node",pid=11,fd=3),("node",pid=12,fd=3))' ;;
esac
"""


def _blind_lsof(run):
    _stub(run.bin, "lsof", "exit 1\n")
    _stub(run.bin, "ss", _SS)


def test_status_lists_a_dev_server_only_ss_sees(sandbox, worktree):
    _blind_lsof(sandbox)
    _stub(sandbox.bin, "ps", 'echo "next-server (v16.3.8)"\n')
    # No container publishes a port; the local-env docker stub has no answer for ps.
    _stub(sandbox.bin, "docker", '[ "$1" = ps ] && exit 0\n' + _DOCKER_LOCAL_ENV)
    result = _local_env(sandbox, worktree, "status")
    assert result.returncode == 0, result.stderr
    assert re.search(r":3000\s+pid 4242\s+next-server", result.stdout), result.stdout
    # Both processes holding one socket are listed, each by its own pid.
    assert re.search(r":3003\s+pid 11\s", result.stdout), result.stdout
    assert re.search(r":3003\s+pid 12\s", result.stdout), result.stdout
    assert ":5439" not in result.stdout, result.stdout


def test_status_lists_a_container_once_when_two_processes_hold_its_port(sandbox, worktree):
    # Where their sockets are visible, Docker publishes a port through two docker-proxy
    # processes, one for IPv4 and one for IPv6.
    _stub(sandbox.bin, "lsof", "exit 1\n")
    _stub(sandbox.bin, "ss", r"""
case "$*" in
  -ltnpH) echo 'LISTEN 0 4096 0.0.0.0:13000 0.0.0.0:* users:(("docker-proxy",pid=21,fd=4))'
          echo 'LISTEN 0 4096 [::]:13000 [::]:* users:(("docker-proxy",pid=22,fd=4))' ;;
esac
""")
    _stub(sandbox.bin, "docker", f"""
if [ "$1" = ps ]; then
  case "$*" in *Ports*) printf 'zt-decoder-ring-app\\t0.0.0.0:13000->3000/tcp, [::]:13000->3000/tcp\\t%s\\n' '{worktree}' ;; esac
  exit 0
fi
""" + _DOCKER_LOCAL_ENV)
    result = _local_env(sandbox, worktree, "status")
    assert result.returncode == 0, result.stderr
    lines = [l for l in result.stdout.splitlines() if l.strip().startswith(":13000")]
    assert len(lines) == 1, result.stdout
    assert "container zt-decoder-ring-app" in lines[0] and "this repository" in lines[0], result.stdout


@pytest.mark.parametrize(
    "port, holder",
    [("3000", "next-server (v16.3.8) (pid 4242)"), ("3001", None)],
    ids=["taken", "free"],
)
def test_check_port_asks_ss_when_lsof_sees_nothing(sandbox, port, holder):
    _blind_lsof(sandbox)
    env = {k: v for k, v in os.environ.items() if k not in _SCRIPT_ENV}
    env.update(PATH=f"{sandbox.bin}{os.pathsep}{os.environ['PATH']}", STUB_LOG=str(sandbox.log), STUB_DIR=str(sandbox.dir))
    result = subprocess.run(
        ["make", "-s", "-C", str(SCRIPTS.parent), "_check-port", f"PORT={port}", "PORT_VAR=DEV_PORT"],
        env=env, capture_output=True, text=True,
    )
    if holder:
        assert result.returncode != 0, result.stdout
        assert f"Port {port} is already in use by {holder}." in result.stdout, result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr


# --- .husky/pre-commit --------------------------------------------------------------------
#
# The hook runs for real, through git, in a throwaway repository and a worktree of it, with
# yarn and make stubbed to record the directory each was called from. A commit from a
# worktree is the case that once ran the link check from app/ and failed there.

HOOK = SCRIPTS.parent / ".husky" / "pre-commit"
# A path every line's hook treats as a seed link source.
_LINK_SOURCE = "app/prisma/generators/zt-overlay/emit.ts"


def _git(cwd, env, *args, check=True):
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=check)


@pytest.fixture
def hook_repo(tmp_path):
    """A repository with this branch's pre-commit as its hook, a worktree of it, and the
    environment and call log for both. HOME is the test's own, so no developer's git
    configuration (commit signing, say) reaches the commits."""
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    (hooks / "pre-commit").write_text(HOOK.read_text())
    (hooks / "pre-commit").chmod(0o755)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    for name in ("yarn", "make"):
        stub = bin_dir / name
        stub.write_text(f'#!/bin/sh\nprintf "%s|%s|%s\\n" {name} "$PWD" "$*" >> "{log}"\nexit "${{STUB_EXIT_{name.upper()}:-0}}"\n')
        stub.chmod(0o755)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(
        PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        HOME=str(tmp_path),
        GIT_CONFIG_NOSYSTEM="1",
        GIT_AUTHOR_NAME="Test",
        GIT_AUTHOR_EMAIL="test@example.com",
        GIT_COMMITTER_NAME="Test",
        GIT_COMMITTER_EMAIL="test@example.com",
    )
    repo = tmp_path / "repo"
    _git(tmp_path, env, "init", "-q", "-b", "main", str(repo))
    _git(repo, env, "config", "core.hooksPath", str(hooks))
    (repo / "app").mkdir()
    (repo / "app" / "README").write_text("app\n")
    _git(repo, env, "add", ".")
    _git(repo, env, "commit", "-q", "--no-verify", "-m", "init")
    worktree = tmp_path / "worktree"
    _git(repo, env, "worktree", "add", "-q", "-b", "side", str(worktree))
    return {"checkout": repo, "worktree": worktree, "env": env, "log": log}


def _commit(top, env, path, check=True):
    target = top / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("export {};\n")
    _git(top, env, "add", path)
    return _git(top, env, "commit", "-q", "-m", f"touch {path}", check=check)


def _hook_calls(log):
    return [tuple(line.split("|", 2)) for line in log.read_text().splitlines()] if log.exists() else []


@pytest.mark.parametrize("where", ["checkout", "worktree"])
def test_pre_commit_runs_the_link_check_from_the_top_of_the_tree(hook_repo, where):
    top = hook_repo[where]
    _commit(top, hook_repo["env"], _LINK_SOURCE)
    root = str(top.resolve())
    calls = _hook_calls(hook_repo["log"])
    assert ("yarn", root + "/app", "lint-staged") in calls
    assert ("yarn", root + "/app", "typecheck") in calls
    assert ("make", root, "ci-check-links") in calls


def test_pre_commit_skips_the_link_check_when_no_link_source_changed(hook_repo):
    top = hook_repo["worktree"]
    _commit(top, hook_repo["env"], "app/src/page.tsx")
    calls = _hook_calls(hook_repo["log"])
    assert ("yarn", str(top.resolve()) + "/app", "typecheck") in calls
    assert not [c for c in calls if c[0] == "make"]


def test_pre_commit_stops_the_commit_when_the_link_check_fails(hook_repo):
    top, env = hook_repo["worktree"], dict(hook_repo["env"], STUB_EXIT_MAKE="2")
    before = _git(top, env, "rev-parse", "HEAD").stdout
    result = _commit(top, env, _LINK_SOURCE, check=False)
    assert result.returncode != 0
    assert _git(top, env, "rev-parse", "HEAD").stdout == before


# --- db-recover.sh -------------------------------------------------------------

# The recovery script against a stubbed AWS and Terraform that behave like the real ones
# in order: the target does not exist until the restore call creates it, has no managed
# secret until the modify call asks for one, and the app reads the live host until the
# apply. Each of those is a file in $STUB_DIR. FAIL_ON="<service> <verb>" makes that call
# fail; the other variables below change one answer. LIVE_ID is the live instance, ztdr-dev
# unless a test sets another NAME_PREFIX.
_RECOVER_LIVE = "ztdr-dev"
_RECOVER_TARGET = "ztdr-dev-recovered-test"
_RECOVER_TARGET_HOST = "ztdr-dev-recovered-test.example.us-east-1.rds.amazonaws.com"
_RECOVER_LIVE_HOST = "ztdr-dev.example.us-east-1.rds.amazonaws.com"
_RECOVER_LIVE_SECRET = "arn:aws:secretsmanager:us-east-1:123:secret:rds!db-live"
_RECOVER_NEW_SECRET = "arn:aws:secretsmanager:us-east-1:123:secret:rds!db-new"

_RECOVER_AWS = r"""
arg() { want=$1; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
if [ "$1 $2" = "${FAIL_ON:-}" ]; then echo "An error occurred (InternalFailure) when calling $2" >&2; exit 254; fi
id=$(arg --db-instance-identifier "$@")
q=$(arg --query "$@")
case "$1 $2" in
  "rds describe-db-instances")
    if [ -z "$id" ]; then cat "$STUB_DIR/instances.json"; exit 0; fi
    if [ "$id" = "${LIVE_ID:-ztdr-dev}" ]; then
      if [ -n "${LIVE_GONE:-}" ]; then
        echo "An error occurred (DBInstanceNotFound) when calling the DescribeDBInstances operation: DBInstance $id not found." >&2
        exit 254
      fi
      cat "$STUB_DIR/live.json"; exit 0
    fi
    if [ ! -f "$STUB_DIR/target-exists" ]; then
      echo "An error occurred (DBInstanceNotFound) when calling the DescribeDBInstances operation: DBInstance $id not found." >&2
      exit 254
    fi
    case "$q" in
      *TagList*) cat "$STUB_DIR/target-tags.json" ;;
      *DBInstanceStatus*)
        if [ -n "${SECRET_STATUS:-}" ]; then printf '%s\t%s\n' "${TARGET_STATUS:-available}" "$SECRET_STATUS"
        elif [ -f "$STUB_DIR/secret-made" ]; then printf '%s\tactive\n' "${TARGET_STATUS:-available}"
        else printf '%s\tNone\n' "${TARGET_STATUS:-available}"; fi ;;
      *SecretArn*) if [ -f "$STUB_DIR/secret-made" ]; then echo "$NEW_SECRET"; else echo None; fi ;;
      *Endpoint.Address*) echo "$TARGET_HOST" ;;
      *) cat "$STUB_DIR/target.json" ;;
    esac ;;
  "rds describe-db-snapshots")
    printf '%s\t%s\t2026-11-05T03:12:00+00:00\n' "${SNAPSHOT_STATUS:-available}" "${SNAPSHOT_SOURCE:-${LIVE_ID:-ztdr-dev}}" ;;
  "rds restore-db-instance-from-db-snapshot"|"rds restore-db-instance-to-point-in-time")
    touch "$STUB_DIR/target-exists"; echo creating ;;
  "rds modify-db-instance")
    case " $* " in *" --manage-master-user-password "*) touch "$STUB_DIR/secret-made" ;; esac
    echo modifying ;;
  "secretsmanager describe-secret")
    echo '{"AutomaticallyAfterDays": 7, "Duration": "2h", "ScheduleExpression": "cron(0 10 ? * SUN *)"}' ;;
  "secretsmanager rotate-secret") echo rotated ;;
  "ecs describe-services")
    case "$q" in
      *networkConfiguration*) echo '{"awsvpcConfiguration": {"subnets": ["subnet-a"], "securityGroups": ["sg-ecs"], "assignPublicIp": "ENABLED"}}' ;;
      *) if [ -f "$STUB_DIR/applied" ]; then echo "task-definition/${LIVE_ID:-ztdr-dev}-app:13"; else echo "task-definition/${LIVE_ID:-ztdr-dev}-app:12"; fi ;;
    esac ;;
  "ecs describe-task-definition")
    case "$q" in
      *image*) echo "registry.example/${LIVE_ID:-ztdr-dev}:v0.1.14" ;;
      *) if [ -n "${APP_HOST:-}" ]; then echo "$APP_HOST"
         elif [ -f "$STUB_DIR/applied" ]; then echo "$TARGET_HOST"; else echo "$LIVE_HOST"; fi ;;
    esac ;;
  "ecs wait") ;;
  "ecs run-task") echo "arn:aws:ecs:us-east-1:123:task/${LIVE_ID:-ztdr-dev}/abc123" ;;
  "ecs describe-tasks")
    case "$q" in *exitCode*) echo "${CHECK_EXIT:-0}" ;; *) echo STOPPED ;; esac ;;
  "logs get-log-events") cat "$STUB_DIR/check-log.json" ;;
  "elbv2 describe-target-groups") echo "arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/${LIVE_ID:-ztdr-dev}-ecs/1" ;;
  "elbv2 describe-target-health") printf '%b\n' "${TARGET_HEALTH-healthy\thealthy}" ;;
  *) echo "unexpected aws call: $*" >&2; echo "aws $*" >> "$STUB_DIR/denied"; exit 97 ;;
esac
"""

# terraform: init and plan succeed (plan writes its -out file), show prints the plan in
# $STUB_DIR/plan.json, and apply marks the environment applied.
_RECOVER_TF = r"""
case " $* " in
  *" init "*) echo initialised ;;
  *" plan "*) for a in "$@"; do case "$a" in -out=*) : > "${a#-out=}" ;; esac; done ;;
  *" show "*) cat "$STUB_DIR/plan.json" ;;
  *" apply "*) touch "$STUB_DIR/applied" ;;
  *) echo "unexpected terraform call: $*" >&2; echo "terraform $*" >> "$STUB_DIR/denied"; exit 97 ;;
esac
"""

_RECOVER_LIVE_JSON = {
    "DBInstanceIdentifier": _RECOVER_LIVE,
    "DBInstanceClass": "db.t4g.micro",
    "DBSubnetGroup": {"DBSubnetGroupName": "ztdr-dev-db"},
    "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-db1"}, {"VpcSecurityGroupId": "sg-db2"}],
    "DBParameterGroups": [{"DBParameterGroupName": "ztdr-dev-force-ssl"}],
    "StorageType": "gp3",
    "StorageEncrypted": True,
    "KmsKeyId": "arn:aws:kms:us-east-1:123:key/storage-key",
    "MultiAZ": False,
    "DeletionProtection": True,
    "CopyTagsToSnapshot": True,
    "AutoMinorVersionUpgrade": True,
    "IAMDatabaseAuthenticationEnabled": False,
    "CACertificateIdentifier": "rds-ca-rsa2048-g1",
    "EnabledCloudwatchLogsExports": ["postgresql"],
    "BackupRetentionPeriod": 30,
    "PreferredBackupWindow": "06:00-07:00",
    "PreferredMaintenanceWindow": "sun:08:00-sun:09:00",
    "MaxAllocatedStorage": 100,
    "PubliclyAccessible": False,
    "MasterUserSecret": {"SecretArn": _RECOVER_LIVE_SECRET, "SecretStatus": "active", "KmsKeyId": "arn:aws:kms:us-east-1:123:key/live-key"},
    "LatestRestorableTime": "2026-11-05T15:00:00+00:00",
    "Endpoint": {"Address": _RECOVER_LIVE_HOST},
    "TagList": [
        {"Key": "Project", "Value": "zt-decoder-ring"},
        {"Key": "ManagedBy", "Value": "terraform"},
        {"Key": "aws:cloudformation:stack-name", "Value": "x"},
    ],
}

_RECOVER_TAGS = [
    {"Key": "ztdr-recovery-of", "Value": _RECOVER_LIVE},
    {"Key": "ztdr-recovery-source", "Value": "snapshot:rds:ztdr-dev-2026-11-05-03-12"},
]

_RECOVER_SNAPSHOT = "rds:ztdr-dev-2026-11-05-03-12"


def _plan(*changes):
    """A plan's resource_changes, with each address's type and mode read the way Terraform
    writes them: the type is the segment before the resource name, and data. marks a read."""
    out = []
    for address, actions in changes:
        segments = re.sub(r"\[[^\]]*\]", "", address).split(".")
        mode = "data" if "data" in segments[:-2] else "managed"
        out.append({"address": address, "mode": mode, "type": segments[-2], "change": {"actions": actions}})
    return {"resource_changes": out}


# What the cutover legitimately plans: the database module untouched, the restored instance
# and the policy documents read, the three task definitions replaced (either order Terraform
# writes a replace in), the service and the two task-role secret grants updated, and the
# two RDS alarms moved to the restored instance.
_RECOVER_PLAN_OK_CHANGES = (
    ("module.database.module.rds.module.db_instance.aws_db_instance.this[0]", ["no-op"]),
    ("data.aws_db_instance.restored[0]", ["read"]),
    ("module.compute.data.aws_iam_policy_document.task_inline", ["read"]),
    ("module.compute.aws_ecs_task_definition.migrate", ["delete", "create"]),
    ("module.compute.aws_ecs_task_definition.seed", ["create", "delete"]),
    ("module.compute.module.ecs_service.aws_ecs_task_definition.this[0]", ["delete", "create"]),
    ("module.compute.module.ecs_service.aws_ecs_service.this[0]", ["update"]),
    ("module.compute.aws_iam_role_policy.task_inline", ["update"]),
    ("module.compute.aws_iam_role_policy.task_exec_inline", ["update"]),
    ("module.alarm_rds_cpu.aws_cloudwatch_metric_alarm.this[0]", ["update"]),
    ("module.alarm_rds_free_storage.aws_cloudwatch_metric_alarm.this[0]", ["update"]),
)
_RECOVER_PLAN_OK = _plan(*_RECOVER_PLAN_OK_CHANGES)


def _check_line(ok=True, host=_RECOVER_TARGET_HOST):
    body = {
        "host": host, "ok": ok,
        "tables": {"ControlFamily": {"expected": 20, "actual": 20 if ok else 0}},
        "migrations": {"expected": 23, "missing": []},
    }
    return ["[entrypoint] DATABASE_URL composed", "db-recover-check " + json.dumps(body)]


def _recover(run, *args, plan=_RECOVER_PLAN_OK, target_tags=None, target_exists=False, check=None,
             instances=(), target_json=None, live_json=None, **env):
    """Runs db-recover.sh against the stubs. `instances` is what listing the account's
    instances returns; `target_json` and `live_json` replace what describing the restored and
    the live instance return."""
    _stub(run.bin, "aws", _RECOVER_AWS)
    _stub(run.bin, "terraform", _RECOVER_TF)
    target = dict(_RECOVER_LIVE_JSON, DBInstanceIdentifier=_RECOVER_TARGET, Endpoint={"Address": _RECOVER_TARGET_HOST},
                  MasterUserSecret={"SecretArn": _RECOVER_NEW_SECRET, "SecretStatus": "active"})
    (run.dir / "live.json").write_text(json.dumps(_RECOVER_LIVE_JSON if live_json is None else live_json))
    (run.dir / "target.json").write_text(json.dumps(target if target_json is None else target_json))
    (run.dir / "target-tags.json").write_text(json.dumps(_RECOVER_TAGS if target_tags is None else target_tags))
    (run.dir / "instances.json").write_text(json.dumps(list(instances)))
    (run.dir / "plan.json").write_text(json.dumps(plan))
    (run.dir / "check-log.json").write_text(json.dumps(check if check is not None else _check_line()))
    if target_exists:
        (run.dir / "target-exists").touch()
    full_env = {"TARGET_HOST": _RECOVER_TARGET_HOST, "LIVE_HOST": _RECOVER_LIVE_HOST, "NEW_SECRET": _RECOVER_NEW_SECRET, **env}
    return run("db-recover.sh", *args, env=full_env)


_RECOVER_RUN = ("--env", "dev", "--snapshot", _RECOVER_SNAPSHOT, "--target", _RECOVER_TARGET, "--execute")


def _recover_calls(run):
    """Every aws and terraform call, as [command, service-or-verb, ...]."""
    return [c for c in _calls(run.log) if c[0] in ("aws", "terraform")]


def _verbs(run):
    """The aws calls as "service verb" and the terraform calls as "terraform verb", in order."""
    out = []
    for c in _recover_calls(run):
        if c[0] == "aws":
            out.append(f"{c[1]} {c[2]}")
        else:
            out.append("terraform " + next(a for a in c[1:] if not a.startswith("-")))
    return out


def _steps(stdout):
    """The numbered step titles, without the time a real run prints after each."""
    return [re.sub(r"\s+\[[^\]]*\]$", "", line) for line in stdout.splitlines() if re.match(r"^\d+\. ", line)]


def test_recover_dry_run_is_the_default_and_calls_nothing(sandbox):
    result = _recover(sandbox, "--env", "dev", "--snapshot", _RECOVER_SNAPSHOT, "--target", _RECOVER_TARGET)
    assert result.returncode == 0, result.stderr
    assert "DRY RUN" in result.stdout
    assert _recover_calls(sandbox) == []
    assert not (sandbox.dir / "target-exists").exists()
    steps = _steps(result.stdout)
    assert [int(s.split(".")[0]) for s in steps] == list(range(1, 21))
    assert "Target: ztdr-dev-recovered-test" in result.stdout
    assert "must be a snapshot of ztdr-dev, and available" in result.stdout
    assert 'db_restored_instance_identifier = "ztdr-dev-recovered-test"' in result.stdout


def test_recover_dry_run_lists_the_steps_a_real_run_takes(sandbox):
    dry = _recover(sandbox, *_RECOVER_RUN[:-1])
    real = _recover(sandbox, *_RECOVER_RUN)
    assert real.returncode == 0, real.stdout + real.stderr
    assert _steps(dry.stdout) == _steps(real.stdout)


@pytest.mark.parametrize(
    "args, message",
    [
        ((), "--env must be dev or prod"),
        (("--env", "staging", "--latest"), "--env must be dev or prod"),
        (("--env",), "--env needs a value"),
        (("--env", "dev"), "exactly one of"),
        (("--env", "dev", "--snapshot", "a", "--latest"), "exactly one of"),
        (("--env", "dev", "--phase", "cutover"), "needs --target"),
        (("--env", "dev", "--phase", "verify", "--target", "ztdr-dev-x", "--latest"), "belong to the restore phase"),
        (("--env", "dev", "--phase", "rollback", "--latest"), "--phase must be"),
        (("--env", "dev", "--latest", "--target", "ztdr-dev"), "--target must be"),
        (("--env", "dev", "--latest", "--target", "ztdr-prod-x"), "--target must be"),
        (("--env", "dev", "--latest", "--target", "ztdr-dev-Upper"), "--target must be"),
        (("--env", "dev", "--restore-time", "2026-11-05 14:30"), "--restore-time takes UTC"),
        (("--env", "dev", "--snapshot", "x;y"), "is not a snapshot identifier"),
        (("--env", "dev", "--latest", "--wait-hours", "0"), "--wait-hours takes 1 to 48"),
        (("--env", "dev", "--latest", "--secret-kms-key-id", "a b"), "is not a KMS key"),
        (("--env", "dev", "--latest", "--force"), "unknown argument"),
    ],
    ids=["no-args", "unknown-env", "env-without-value", "no-source", "two-sources", "cutover-without-target",
         "source-outside-restore", "unknown-phase", "target-is-live", "target-in-other-env", "target-uppercase",
         "bad-time", "bad-snapshot", "wait-hours-zero", "bad-kms-key", "unknown-flag"],
)
def test_recover_refuses_bad_arguments_before_calling_anything(sandbox, args, message):
    result = _recover(sandbox, *args)
    assert result.returncode == 2, result.stdout + result.stderr
    assert message in result.stderr
    assert "usage:" in result.stderr
    assert _recover_calls(sandbox) == []


def test_recover_help_prints_usage(sandbox):
    result = _recover(sandbox, "--help")
    assert result.returncode == 0
    assert "usage:" in result.stdout


def test_recover_real_run_takes_every_step_in_order(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN)
    assert result.returncode == 0, result.stdout + result.stderr
    verbs = _verbs(sandbox)
    milestones = [
        "rds describe-db-snapshots",
        "ecs describe-task-definition",
        "rds restore-db-instance-from-db-snapshot",
        "rds modify-db-instance",
        "secretsmanager describe-secret",
        "secretsmanager rotate-secret",
        "terraform init",
        "terraform plan",
        "terraform show",
        "terraform apply",
        "ecs wait",
        "elbv2 describe-target-health",
        "ecs run-task",
        "logs get-log-events",
    ]
    positions = [verbs.index(m) for m in milestones]
    assert positions == sorted(positions), verbs
    assert verbs[0] == "rds describe-db-instances", "the live configuration is read first"
    assert "every seeded table holds the rows the seed writes" in result.stdout
    assert re.search(r"^1\. .*\[\d\d:\d\d:\d\dZ, \+\d+s\]$", result.stdout, re.M), "a real run times each step"


# Each source as (arguments, the restore call it makes, the flags naming the source exactly,
# the flags that call must not carry, the ztdr-recovery-source tag).
_RECOVER_SOURCES = {
    "snapshot": (("--snapshot", _RECOVER_SNAPSHOT), "restore-db-instance-from-db-snapshot",
                 {"--db-instance-identifier": _RECOVER_TARGET, "--db-snapshot-identifier": _RECOVER_SNAPSHOT},
                 ("--restore-time", "--use-latest-restorable-time", "--source-db-instance-identifier"),
                 "snapshot:" + _RECOVER_SNAPSHOT),
    "point-in-time": (("--restore-time", "2026-11-05T14:30:00Z"), "restore-db-instance-to-point-in-time",
                      {"--target-db-instance-identifier": _RECOVER_TARGET, "--source-db-instance-identifier": _RECOVER_LIVE,
                       "--restore-time": "2026-11-05T14:30:00Z"},
                      ("--use-latest-restorable-time", "--db-snapshot-identifier"), "time:2026-11-05T14:30:00Z"),
    "latest": (("--latest",), "restore-db-instance-to-point-in-time",
               {"--target-db-instance-identifier": _RECOVER_TARGET, "--source-db-instance-identifier": _RECOVER_LIVE},
               ("--restore-time", "--db-snapshot-identifier"), "time:latest"),
}


@pytest.mark.parametrize("source", list(_RECOVER_SOURCES), ids=list(_RECOVER_SOURCES))
def test_recover_restores_exactly_the_source_asked_for(sandbox, source):
    """A point-in-time restore goes to the time given, never quietly to the latest one, and
    each source makes its own restore call and no other."""
    args, verb, exact, absent, tag = _RECOVER_SOURCES[source]
    result = _recover(sandbox, "--env", "dev", *args, "--target", _RECOVER_TARGET, "--execute")
    assert result.returncode == 0, result.stdout + result.stderr
    restores = [c[1:] for c in _calls(sandbox.log) if c[:2] == ["aws", "rds"] and c[2].startswith("restore-")]
    assert [c[1] for c in restores] == [verb]
    restore = restores[0]
    for flag, value in exact.items():
        assert _arg(restore, flag) == value, flag
    for flag in absent:
        assert flag not in restore, flag
    if source == "latest":
        assert "--use-latest-restorable-time" in restore
    tags = {t["Key"]: t["Value"] for t in json.loads(_arg(restore, "--tags"))}
    assert tags["ztdr-recovery-source"] == tag


@pytest.mark.parametrize("source", list(_RECOVER_SOURCES), ids=list(_RECOVER_SOURCES))
def test_recover_restore_carries_the_live_configuration(sandbox, source):
    args, verb, _, _, tag = _RECOVER_SOURCES[source]
    result = _recover(sandbox, "--env", "dev", *args, "--target", _RECOVER_TARGET, "--execute")
    assert result.returncode == 0, result.stdout + result.stderr
    aws = [c[1:] for c in _calls(sandbox.log) if c[0] == "aws"]

    restore = next(c for c in aws if c[1] == verb)
    assert _arg(restore, "--db-instance-class") == "db.t4g.micro"
    assert _arg(restore, "--db-subnet-group-name") == "ztdr-dev-db"
    assert _arg(restore, "--db-parameter-group-name") == "ztdr-dev-force-ssl"
    sgs = restore.index("--vpc-security-group-ids")
    assert restore[sgs + 1:sgs + 3] == ["sg-db1", "sg-db2"]
    for wanted in ("--no-publicly-accessible", "--no-multi-az", "--deletion-protection", "--copy-tags-to-snapshot"):
        assert wanted in restore, wanted
    assert _arg(restore, "--enable-cloudwatch-logs-exports") == "postgresql"
    tags = {t["Key"]: t["Value"] for t in json.loads(_arg(restore, "--tags"))}
    assert tags == {"Project": "zt-decoder-ring", "ztdr-recovery-of": "ztdr-dev", "ztdr-recovery-source": tag}
    assert _arg(restore, "--ca-certificate-identifier") == "rds-ca-rsa2048-g1"
    assert "--auto-minor-version-upgrade" in restore and "--no-enable-iam-database-authentication" in restore
    assert _arg(restore, "--storage-type") == "gp3"

    modify = next(c for c in aws if c[1] == "modify-db-instance")
    assert _arg(modify, "--db-instance-identifier") == _RECOVER_TARGET
    assert "--manage-master-user-password" in modify and "--apply-immediately" in modify
    assert _arg(modify, "--master-user-secret-kms-key-id") == "arn:aws:kms:us-east-1:123:key/live-key"
    assert _arg(modify, "--backup-retention-period") == "30"
    assert _arg(modify, "--max-allocated-storage") == "100"

    rotate = next(c for c in aws if c[1] == "rotate-secret")
    assert _arg(rotate, "--secret-id") == _RECOVER_NEW_SECRET
    assert json.loads(_arg(rotate, "--rotation-rules")) == {"ScheduleExpression": "cron(0 10 ? * SUN *)", "Duration": "2h"}
    assert "--no-rotate-immediately" in rotate


def test_recover_secret_key_can_be_overridden(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, "--phase", "restore", "--secret-kms-key-id", "alias/aws/secretsmanager")
    assert result.returncode == 0, result.stdout + result.stderr
    modify = next(c[1:] for c in _calls(sandbox.log) if c[:3] == ["aws", "rds", "modify-db-instance"])
    assert _arg(modify, "--master-user-secret-kms-key-id") == "alias/aws/secretsmanager"
    assert not [c for c in _calls(sandbox.log) if c[0] == "terraform"], "the restore phase stops before Terraform"


@pytest.mark.parametrize("source", [("--snapshot", _RECOVER_SNAPSHOT), ("--restore-time", "2026-11-05T14:30:00Z"), ("--latest",)],
                         ids=["snapshot", "point-in-time", "latest"])
def test_recover_never_changes_the_live_instance(sandbox, source):
    """No rds call that changes anything names the live instance: it is described, and a
    point-in-time restore names it as its source. Its secret is only described."""
    result = _recover(sandbox, "--env", "dev", *source, "--target", _RECOVER_TARGET, "--execute",
                      target_tags=[])
    assert result.returncode == 0, result.stdout + result.stderr
    rds_verbs = {"describe-db-instances", "describe-db-snapshots", "restore-db-instance-from-db-snapshot",
                 "restore-db-instance-to-point-in-time", "modify-db-instance"}
    for call in [c[1:] for c in _calls(sandbox.log) if c[0] == "aws"]:
        if call[0] == "rds":
            assert call[1] in rds_verbs, f"unexpected rds call: {call}"
            if _RECOVER_LIVE in call[2:]:
                where = call.index(_RECOVER_LIVE) - 1
                assert (call[1], call[where]) in {
                    ("describe-db-instances", "--db-instance-identifier"),
                    ("restore-db-instance-to-point-in-time", "--source-db-instance-identifier"),
                }, f"{call[1]} names the live instance as {call[where]}"
        if _RECOVER_LIVE_SECRET in call:
            assert call[:2] == ["secretsmanager", "describe-secret"], f"{call[:2]} names the live secret"
    restored = [c for c in _calls(sandbox.log) if c[:2] == ["aws", "rds"] and c[2].startswith("restore-")]
    assert len(restored) == 1 and _arg(restored[0], "--target-db-instance-identifier" if "time" in restored[0][2] else "--db-instance-identifier") == _RECOVER_TARGET


def test_recover_stops_at_the_first_failing_call(sandbox):
    """A failed call stops the run with the script's own status, 1, not the call's, says
    once which step stopped, and prints the target to continue on."""
    result = _recover(sandbox, *_RECOVER_RUN, FAIL_ON="rds modify-db-instance")
    assert result.returncode == 1, result.stderr
    verbs = _verbs(sandbox)
    assert verbs[-1] == "rds modify-db-instance", verbs
    assert "secretsmanager rotate-secret" not in verbs and "terraform plan" not in verbs
    assert result.stderr.count("step 7 stopped: a command exited 254") == 1, result.stderr
    assert "target: ztdr-dev-recovered-test. Run again with the same arguments" in result.stderr


def test_recover_stops_at_once_when_the_live_instance_is_gone(sandbox):
    """The script recovers an instance that still exists; a gone one is recovered by hand,
    and the run says where that is documented before it calls anything else."""
    result = _recover(sandbox, *_RECOVER_RUN, LIVE_GONE="1")
    assert result.returncode == 1
    assert "This script recovers an instance that still exists" in result.stderr
    assert 'rds-snapshot-restore.md describes under "When the instance is gone"' in result.stderr
    assert _verbs(sandbox) == ["rds describe-db-instances"]


def test_recover_reports_a_failed_live_read_as_access_not_a_gone_instance(sandbox):
    """A read that fails for any reason but DBInstanceNotFound, such as a dropped VPN or an
    expired credential, says to check access, not that the instance may be gone."""
    result = _recover(sandbox, *_RECOVER_RUN, FAIL_ON="rds describe-db-instances")
    assert result.returncode == 1
    assert "check the VPN, AWS_PROFILE and its credential helper" in result.stderr, result.stderr
    assert "When the instance is gone" not in result.stderr
    assert _verbs(sandbox) == ["rds describe-db-instances"]


def test_recover_stops_on_an_impaired_secret_without_waiting(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, SECRET_STATUS="impaired")
    assert result.returncode == 1
    assert "managed secret is impaired" in result.stderr
    assert not [c for c in _calls(sandbox.log) if c[0] == "sleep"], "it stops at once rather than waiting out the window"
    assert "terraform plan" not in _verbs(sandbox)


@pytest.mark.parametrize("plan", [_plan(("module.kms.aws_kms_key.secrets", ["update"])), _RECOVER_PLAN_OK],
                         ids=["refused", "applied"])
def test_recover_removes_its_plan_whether_or_not_it_applies(sandbox, plan):
    tmp = sandbox.dir / "tmp"
    tmp.mkdir()
    _recover(sandbox, *_RECOVER_RUN, plan=plan, TMPDIR=str(tmp))
    assert "terraform plan" in _verbs(sandbox)
    assert list(tmp.iterdir()) == []


def test_recover_stops_when_the_new_instance_fails(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, TARGET_STATUS="incompatible-restore")
    assert result.returncode != 0
    assert "is incompatible-restore and will not become available" in result.stderr
    assert "rds modify-db-instance" not in _verbs(sandbox)


def test_recover_resumes_on_its_own_instance(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, target_exists=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "resuming on it" in result.stdout
    verbs = _verbs(sandbox)
    assert "rds restore-db-instance-from-db-snapshot" not in verbs
    assert "rds modify-db-instance" in verbs


def test_recover_refuses_an_existing_instance_it_did_not_create(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, target_exists=True,
                      target_tags=[{"Key": "ztdr-recovery-source", "Value": "snapshot:another"}])
    assert result.returncode != 0
    assert "is not this recovery's instance" in result.stderr
    verbs = _verbs(sandbox)
    assert not [v for v in verbs if v.startswith("rds restore-") or v == "rds modify-db-instance"], verbs


@pytest.mark.parametrize(
    "tags",
    [
        [{"Key": "ztdr-recovery-of", "Value": _RECOVER_LIVE}, {"Key": "ztdr-recovery-source", "Value": "snapshot:another"}],
        [{"Key": "ztdr-recovery-of", "Value": "ztdr-prod"}, _RECOVER_TAGS[1]],
        [_RECOVER_TAGS[1]],
        [_RECOVER_TAGS[0]],
    ],
    ids=["other-source", "other-live-instance", "no-recovery-of-tag", "no-source-tag"],
)
def test_recover_resumes_only_with_both_tags_matching(sandbox, tags):
    """A named target that exists is resumed only when it carries both this recovery's tags:
    one matching tag is not enough."""
    result = _recover(sandbox, *_RECOVER_RUN, target_exists=True, target_tags=tags)
    assert result.returncode == 1
    assert "is not this recovery's instance" in result.stderr
    verbs = _verbs(sandbox)
    assert not [v for v in verbs if v.startswith("rds restore-") or v == "rds modify-db-instance"], verbs


@pytest.mark.parametrize(
    "different, message",
    [
        ({"DBParameterGroups": [{"DBParameterGroupName": "default.postgres16"}]},
         "parameter group: wanted ztdr-dev-force-ssl, ztdr-dev-recovered-test has default.postgres16"),
        ({"VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-default"}]}, "security groups: wanted sg-db1,sg-db2"),
        ({"PubliclyAccessible": True}, "publicly accessible: wanted false, ztdr-dev-recovered-test has true"),
        ({"BackupRetentionPeriod": 1}, "backup retention: wanted 30, ztdr-dev-recovered-test has 1"),
        ({"DeletionProtection": False}, "deletion protection: wanted true"),
        ({"MasterUserSecret": None}, "managed secret: wanted active, ztdr-dev-recovered-test has none"),
        ({"StorageEncrypted": False}, "encryption at rest: wanted true, ztdr-dev-recovered-test has false"),
        ({"KmsKeyId": "arn:aws:kms:us-east-1:123:key/other-key"},
         "storage KMS key: wanted arn:aws:kms:us-east-1:123:key/storage-key, ztdr-dev-recovered-test has arn:aws:kms:us-east-1:123:key/other-key"),
        ({"EnabledCloudwatchLogsExports": []}, "CloudWatch log exports: wanted postgresql, ztdr-dev-recovered-test has none"),
        ({"EnabledCloudwatchLogsExports": ["postgresql", "upgrade"]},
         "CloudWatch log exports: wanted postgresql, ztdr-dev-recovered-test has postgresql,upgrade"),
        ({"IAMDatabaseAuthenticationEnabled": True}, "IAM database authentication: wanted false, ztdr-dev-recovered-test has true"),
        ({"CACertificateIdentifier": "rds-ca-ecc384-g1"},
         "CA certificate: wanted rds-ca-rsa2048-g1, ztdr-dev-recovered-test has rds-ca-ecc384-g1"),
    ],
    ids=["parameter-group", "security-groups", "public", "backup-retention", "deletion-protection", "no-secret",
         "not-encrypted", "other-kms-key", "no-log-exports", "extra-log-export", "iam-auth", "ca-certificate"],
)
def test_recover_stops_when_the_restored_configuration_differs(sandbox, different, message):
    """Each setting the restore must carry is compared with the live instance; one differing
    stops the run before Terraform, with that row, and only that row, named."""
    target = dict(_RECOVER_LIVE_JSON, DBInstanceIdentifier=_RECOVER_TARGET, Endpoint={"Address": _RECOVER_TARGET_HOST},
                  MasterUserSecret={"SecretArn": _RECOVER_NEW_SECRET, "SecretStatus": "active"})
    target.update(different)
    result = _recover(sandbox, *_RECOVER_RUN, target_json=target)
    assert result.returncode == 1
    assert "ztdr-dev-recovered-test differs from ztdr-dev" in result.stderr and message in result.stderr, result.stderr
    rows = result.stderr.split("differs from ztdr-dev:", 1)[1].split("   target:", 1)[0].strip().splitlines()
    assert len(rows) == 1, rows
    assert not [c for c in _calls(sandbox.log) if c[0] == "terraform"]


def test_recover_passes_when_the_carried_settings_match(sandbox):
    """Encryption, its key, IAM auth, the CA and the log exports all equal the live instance's,
    the exports in another order, so the run goes on to Terraform."""
    live = dict(_RECOVER_LIVE_JSON, EnabledCloudwatchLogsExports=["postgresql", "upgrade"])
    target = dict(live, DBInstanceIdentifier=_RECOVER_TARGET, Endpoint={"Address": _RECOVER_TARGET_HOST},
                  MasterUserSecret={"SecretArn": _RECOVER_NEW_SECRET, "SecretStatus": "active"},
                  EnabledCloudwatchLogsExports=["upgrade", "postgresql"])
    result = _recover(sandbox, *_RECOVER_RUN, live_json=live, target_json=target)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ztdr-dev-recovered-test matches ztdr-dev" in result.stdout
    assert "terraform apply" in _verbs(sandbox)


@pytest.mark.parametrize("env", [{"TARGET_STATUS": "modifying", "SECRET_STATUS": "active"},
                                 {"SECRET_STATUS": "creating"}, {"SECRET_STATUS": "None"}],
                         ids=["instance-modifying", "secret-creating", "no-secret"])
def test_recover_cutover_refuses_a_target_that_is_not_ready(sandbox, env):
    result = _recover(sandbox, "--env", "dev", "--phase", "cutover", "--target", _RECOVER_TARGET, "--execute",
                      target_exists=True, **env)
    assert result.returncode == 1
    assert "is not ready to serve the app" in result.stderr
    assert not [c for c in _calls(sandbox.log) if c[0] == "terraform"]


@pytest.mark.parametrize("health", ["", "draining", "draining\tdraining"], ids=["no-targets", "draining", "all-draining"])
def test_recover_verify_needs_at_least_one_healthy_target(sandbox, health):
    (sandbox.dir / "applied").touch()
    result = _recover(sandbox, "--env", "dev", "--phase", "verify", "--target", _RECOVER_TARGET, "--execute",
                      target_exists=True, TARGET_HEALTH=health)
    assert result.returncode == 1
    assert "targets are not healthy" in result.stderr
    assert "ecs run-task" not in _verbs(sandbox)


def _instance(identifier, hours_old=3.0, of=_RECOVER_LIVE, source="snapshot:" + _RECOVER_SNAPSHOT):
    """One instance as the account listing returns it; hours_old=None is one still being created."""
    created = None
    if hours_old is not None:
        created = (datetime.now(timezone.utc) - timedelta(hours=hours_old)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")
    tags = []
    if of is not None:
        tags.append({"Key": "ztdr-recovery-of", "Value": of})
    if source is not None:
        tags.append({"Key": "ztdr-recovery-source", "Value": source})
    return {"id": identifier, "created": created, "tags": tags}


_RECOVER_DEFAULT_RUN = ("--env", "dev", "--snapshot", _RECOVER_SNAPSHOT, "--execute")


@pytest.mark.parametrize("hours_old", [3.0, None], ids=["created-before-midnight", "still-creating"])
def test_recover_resumes_by_its_tags_after_the_date_changes(sandbox, hours_old):
    """Run again on the next day without --target, the restore finds the instance the first
    run named for its own day, by the tags it gave it, and resumes there."""
    earlier = "ztdr-dev-recovered-20261105-2350"
    result = _recover(sandbox, *_RECOVER_DEFAULT_RUN, target_exists=True, instances=[_instance(earlier, hours_old)])
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"Target: {earlier}" in result.stdout
    verbs = _verbs(sandbox)
    assert not [v for v in verbs if v.startswith("rds restore-")], verbs
    modify = next(c for c in _calls(sandbox.log) if c[:3] == ["aws", "rds", "modify-db-instance"])
    assert _arg(modify, "--db-instance-identifier") == earlier
    plan = next(c for c in _calls(sandbox.log) if c[0] == "terraform" and "plan" in c)
    assert "db_restored_instance_identifier=" + earlier in plan


def test_recover_refuses_more_than_one_instance_tagged_as_its_own(sandbox):
    first, second = "ztdr-dev-recovered-20261105-2350", "ztdr-dev-recovered-20261106-0010"
    result = _recover(sandbox, *_RECOVER_DEFAULT_RUN, instances=[_instance(first), _instance(second, 1.0)])
    assert result.returncode != 0
    assert "more than one instance" in result.stderr and first in result.stderr and second in result.stderr
    verbs = _verbs(sandbox)
    assert not [v for v in verbs if v.startswith("rds restore-") or v == "rds modify-db-instance"], verbs


@pytest.mark.parametrize(
    "instance",
    [
        _instance("ztdr-dev-recovered-20261101-0900", hours_old=72),
        _instance("ztdr-dev-recovered-20261105-2300", source="snapshot:another"),
        _instance("ztdr-dev-recovered-20261105-2310", of="ztdr-prod"),
        _instance("ztdr-dev-recovered-20261105-2320", of=None),
        _instance("ztdr-dev-recovered-20261105-2330", source=None),
        _instance("other-ztdr-dev-recovered", hours_old=1),
    ],
    ids=["older-than-48-hours", "other-source", "other-live-instance", "no-recovery-of-tag", "no-source-tag",
         "outside-the-prefix"],
)
def test_recover_restores_anew_past_an_old_or_foreign_instance(sandbox, instance):
    """An instance older than 48 hours is a finished recovery, and one tagged for another
    source, another live instance or outside ztdr-dev-* is not this recovery's: each alone is
    passed over for a fresh restore."""
    result = _recover(sandbox, *_RECOVER_DEFAULT_RUN, instances=[instance])
    assert result.returncode == 0, result.stdout + result.stderr
    restore = next(c for c in _calls(sandbox.log) if c[:3] == ["aws", "rds", "restore-db-instance-from-db-snapshot"])
    created = _arg(restore, "--db-instance-identifier")
    assert re.fullmatch(r"ztdr-dev-recovered-\d{8}-\d{4}", created), created
    assert f"Target: {created}" in result.stdout


def test_recover_refuses_when_the_app_reads_another_instance(sandbox):
    """After an earlier recovery is kept, the app reads it, and restoring ztdr-dev would
    lose every write since: the run stops before restoring and names the instance in use."""
    serving = "ztdr-dev-recovered-20260101-0900.example.us-east-1.rds.amazonaws.com"
    result = _recover(sandbox, "--env", "dev", "--latest", "--target", _RECOVER_TARGET, "--execute", APP_HOST=serving)
    assert result.returncode != 0
    assert "reads ztdr-dev-recovered-20260101-0900" in result.stderr and "not ztdr-dev" in result.stderr
    verbs = _verbs(sandbox)
    assert not [v for v in verbs if v.startswith("rds restore-") or v == "rds modify-db-instance"], verbs


def test_recover_resume_continues_when_the_app_already_reads_its_target(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, target_exists=True, APP_HOST=_RECOVER_TARGET_HOST)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "already reads ztdr-dev-recovered-test, from an earlier run" in result.stdout


def test_recover_refuses_a_snapshot_that_is_not_available(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, SNAPSHOT_STATUS="creating")
    assert result.returncode != 0
    assert "is not available" in result.stderr
    assert not [v for v in _verbs(sandbox) if v.startswith("rds restore-")]


@pytest.mark.parametrize("source", ["ztdr-prod", "ztdr-dev-recovered-20260101-0900", "ztdr-dev-old"],
                         ids=["another-environment", "an-earlier-recovery", "another-dev-instance"])
def test_recover_refuses_a_snapshot_of_another_instance(sandbox, source):
    """The script recovers ztdr-dev, so only ztdr-dev's own snapshots are a source; another
    instance's snapshot is refused, naming where it came from, before anything is restored."""
    result = _recover(sandbox, *_RECOVER_RUN, SNAPSHOT_SOURCE=source)
    assert result.returncode == 1
    assert f"is a snapshot of {source}, not ztdr-dev" in result.stderr, result.stderr
    verbs = _verbs(sandbox)
    assert not [v for v in verbs if v.startswith("rds restore-") or v == "rds modify-db-instance"], verbs


def test_recover_restores_a_snapshot_of_the_live_instance(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN, "--phase", "restore", SNAPSHOT_SOURCE="ztdr-dev")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "snapshot rds:ztdr-dev-2026-11-05-03-12: available\tztdr-dev" in result.stdout
    assert "rds restore-db-instance-from-db-snapshot" in _verbs(sandbox)


def test_recover_refuses_a_restore_time_after_the_latest_restorable(sandbox):
    result = _recover(sandbox, "--env", "dev", "--restore-time", "2026-11-05T15:00:01Z", "--target", _RECOVER_TARGET, "--execute")
    assert result.returncode != 0
    assert "later than ztdr-dev's latest restorable time" in result.stderr
    assert not [v for v in _verbs(sandbox) if v.startswith("rds restore-")]


def test_recover_applies_a_plan_of_only_the_apps_database_wiring(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "terraform apply" in _verbs(sandbox)
    for address, actions in _RECOVER_PLAN_OK_CHANGES:
        if actions != ["no-op"]:
            assert f"will {'/'.join(actions)} {address}" in result.stdout, address


@pytest.mark.parametrize(
    "change",
    [
        ("module.security.aws_security_group.db", ["update"]),
        ("module.kms.module.secrets_cmk.aws_kms_key.this[0]", ["update"]),
        ('module.compute.module.alb.aws_lb_listener.this["http"]', ["update"]),
        ("module.compute.aws_secretsmanager_secret_rotation.db[0]", ["update"]),
        ("module.compute.aws_secretsmanager_secret_rotation.db[0]", ["delete", "create"]),
        ("module.database.module.rds.module.db_instance.aws_db_instance.this[0]", ["create"]),
        ("module.database.module.rds.module.db_instance.aws_db_instance.this[0]", ["update"]),
        ('module.sns_alerts.aws_sns_topic_subscription.this["oncall"]', ["delete"]),
        ("module.compute.aws_iam_role_policy.falcon_task_exec[0]", ["update"]),
        ("module.alarm_alb_5xx.aws_cloudwatch_metric_alarm.this[0]", ["update"]),
        ("module.compute.module.ecs_service.aws_ecs_service.this[0]", ["delete", "create"]),
        ("module.compute.aws_ecs_task_definition.seed", ["update"]),
        ("module.compute.module.rotation_redeploy_lambda[0].aws_lambda_function.this[0]", ["update"]),
        ("module.compute.module.other_lambda[0].null_resource.archive[0]", ["delete", "create"]),
    ],
    ids=["security-group-update", "kms-key-update", "listener-update", "rotation-update", "rotation-replace",
         "new-db-instance", "db-instance-update", "subscription-delete", "other-iam-policy", "other-alarm",
         "service-replace", "task-definition-update", "rotation-lambda-function-update",
         "other-packaging-step"],
)
def test_recover_refuses_any_plan_change_outside_the_apps_database_wiring(sandbox, change):
    """Each change is refused even among the allowed ones, named in the refusal, and
    nothing is applied; the allowed changes are not listed as refused."""
    result = _recover(sandbox, *_RECOVER_RUN, plan=_plan(*_RECOVER_PLAN_OK_CHANGES, change))
    assert result.returncode != 0
    assert "refusing to apply" in result.stderr, result.stderr
    block = result.stderr.split("Refused:", 1)[1].split("   target:", 1)[0]
    assert block.strip().splitlines() == [f"{'/'.join(change[1])} {change[0]}"], result.stderr
    verbs = _verbs(sandbox)
    assert "terraform show" in verbs and "terraform apply" not in verbs


def test_recover_applies_a_plan_that_also_repackages_the_rotation_lambda(sandbox):
    """Every plan replaces the rotation Lambda's local packaging step, whose trigger includes
    the build time; the cutover still applies, and the step is listed among what it will do."""
    archive = ("module.compute.module.rotation_redeploy_lambda[0].null_resource.archive[0]", ["delete", "create"])
    result = _recover(sandbox, *_RECOVER_RUN, plan=_plan(*_RECOVER_PLAN_OK_CHANGES, archive))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "terraform apply" in _verbs(sandbox)
    assert f"will delete/create {archive[0]}" in result.stdout, result.stdout


def test_recover_plans_the_cutover_with_the_running_image(sandbox):
    result = _recover(sandbox, *_RECOVER_RUN)
    assert result.returncode == 0, result.stdout + result.stderr
    plan = next(c for c in _calls(sandbox.log) if c[0] == "terraform" and "plan" in c)
    assert plan[1].endswith("infra/environments/dev") and plan[1].startswith("-chdir=")
    assert "db_restored_instance_identifier=" + _RECOVER_TARGET in plan
    assert "container_image_tag=v0.1.14" in plan


def test_recover_verify_runs_the_check_in_the_vpc(sandbox):
    """The check goes to the seed task definition as node -e, without its comment lines,
    on the app service's private network, and its line in the log decides the result."""
    (sandbox.dir / "applied").touch()
    result = _recover(sandbox, "--env", "dev", "--phase", "verify", "--target", _RECOVER_TARGET, "--execute",
                      target_exists=True)
    assert result.returncode == 0, result.stdout + result.stderr
    run_task = next(c[1:] for c in _calls(sandbox.log) if c[:3] == ["aws", "ecs", "run-task"])
    assert _arg(run_task, "--task-definition") == "ztdr-dev-seed"
    network = json.loads(_arg(run_task, "--network-configuration"))
    assert network["awsvpcConfiguration"] == {"subnets": ["subnet-a"], "securityGroups": ["sg-ecs"], "assignPublicIp": "DISABLED"}
    overrides = _arg(run_task, "--overrides")
    assert len(overrides) < 8192
    container = json.loads(overrides)["containerOverrides"][0]
    assert container["name"] == "seed" and container["command"][:2] == ["node", "-e"]
    code = container["command"][2]
    assert not [line for line in code.splitlines() if line.strip().startswith("//")]
    assert "ControlFamily: 20 rows, the seed writes 20" in result.stdout


def test_recover_verify_fails_when_the_app_reads_another_database(sandbox):
    result = _recover(sandbox, "--env", "dev", "--phase", "verify", "--target", _RECOVER_TARGET, "--execute",
                      target_exists=True)
    assert result.returncode != 0
    assert "Run the cutover phase first" in result.stderr
    assert "ecs run-task" not in _verbs(sandbox)


@pytest.mark.parametrize(
    "env, check, message",
    [
        ({"CHECK_EXIT": "1"}, _check_line(ok=False), "does not hold what the deployed image's seed writes"),
        ({}, _check_line(host=_RECOVER_LIVE_HOST), "the check read ztdr-dev.example"),
        ({}, ["no result here"], "logged no result"),
        ({"TARGET_HEALTH": "healthy\tunhealthy"}, None, "targets are not healthy"),
        ({"CHECK_EXIT": "2"}, ['db-recover-check {"error": "connect ECONNREFUSED 10.0.0.5:5432"}'],
         "the row check could not run (exit 2): connect ECONNREFUSED 10.0.0.5:5432"),
        ({"CHECK_EXIT": "2"}, ["db-recover-check failed: boom"],
         "the check task (exit 2) logged a result that is not JSON: failed: boom"),
        ({}, ['db-recover-check {"host": "x"}'], 'logged a result without its counts: {"host": "x"}'),
    ],
    ids=["rows-differ", "wrong-host", "no-result-line", "unhealthy-target", "check-error",
         "line-not-json", "line-without-counts"],
)
def test_recover_verify_fails_on_each_bad_result(sandbox, env, check, message):
    (sandbox.dir / "applied").touch()
    result = _recover(sandbox, "--env", "dev", "--phase", "verify", "--target", _RECOVER_TARGET, "--execute",
                      target_exists=True, check=check, **env)
    assert result.returncode != 0
    assert message in result.stderr, result.stderr


def _check_counts(seed_dir, migrations_dir):
    env = {**os.environ, "DB_RECOVER_CHECK_SEED_DIR": str(seed_dir), "DB_RECOVER_CHECK_MIGRATIONS_DIR": str(migrations_dir)}
    env.pop("DATABASE_URL", None)
    result = subprocess.run(["node", str(SCRIPTS / "db-recover-check.cjs")], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    line = result.stdout.strip()
    assert line.startswith("db-recover-check ")
    return json.loads(line[len("db-recover-check "):])


_APP = SCRIPTS.parent / "app"


def _check_as_the_seed_task(code=None, **env):
    """Runs the check the way the seed task does: from the image's working directory, which
    holds prisma/, with SEED_CATALOG from the task definition and no DATABASE_URL."""
    full_env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SEED_CATALOG")}
    full_env.update(env)
    command = ["node", "-e", code] if code is not None else ["node", str(SCRIPTS / "db-recover-check.cjs")]
    return subprocess.run(command, cwd=_APP, env=full_env, capture_output=True, text=True)


def test_recover_check_counts_the_rows_the_committed_seed_writes():
    """The seed task names its catalog in SEED_CATALOG; the check reads that catalog's
    committed seed, under prisma/seed-sql/, as the seed loader does."""
    seed_dir = _APP / "prisma" / "seed-sql" / "nist-800-53"
    result = _check_as_the_seed_task(SEED_CATALOG="nist-800-53")
    assert result.returncode == 0, result.stdout + result.stderr
    out = json.loads(result.stdout.strip().split(" ", 1)[1])
    inserted = set()
    for path in seed_dir.glob("*.sql"):
        inserted.update(re.findall(r'^INSERT INTO "(\w+)"', path.read_text(), re.M))
    assert set(out["seed"]) == inserted
    assert all(n > 0 for n in out["seed"].values()), out["seed"]
    assert out["seed"]["ControlFamily"] == 20
    assert out["seed"]["NistControl"] == 1196, "1,014 live controls and 182 withdrawn"
    assert out["seed"]["ControlLineage"] == 203
    migrations = _APP / "prisma" / "migrations"
    assert out["migrations"] == len([d for d in migrations.iterdir() if (d / "migration.sql").exists()])


@pytest.mark.parametrize("catalog, message", [
    (None, "SEED_CATALOG is not set"),
    ("", "SEED_CATALOG is not set"),
    ("../nist-800-53", "is not a catalog directory name"),
    ("nist..800", "is not a catalog directory name"),
    ("no-such-catalog", "no such file or directory"),
], ids=["unset", "empty", "path", "dot-dot", "unknown"])
def test_recover_check_refuses_to_guess_the_catalog(catalog, message):
    """Like the seed loader, the check has no default catalog: one it cannot name is an
    error line, never a count of some other seed."""
    env = {} if catalog is None else {"SEED_CATALOG": catalog}
    result = _check_as_the_seed_task(**env)
    assert result.returncode == 2, result.stdout + result.stderr
    prefix, body = result.stdout.strip().split(" ", 1)
    assert prefix == "db-recover-check"
    assert message in json.loads(body)["error"]


def test_recover_check_reads_literals_and_values_lists_whole(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    (seed / "01.sql").write_text(
        "-- a comment (with parens); and a semicolon\n"
        "SET client_min_messages = warning;\n"
        'INSERT INTO "A" ("id", "prose") VALUES\n'
        "  ('a', 'one (two), three; four'),\n"
        "  ('b', E'it\\'s (x)'),\n"
        "  ('c', $$a); (b$$),\n"
        "  ('d', 'line one\nline two (', ARRAY['x']::\"T\"[])\n"
        'ON CONFLICT ("id") DO NOTHING;\n'
        'UPDATE "A" SET "prose" = \'(x)\' WHERE id = \'a\';\n'
        "/* block; (comment) */\n"
        'INSERT INTO "B" ("x", "y") SELECT v.x, lower(v.y) FROM (VALUES (1, \'P\'), (2, \'Q\')) AS v(x, y);\n'
    )
    (seed / "02.sql").write_text('INSERT INTO "A" ("id") VALUES (\'e\');\n')
    migrations = tmp_path / "migrations"
    (migrations / "20260101000000_init").mkdir(parents=True)
    (migrations / "20260101000000_init" / "migration.sql").write_text("")
    (migrations / "not-a-migration").mkdir()
    out = _check_counts(seed, migrations)
    assert out == {"seed": {"A": 5, "B": 2}, "migrations": 1}


def test_recover_check_logs_its_own_failure_as_json(tmp_path):
    """A check that cannot run still logs one JSON line, with the reason, and exits 2."""
    env = {**os.environ, "DB_RECOVER_CHECK_SEED_DIR": str(tmp_path / "missing"),
           "DB_RECOVER_CHECK_MIGRATIONS_DIR": str(tmp_path)}
    env.pop("DATABASE_URL", None)
    result = subprocess.run(["node", str(SCRIPTS / "db-recover-check.cjs")], env=env, capture_output=True, text=True)
    assert result.returncode == 2
    prefix, body = result.stdout.strip().split(" ", 1)
    assert prefix == "db-recover-check"
    assert "no such file or directory" in json.loads(body)["error"]


def test_recover_check_runs_as_sent_to_ecs():
    """The code the script sends, comment lines removed, still runs under node -e, from the
    working directory and with the catalog the seed task gives it."""
    code = "\n".join(line for line in (SCRIPTS / "db-recover-check.cjs").read_text().splitlines()
                     if not line.strip().startswith("//"))
    result = _check_as_the_seed_task(code, SEED_CATALOG="nist-800-53")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout.split(" ", 1)[1])["seed"]["NistControl"] == 1196


def _make_recover(*args, env=None):
    full_env = {k: v for k, v in os.environ.items() if k not in _SCRIPT_ENV}
    full_env.update(env or {})
    return subprocess.run(["make", "-n", "-C", str(SCRIPTS.parent), "db-recover", *args],
                          env=full_env, capture_output=True, text=True)


def test_make_db_recover_passes_only_command_line_values():
    result = _make_recover("ENV=prod", "RESTORE_TIME=2026-11-05T14:30:00Z", "TARGET=ztdr-prod-recovered-1",
                           "PHASE=restore", "SECRET_KMS_KEY_ID=alias/aws/secretsmanager", "CONFIRM=yes")
    assert result.returncode == 0, result.stderr
    command = " ".join(result.stdout.split())
    for wanted in ("scripts/db-recover.sh --env prod", "--restore-time '2026-11-05T14:30:00Z'",
                   "--target 'ztdr-prod-recovered-1'", "--phase 'restore'",
                   "--secret-kms-key-id 'alias/aws/secretsmanager'", "--execute"):
        assert wanted in command, command

    shell = _make_recover("ENV=dev", "LATEST=yes", env={"TARGET": "ztdr-dev-from-the-shell", "CONFIRM": "yes"})
    command = " ".join(shell.stdout.split())
    assert "--latest" in command
    assert "--target" not in command and "--execute" not in command, command


# --- db-recover.sh: the name prefix and the stack's backend ----------------------------

_PREFIXED = "acme-dr"
_PREFIXED_LIVE = "acme-dr-dev"
_PREFIXED_TARGET = "acme-dr-dev-recovered-test"


_PREFIXED_LIVE_JSON = dict(_RECOVER_LIVE_JSON, DBInstanceIdentifier=_PREFIXED_LIVE,
                           DBSubnetGroup={"DBSubnetGroupName": "acme-dr-dev-db"},
                           DBParameterGroups=[{"DBParameterGroupName": "acme-dr-dev-force-ssl"}])


def _prefixed_target_json():
    return dict(_PREFIXED_LIVE_JSON, DBInstanceIdentifier=_PREFIXED_TARGET, Endpoint={"Address": _RECOVER_TARGET_HOST},
                MasterUserSecret={"SecretArn": _RECOVER_NEW_SECRET, "SecretStatus": "active"})


def test_recover_dry_run_names_everything_with_the_prefix(sandbox):
    """With NAME_PREFIX set, the live instance, the default target, the cluster, the service,
    the seed task, the target group and the recovery tags all carry it, and nothing names ztdr."""
    result = _recover(sandbox, "--env", "dev", "--snapshot", "rds:acme-dr-dev-2026-11-05-03-12", NAME_PREFIX=_PREFIXED)
    assert result.returncode == 0, result.stderr
    assert _recover_calls(sandbox) == []
    out = result.stdout
    assert re.search(r"a new acme-dr-dev-recovered-\d{8}-\d{4}", out), out
    for wanted in ("--db-instance-identifier acme-dr-dev", "must be a snapshot of acme-dr-dev",
                   "--cluster acme-dr-dev --services acme-dr-dev-app", "tagged acme-dr-recovery-of=acme-dr-dev",
                   "acme-dr-recovery-source=snapshot:", "--task-definition acme-dr-dev-seed",
                   "--log-group-name /ecs/acme-dr-dev", "describe-target-groups (acme-dr-dev-ecs)"):
        assert wanted in out, wanted
    assert "ztdr" not in out, [line for line in out.splitlines() if "ztdr" in line]


def test_recover_real_run_names_everything_with_the_prefix(sandbox):
    result = _recover(sandbox, "--env", "dev", "--snapshot", "rds:acme-dr-dev-2026-11-05-03-12", "--target", _PREFIXED_TARGET,
                      "--execute", target_json=_prefixed_target_json(),
                      target_tags=[{"Key": "acme-dr-recovery-of", "Value": _PREFIXED_LIVE},
                                   {"Key": "acme-dr-recovery-source", "Value": "snapshot:rds:acme-dr-dev-2026-11-05-03-12"}],
                      NAME_PREFIX=_PREFIXED, LIVE_ID=_PREFIXED_LIVE,
                      live_json=_PREFIXED_LIVE_JSON)
    assert result.returncode == 0, result.stdout + result.stderr
    aws = [c[1:] for c in _calls(sandbox.log) if c[0] == "aws"]
    restore = next(c for c in aws if c[1] == "restore-db-instance-from-db-snapshot")
    assert _arg(restore, "--db-instance-identifier") == _PREFIXED_TARGET
    tags = {t["Key"]: t["Value"] for t in json.loads(_arg(restore, "--tags"))}
    assert tags["acme-dr-recovery-of"] == _PREFIXED_LIVE and "ztdr-recovery-of" not in tags
    for call in aws:
        if call[0] == "ecs" and "--cluster" in call:
            assert _arg(call, "--cluster") == _PREFIXED_LIVE, call
        if "--services" in call:
            assert _arg(call, "--services") == "acme-dr-dev-app", call
    assert _arg(next(c for c in aws if c[:2] == ["ecs", "run-task"]), "--task-definition") == "acme-dr-dev-seed"
    assert _arg(next(c for c in aws if c[:2] == ["logs", "get-log-events"]), "--log-group-name") == "/ecs/acme-dr-dev"
    query = _arg(next(c for c in aws if c[:2] == ["elbv2", "describe-target-groups"]), "--query")
    assert "TargetGroupName=='acme-dr-dev-ecs'" in query, query
    plan = next(c for c in _calls(sandbox.log) if c[0] == "terraform" and "plan" in c)
    assert "db_restored_instance_identifier=" + _PREFIXED_TARGET in plan
    assert not [c for c in aws if any("ztdr" in a for a in c)], "a call named the default prefix"


@pytest.mark.parametrize("prefix", ["Acme", "a--b", "-acme", "acme-", "a", "a" * 17, "acme_dr", "acme dr"],
                         ids=["uppercase", "double-hyphen", "leading-hyphen", "trailing-hyphen", "one-character",
                              "seventeen-characters", "underscore", "space"])
def test_recover_refuses_a_prefix_the_stack_would_refuse(sandbox, prefix):
    result = _recover(sandbox, "--env", "dev", "--latest", NAME_PREFIX=prefix)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "NAME_PREFIX must be the stack's name_prefix" in result.stderr
    assert _recover_calls(sandbox) == []


def test_recover_refuses_a_target_under_another_prefix(sandbox):
    """The default prefix's instances are not this deployment's when NAME_PREFIX names another."""
    result = _recover(sandbox, "--env", "dev", "--latest", "--target", "ztdr-dev-recovered-test", NAME_PREFIX=_PREFIXED)
    assert result.returncode == 2
    assert "--target must be acme-dr-dev-<suffix>" in result.stderr
    assert _recover_calls(sandbox) == []


def test_recover_verify_finds_the_target_group_by_its_exact_name(sandbox):
    """Another deployment's prefix may begin with this one's, so the target group is matched
    whole, never by a substring."""
    (sandbox.dir / "applied").touch()
    result = _recover(sandbox, "--env", "dev", "--phase", "verify", "--target", _RECOVER_TARGET, "--execute",
                      target_exists=True)
    assert result.returncode == 0, result.stdout + result.stderr
    groups = next(c[1:] for c in _calls(sandbox.log) if c[:3] == ["aws", "elbv2", "describe-target-groups"])
    query = _arg(groups, "--query")
    assert query == "TargetGroups[?TargetGroupName=='ztdr-dev-ecs'].TargetGroupArn | [0]", query


def _copied_tree(sandbox, backend_hcl):
    """The two scripts in a copy of the tree, with an empty dev stack beside them and, when
    asked, a backend.hcl in it, so a test does not depend on what the checkout holds."""
    tree = sandbox.dir / "tree"
    (tree / "scripts").mkdir(parents=True)
    for name in ("db-recover.sh", "db-recover-check.cjs"):
        shutil.copy2(SCRIPTS / name, tree / "scripts" / name)
    stack = tree / "infra" / "environments" / "dev"
    stack.mkdir(parents=True)
    if backend_hcl:
        (stack / "backend.hcl").write_text('bucket = "ztdr-dev-tfstate-123-us-east-1"\n')
    return str(tree / "scripts" / "db-recover.sh"), stack


@pytest.mark.parametrize("backend_hcl", [True, False], ids=["backend-hcl", "initialised-directory"])
def test_recover_initialises_terraform_with_the_stacks_backend(sandbox, backend_hcl):
    """The stacks' backend block is partial, the state bucket in an uncommitted backend.hcl.
    When that file is beside the stack, init reads it; without it, init keeps the backend the
    directory was initialised with. Plan and apply run in the same directory."""
    script, stack = _copied_tree(sandbox, backend_hcl)
    _recover(sandbox, "--help")
    dry = sandbox(script, "--env", "dev", "--latest", "--target", _RECOVER_TARGET)
    assert dry.returncode == 0, dry.stderr
    if backend_hcl:
        assert "init -input=false -backend-config=backend.hcl" in dry.stdout, dry.stdout
    else:
        assert "init -input=false (no backend.hcl" in dry.stdout, dry.stdout
    real = sandbox(script, *_RECOVER_RUN, env={"TARGET_HOST": _RECOVER_TARGET_HOST, "LIVE_HOST": _RECOVER_LIVE_HOST,
                                              "NEW_SECRET": _RECOVER_NEW_SECRET})
    assert real.returncode == 0, real.stdout + real.stderr
    terraform = [c for c in _calls(sandbox.log) if c[0] == "terraform"]
    init = next(c for c in terraform if "init" in c)
    assert ("-backend-config=backend.hcl" in init) is backend_hcl, init
    assert ("no backend.hcl in infra/environments/dev" in real.stdout) is not backend_hcl
    assert {c[1] for c in terraform} == {f"-chdir={stack}"}, terraform


def test_make_db_recover_passes_the_name_prefix():
    default = " ".join(_make_recover("ENV=dev", "LATEST=yes").stdout.split())
    assert "NAME_PREFIX='ztdr' scripts/db-recover.sh --env dev" in default, default
    given = " ".join(_make_recover("ENV=dev", "LATEST=yes", "NAME_PREFIX=acme-dr").stdout.split())
    assert "NAME_PREFIX='acme-dr' scripts/db-recover.sh --env dev" in given, given
    exported = " ".join(_make_recover("ENV=dev", "LATEST=yes", env={"NAME_PREFIX": "acme-dr"}).stdout.split())
    assert "NAME_PREFIX='acme-dr' scripts/db-recover.sh" in exported, "as for every other target, the shell's value counts"
