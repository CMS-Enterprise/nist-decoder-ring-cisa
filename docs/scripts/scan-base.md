# scan-base

**Script:** `scripts/scan-base.sh` · **Make target:** `make scan-base`

## Purpose

Scan every base image the `Dockerfile` pins by digest, against the scan policy in `trivy.yaml`, in seconds and without building an image. A fixed HIGH or CRITICAL CVE in the runner's base fails the release image's own scan (`container-scan`, and the gate in `ecr-build-push`), which comes only after a full build; this check finds it first, from the digests alone. It holds the build stages' base to the same policy, although that image does not ship.

`make pre-push` runs it before the code checks, and step 2 of the release steps in `app/README.dev.md` runs it when a release branch is cut. A CI runner can run it only with a `dhi.io` login, which `.github/workflows-export/gates.yml` gives the image jobs alone.

## Usage

```bash
docker login dhi.io     # once per machine, as for a build
make scan-base
```

To check another file, run the script directly: `scripts/scan-base.sh path/to/Dockerfile`. `PLATFORM` names the platform scanned in each multi-platform base (default `linux/arm64`, what ECS runs) and `TRIVY_CONFIG` the policy file (default `trivy.yaml`).

## What it does

It reads every `FROM` line. A line that names an earlier stage, or `scratch`, has nothing to scan. Every other base must be pinned by digest. Each pinned base is then scanned for `linux/arm64` with `trivy image --config trivy.yaml`, and each is a gate: the runner's base, and the `-dev` base that `base`, `deps`, `builder`, `prod-deps` and `development` build on. A finding the policy fails, in any of them, fails the run. A finding assessed as not reachable is recorded in `security/vex.openvex.json`, with its evidence, and then shows under Suppressed Vulnerabilities instead.

Every base is scanned before the exit status is decided, so one run lists everything.

## Exit semantics

- `0`: every pinned base passes the policy.
- `1`: a base has a finding the policy fails; a base could not be scanned at all (most often a missing `docker login dhi.io`); a base is named by tag rather than digest; or no `FROM` line pins a digest.

A fixed CVE in a base is cleared by moving the pin: `make refresh-image-digests`, then `make container-scan` to scan the image built on it.

## Notes

- The scan policy, the VEX file, and the statements in it with their evidence are in [`docs/testing.md`](../testing.md#image-scans).
- `scripts/test_shell_scripts.py` runs the script with `trivy` stubbed: that every pinned base is scanned with the policy and nothing else, that a failure in either base fails the run only after every base is scanned, and the three refusals. It runs in `make ci-test-python` and `make test-scripts`.
