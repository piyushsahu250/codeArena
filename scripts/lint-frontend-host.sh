#!/usr/bin/env bash
# Runs oxlint over the frontend source on the AWS host (no Node needed locally). Output: /tmp/oxlint.txt (one finding per line) and a summary on stdout.
# The summary counts findings by rule and lists every "no-undef" (a variable used but never declared -- the class of bug that blanked the lesson page).
set -uo pipefail
REPO=/opt/codearena
BUILD=/root/chk5/frontend
cd "$REPO"
rm -rf "$BUILD/src" && cp -r frontend/src "$BUILD/src"
docker run --rm -v "$BUILD":/app -w /app node:22-slim sh -c "npx --yes oxlint@latest src --format=unix 2>&1" > /tmp/oxlint.txt 2>&1
echo "== last lines"; tail -4 /tmp/oxlint.txt
echo "== findings by rule"
grep -oE '\[(Error|Warning)/[a-z0-9_:-]+\]' /tmp/oxlint.txt | sort | uniq -c | sort -rn | head -20
echo "== no-undef"
grep 'no-undef' /tmp/oxlint.txt | head -40
echo "== errors (not warnings), first 40"
grep '\[Error/' /tmp/oxlint.txt | head -40
