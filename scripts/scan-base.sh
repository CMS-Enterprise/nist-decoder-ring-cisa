#!/usr/bin/env bash
# Docs: docs/scripts/scan-base.md
#
# Scan every base image the Dockerfile pins by digest, against the policy in trivy.yaml,
# without building anything. Each base is a gate, the runner's and the build stages' alike:
# a HIGH or CRITICAL CVE with a fix that security/vex.openvex.json does not record as not
# affecting the image fails the run. Every base is scanned before the exit status is
# decided, so one run lists everything.
#
# Usage: scripts/scan-base.sh [Dockerfile]
#   PLATFORM      the platform to scan in each multi-platform base (default linux/arm64, what ECS runs)
#   TRIVY_CONFIG  the scan policy (default trivy.yaml)
set -euo pipefail

FILE="${1:-Dockerfile}"
PLATFORM="${PLATFORM:-linux/arm64}"
CONFIG="${TRIVY_CONFIG:-trivy.yaml}"

[ -f "$FILE" ] || { echo "❌ No $FILE to read." >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "❌ No scan policy at $CONFIG." >&2; exit 1; }

# One line per pinned base: <image@sha256:digest> <stages using it>. A FROM that names an
# earlier stage, or scratch, has nothing to scan. Any other FROM without a digest is
# refused: a tag can move, so a scan of it says nothing about the next build.
plan=$(python3 -I - "$FILE" <<'PY'
import re, sys
path = sys.argv[1]
line_re = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$", re.I)
pinned = re.compile(r"^\S+@sha256:[0-9a-f]{64}$")
stages, bases, unpinned = set(), {}, []
for number, line in enumerate(open(path, encoding="utf-8"), 1):
    m = line_re.match(line)
    if not m:
        continue
    image, stage = m[1], (m[2] or "").lower()
    if image.lower() in stages or image.lower() == "scratch":
        pass
    elif pinned.match(image):
        bases.setdefault(image, []).append(stage or f"line {number}")
    else:
        unpinned.append(f"{path}:{number}: {image}")
    if stage:
        stages.add(stage)
if unpinned:
    sys.exit("❌ Not pinned by digest, so a scan of it says nothing about the next build:\n  " + "\n  ".join(unpinned))
if not bases:
    sys.exit(f"❌ No FROM line in {path} pins a base image by digest; nothing to scan.")
for image, stages_ in bases.items():
    print(image, ",".join(stages_))
PY
)

failed=0
while read -r image stages; do
  echo "🔍 $image (stage $stages)"
  trivy image --config "$CONFIG" --platform "$PLATFORM" "$image" || failed=1
done <<< "$plan"

if [ "$failed" -ne 0 ]; then
  echo "❌ A base image failed the scan, or could not be scanned (has this shell run docker login dhi.io?)." >&2
  echo "   A fixed CVE in a base means re-pinning it: make refresh-image-digests, then make container-scan." >&2
  echo "   A finding assessed as not reachable goes in security/vex.openvex.json, with its evidence (docs/testing.md)." >&2
  exit 1
fi
echo "✅ Every pinned base image passes the scan policy in $CONFIG."
