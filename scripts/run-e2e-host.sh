#!/usr/bin/env bash
# Browser E2E run on the AWS host (as root, normally via `aws ssm send-command`). Everything stays on localhost:
#   1. build the SPA from /opt/codearena/frontend (no VITE_API_URL -> it talks to http://localhost:4000/api, the local container)
#   2. seed disposable accounts + a published test with backend/scripts/e2eSeed.js (removed again on exit, even if the run fails)
#   3. run the Playwright suite (frontend/e2e) in the official Playwright image against `vite preview` on localhost:5173
# Exit code is Playwright's. Results: /tmp/e2e-results.json, failure screenshots in /root/e2e-run/test-results.
set -uo pipefail
REPO=/opt/codearena
BUILD=/root/chk5/frontend
RUN=/root/e2e-run
PW_IMAGE=mcr.microsoft.com/playwright:v1.49.1-jammy
cd "$REPO"

echo "== build SPA"
rm -rf "$BUILD/src" && cp -r frontend/src "$BUILD/src" && cp frontend/index.html frontend/package.json frontend/vite.config.js "$BUILD/" 2>/dev/null
rm -rf "$BUILD/public" && cp -r frontend/public "$BUILD/public" 2>/dev/null || true
docker run --rm -v "$BUILD":/app -w /app node:22-slim sh -c 'npm run build 2>&1 | grep -iE "error|built in"' || { echo "build failed"; exit 3; }

echo "== seed disposable accounts"
rm -rf "$RUN" && mkdir -p "$RUN" && cp -r frontend/e2e/. "$RUN/"
trap 'echo "== cleanup"; docker exec codearena-backend node scripts/e2eSeed.js --cleanup' EXIT
docker cp backend/scripts/e2eSeed.js codearena-backend:/app/scripts/e2eSeed.js
docker exec codearena-backend node scripts/e2eSeed.js --seed > "$RUN/users.json" || { echo "seed failed"; exit 4; }

echo "== playwright"
docker run --rm --network host --ipc=host -v "$BUILD":/app -v "$RUN":/e2e -e E2E_USERS_JSON=/e2e/users.json -e E2E_ARGS="${E2E_ARGS:-}" "$PW_IMAGE" bash -c '
  cd /app && (npx vite preview --port 5173 --strictPort --host 127.0.0.1 > /tmp/preview.log 2>&1 &)
  for i in $(seq 1 30); do curl -fs http://127.0.0.1:5173/ >/dev/null && break; sleep 1; done
  cd /e2e && npm install --no-audit --no-fund --silent && npx playwright test $E2E_ARGS'
CODE=$?
cp "$RUN/results.json" /tmp/e2e-results.json 2>/dev/null || true
exit $CODE
