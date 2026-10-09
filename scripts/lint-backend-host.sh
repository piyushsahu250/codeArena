#!/usr/bin/env bash
# Runs oxlint over the backend source (Node environment) on the AWS host. A variable that is used but never declared only fails when that line runs, i.e. as a
# 500 for the one request that reaches it, so this finds them before a student does. Output: /tmp/oxlint-backend.txt and a summary.
set -uo pipefail
REPO=/opt/codearena
WORK=/root/lint-backend
cd "$REPO"
rm -rf "$WORK" && mkdir -p "$WORK" && cp -r backend/src "$WORK/src" && cp -r backend/scripts "$WORK/scripts"
printf "%s" '{"env":{"node":true,"es2022":true},"globals":{"fetch":"readonly","AbortSignal":"readonly","URL":"readonly","URLSearchParams":"readonly","TextEncoder":"readonly","TextDecoder":"readonly","Blob":"readonly","structuredClone":"readonly","performance":"readonly"}}' > "$WORK/.oxlintrc.json"
docker run --rm -v "$WORK":/app -w /app node:22-slim sh -c "npx --yes oxlint@latest -c .oxlintrc.json -D correctness -D no-undef src scripts --format=unix 2>&1" > /tmp/oxlint-backend.txt 2>&1
echo "== last lines"; tail -3 /tmp/oxlint-backend.txt
echo "== findings by rule"
grep -oE '\[(Error|Warning)/[a-z0-9_:()-]+\]' /tmp/oxlint-backend.txt | sort | uniq -c | sort -rn | head -15
echo "== no-undef"
grep 'no-undef' /tmp/oxlint-backend.txt | head -60
echo "== other errors (first 40)"
grep '\[Error/' /tmp/oxlint-backend.txt | grep -v 'no-undef' | head -40
