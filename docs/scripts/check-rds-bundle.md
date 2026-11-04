# check-rds-bundle

**Script:** `scripts/check-rds-bundle.py` · **Make target:** `make check-rds-bundle` · **Schedule:** on demand, and weekly in the RDS CA bundle pin gate

## Purpose

The Dockerfile downloads the AWS RDS global CA bundle with `ADD --checksum=sha256:…`, so the build trusts only the bundle it was pinned to. AWS republishes the bundle when a Region adds roots, and from then on every image build fails at that step with a digest mismatch. Without this check, the first sign is a broken `make container-up` or release build.

This compares the pinned checksum with the bundle AWS serves today and fails when they differ, printing both checksums and the command to print the new one.

## Usage

```bash
make check-rds-bundle                           # checks ./Dockerfile
python3 scripts/check-rds-bundle.py Dockerfile  # same, any path
```

Needs network access to `truststore.pki.rds.amazonaws.com`. No Docker, no credentials.

On macOS with the python.org installer, Python can't verify HTTPS until its certificates are installed, and the check exits 2 with `CERTIFICATE_VERIFY_FAILED`. Run `Install Certificates.command` from the Python folder in Applications, or point `SSL_CERT_FILE` at a CA bundle.

## When it fails

Do not just paste the new checksum. Review the new bundle first, then move the pin:

1. Download the bundle and confirm every certificate is a self-signed root CA (`CA:TRUE`).
2. Compare it with the previous bundle and list the roots added and removed in the PR. The previous bundle is no longer served; the Internet Archive keeps copies (`web.archive.org/web/<timestamp>id_/<bundle URL>`), or extract `/etc/ssl/rds-global-bundle.pem` from the last image built.
3. Confirm the `us-east-1` roots the app's RDS instance uses are unchanged.
4. Update the checksum in the Dockerfile, and build the runner image.

## Exit semantics

- `0`: the pin matches the live bundle.
- `1`: the bundle has changed; both checksums and the refresh command go to stderr.
- `2`: the Dockerfile has no single HTTPS `ADD --checksum` line for the bundle, or the file could not be read, or the bundle could not be fetched in three attempts (a dropped transfer is retried, and never reported as drift).

## Notes

- `scripts/test_check_rds_bundle.py` covers the parser, match, drift, and exit codes with a stubbed fetch, and checks that the committed Dockerfile still parses. It runs in `make ci-test-python`.
