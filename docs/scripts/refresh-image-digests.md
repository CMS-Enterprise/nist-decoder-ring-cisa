# refresh-image-digests

**Script:** `scripts/refresh-image-digests.sh` · **Make target:** `make refresh-image-digests`

## Purpose

The Dockerfile pins its two base images by tag and digest (`dhi.io/node:24-alpine3.22-dev@sha256:…` and `dhi.io/node:24-alpine3.22@sha256:…`), so a moved tag cannot change what a build pulls. Docker Hardened Images publishes fixes by moving those tags, so a pinned digest only picks up a base-image fix when someone re-pins it.

Moving these pins is a manual update today, and it needs DHI login credentials. Dependabot cannot do it: `dhi.io` requires a login, and the `registries:` block in `.github/dependabot.yml` is a commented placeholder: this repository holds no `dhi.io` credential, so this script is how the pins move. A fork with its own `dhi.io` access can hand the job to Dependabot (see the last note below).

## Usage

```bash
docker login dhi.io          # Docker ID and password, or an access token
make refresh-image-digests   # rewrites the Dockerfile if a tag has moved
make container-build         # rebuild against the new digests before committing
```

Run it before building a release image. To check another file, pass its path: `./scripts/refresh-image-digests.sh path/to/Dockerfile`.

## What it does

For each distinct `FROM dhi.io/<image>:<tag>` in the file, it asks the registry for the digest the tag points at now (`docker buildx imagetools inspect`), then rewrites every `<image>:<tag>@sha256:…` occurrence to that digest. Each image prints `unchanged` or `old -> new`.

## Exit semantics

- `0`: every digest is current, or the file was rewritten.
- `1`: a tag could not be resolved (the tag does not exist, or the shell has not run `docker login dhi.io`), the file has no `dhi.io` FROM lines, or an image carries no digest to replace. Nothing is written for that image.

## Notes

- The digest is the multi-platform index digest, so one pin covers both `linux/arm64` (what ECS runs) and `linux/amd64`.
- `docker-compose.yml`'s Postgres image is public on Docker Hub; Dependabot's `docker-compose` entry keeps it current within Postgres 16.
- This repository holds no `dhi.io` login. A fork that has one stores it as `DHI_USERNAME` / `DHI_PASSWORD` for both Actions and Dependabot; uncommenting the placeholder `registries:` block, and the commented `registries:` lines in the `docker` entry, then lets Dependabot take this over.
- `scripts/test_shell_scripts.py` runs this script with `docker` stubbed: a moved tag rewrites only its pin, a current file is left byte-identical, and an unpinned image or a Dockerfile with no `dhi.io` image exits 1 without touching the file. An unresolvable tag exits 1 too, but the script rewrites each image as it resolves it, in sorted order, so images before the unresolvable one may already be rewritten; check `git diff` before retrying. It runs in `make ci-test-python` and `make test-scripts`.
