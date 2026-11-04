#!/usr/bin/env bash
# Docs: docs/scripts/refresh-image-digests.md
#
# Re-pin each dhi.io base image in the Dockerfile to the digest its tag points
# at today. This is a manual update, and it needs DHI login credentials: run
# `docker login dhi.io` first. Dependabot cannot do it until a dhi.io
# credential exists as a Dependabot secret (see the placeholder registry in
# .github/dependabot.yml).
set -euo pipefail

FILE="${1:-Dockerfile}"
# grep exits 1 when nothing matches, which pipefail would turn into a silent exit before
# the message below; no match is an answer here, not an error.
refs=$({ grep -oE '^FROM dhi\.io/[^ @]+' "$FILE" || [ $? -eq 1 ]; } | awk '{print $2}' | sort -u)
if [ -z "$refs" ]; then
  echo "No dhi.io FROM lines in $FILE." >&2
  exit 1
fi

changed=0
for ref in $refs; do
  digest=$(docker buildx imagetools inspect "$ref" --format '{{json .Manifest.Digest}}' 2>/dev/null | tr -d '"' || true)
  if ! printf '%s' "$digest" | grep -qE '^sha256:[0-9a-f]{64}$'; then
    echo "Could not resolve $ref: check the tag exists and that this shell has run docker login dhi.io." >&2
    exit 1
  fi
  result=$(python3 - "$FILE" "$ref" "$digest" <<'PY'
import re, sys
path, ref, digest = sys.argv[1:]
text = open(path, encoding="utf-8").read()
pattern = re.compile(re.escape(ref) + r"@(sha256:[0-9a-f]{64})")
found = pattern.findall(text)
if not found:
    sys.exit(f"{ref} has no pinned digest in {path}; pin it by hand once.")
if set(found) == {digest}:
    print("unchanged")
else:
    open(path, "w", encoding="utf-8").write(pattern.sub(f"{ref}@{digest}", text))
    print(f"{found[0]} -> {digest}")
PY
)
  echo "  $ref  $result"
  [ "$result" = "unchanged" ] || changed=1
done

if [ "$changed" -eq 1 ]; then
  echo "Digests updated in $FILE. Rebuild (make container-build) before committing."
else
  echo "All dhi.io digests in $FILE are current."
fi
