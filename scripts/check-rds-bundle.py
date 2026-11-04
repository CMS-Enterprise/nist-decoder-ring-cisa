#!/usr/bin/env python3
# Docs: docs/scripts/check-rds-bundle.md
"""
Compare the RDS CA bundle checksum pinned in the Dockerfile with the bundle AWS
serves today.

The Dockerfile fetches the RDS global CA bundle with `ADD --checksum=sha256:...`,
so a bundle AWS republishes (a new Region adds roots) fails every image build at
that step. This check reports the new checksum before a build trips on it, so the
pin moves deliberately: review the new bundle, then update the pin.

Exit 0 when the pin matches, 1 when the bundle has changed, 2 when the pin
cannot be read from the Dockerfile or the bundle cannot be fetched in three
attempts. A failed fetch must not exit 1: that would report drift.

Run via: make check-rds-bundle   (meant to run weekly in CI)
"""

import hashlib
import http.client
import re
import sys
import time
import urllib.request

DOCKERFILE = "Dockerfile"
FETCH_ATTEMPTS = 3

# ADD --checksum=sha256:<64 hex> \
#     https://.../global-bundle.pem /rds-global-bundle.pem
PIN_RE = re.compile(
    r"^ADD\s+--checksum=sha256:([0-9a-f]{64})\s*\\\s*\n\s*(\S+global-bundle\.pem)\s",
    re.MULTILINE,
)


class PinError(Exception):
    """The Dockerfile pin is missing, ambiguous, or does not point at HTTPS."""


def read_pin(dockerfile_text):
    """Return (sha256, url) for the single RDS bundle ADD line."""
    pins = PIN_RE.findall(dockerfile_text)
    if len(pins) != 1:
        raise PinError(f"expected one RDS bundle ADD --checksum line, found {len(pins)}")
    sha, url = pins[0]
    if not url.startswith("https://"):
        raise PinError(f"the pinned bundle URL is not HTTPS: {url}")
    return sha, url


def fetch(url):
    # The host sometimes closes the connection mid-body (IncompleteRead), so a
    # weekly run retries rather than failing on one dropped transfer.
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return resp.read()
        except (OSError, http.client.HTTPException):
            if attempt == FETCH_ATTEMPTS:
                raise
            time.sleep(2 * attempt)


def check(dockerfile_text, fetch_bundle=None):
    """Return (ok, message). Raises PinError, or the fetch's own error."""
    pinned, url = read_pin(dockerfile_text)
    served = hashlib.sha256((fetch_bundle or fetch)(url)).hexdigest()
    if served == pinned:
        return True, f"RDS CA bundle pin is current: sha256:{pinned}"
    return False, (
        "RDS CA bundle has changed upstream.\n"
        f"  pinned in Dockerfile: sha256:{pinned}\n"
        f"  served by AWS now:    sha256:{served}\n"
        f"  bundle: {url}\n"
        "Review the new bundle before moving the pin: it must hold only root CAs, and\n"
        "the PR lists the roots added and removed. Then set the new checksum in the\n"
        "Dockerfile. To print it:\n"
        f"  curl -fsSL {url} | shasum -a 256"
    )


def main(argv):
    path = argv[1] if len(argv) > 1 else DOCKERFILE
    try:
        with open(path, encoding="utf-8") as f:
            ok, message = check(f.read())
    except PinError as e:
        print(f"{path}: {e}", file=sys.stderr)
        return 2
    except (OSError, http.client.HTTPException) as e:
        print(f"Could not read {path} or fetch the bundle: {e!r}", file=sys.stderr)
        return 2
    print(message, file=sys.stdout if ok else sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
