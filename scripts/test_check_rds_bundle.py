"""Tests for check-rds-bundle.py: pin parsing, match, drift, and loud failures.

The module name has a hyphen, so it is loaded via importlib rather than a plain import.
The bundle fetch is replaced with a stub, so these run offline.
Run with: python3 -m pytest scripts/test_check_rds_bundle.py
"""

import hashlib
import http.client
import importlib.util
from pathlib import Path

import pytest

_MOD_PATH = Path(__file__).resolve().parent / "check-rds-bundle.py"
_spec = importlib.util.spec_from_file_location("check_rds_bundle", _MOD_PATH)
check_rds_bundle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_rds_bundle)

URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
BUNDLE = b"-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"
BUNDLE_SHA = hashlib.sha256(BUNDLE).hexdigest()


def _dockerfile(sha=BUNDLE_SHA, url=URL):
    return (
        "FROM scratch AS builder\n"
        "# Fetch the AWS RDS global CA bundle\n"
        f"ADD --checksum=sha256:{sha} \\\n"
        f"    {url} /rds-global-bundle.pem\n"
        "COPY app/ .\n"
    )


def _serve(body):
    def fetch(url):
        assert url == URL
        return body
    return fetch


def test_matching_pin_passes():
    ok, message = check_rds_bundle.check(_dockerfile(), fetch_bundle=_serve(BUNDLE))
    assert ok
    assert BUNDLE_SHA in message


def test_changed_bundle_fails_with_both_sums_and_refresh_command():
    changed = BUNDLE + b"-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n"
    ok, message = check_rds_bundle.check(_dockerfile(), fetch_bundle=_serve(changed))
    assert not ok
    assert BUNDLE_SHA in message
    assert hashlib.sha256(changed).hexdigest() in message
    assert f"curl -fsSL {URL} | shasum -a 256" in message


def test_missing_pin_fails():
    with pytest.raises(check_rds_bundle.PinError, match="found 0"):
        check_rds_bundle.check("FROM scratch\nCOPY app/ .\n", fetch_bundle=_serve(BUNDLE))


def test_two_pins_fail():
    with pytest.raises(check_rds_bundle.PinError, match="found 2"):
        check_rds_bundle.check(_dockerfile() + _dockerfile(), fetch_bundle=_serve(BUNDLE))


def test_non_https_url_fails():
    with pytest.raises(check_rds_bundle.PinError, match="not HTTPS"):
        check_rds_bundle.read_pin(_dockerfile(url=URL.replace("https", "http")))


def test_main_exit_codes(tmp_path, monkeypatch):
    path = tmp_path / "Dockerfile"
    path.write_text(_dockerfile())

    monkeypatch.setattr(check_rds_bundle, "fetch", _serve(BUNDLE))
    assert check_rds_bundle.main(["x", str(path)]) == 0

    monkeypatch.setattr(check_rds_bundle, "fetch", _serve(b"other"))
    assert check_rds_bundle.main(["x", str(path)]) == 1

    def unreachable(url):
        raise OSError("connection refused")
    monkeypatch.setattr(check_rds_bundle, "fetch", unreachable)
    assert check_rds_bundle.main(["x", str(path)]) == 2

    def truncated(url):
        raise http.client.IncompleteRead(b"partial", 100)
    monkeypatch.setattr(check_rds_bundle, "fetch", truncated)
    assert check_rds_bundle.main(["x", str(path)]) == 2

    path.write_text("FROM scratch\n")
    assert check_rds_bundle.main(["x", str(path)]) == 2

    path.write_bytes(b"FROM scratch\n# \xff\n")
    assert check_rds_bundle.main(["x", str(path)]) == 2


class _Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


def test_fetch_retries_a_dropped_transfer(monkeypatch):
    calls = []

    def urlopen(url, timeout):
        calls.append(url)
        if len(calls) < 3:
            raise http.client.IncompleteRead(b"partial", 100)
        return _Response(BUNDLE)

    monkeypatch.setattr(check_rds_bundle.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(check_rds_bundle.time, "sleep", lambda s: None)
    assert check_rds_bundle.fetch(URL) == BUNDLE
    assert len(calls) == 3


def test_fetch_gives_up_after_three_attempts(monkeypatch):
    calls = []

    def urlopen(url, timeout):
        calls.append(url)
        raise OSError("connection reset")

    monkeypatch.setattr(check_rds_bundle.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(check_rds_bundle.time, "sleep", lambda s: None)
    with pytest.raises(OSError):
        check_rds_bundle.fetch(URL)
    assert len(calls) == 3


def test_committed_dockerfile_has_one_https_pin():
    # Guards the parser against a reformatted ADD line, which would otherwise
    # surface only as a red scheduled run.
    dockerfile = Path(__file__).resolve().parent.parent / "Dockerfile"
    sha, url = check_rds_bundle.read_pin(dockerfile.read_text())
    assert url == URL
    assert len(sha) == 64
