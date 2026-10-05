#!/usr/bin/env bash
# Deploys the backend on the AWS EC2 host (run ON the instance, as root -- normally via
# `aws ssm send-command`, see docs/DEPLOYMENT.md). Replaces a sequence of hand-typed commands that
# had already drifted from what was actually running once (docs described flags the live container
# didn't have, and omitted ones it needed).
#
# What it does, in order:
#   1. fast-forward /opt/codearena to origin/main
#   2. tag the CURRENT image as a rollback checkpoint, then build the new one with its git commit
#      baked in (surfaced by GET /api/health -> "commit", the only reliable "what's deployed" signal)
#   3. swap the container using the exact run flags the platform needs (see docs/DEPLOYMENT.md for why
#      each one exists -- don't drop any)
#   4. wait for a healthy response; if it never comes, automatically restore the previous image
#
# Exit code is non-zero if the new version was NOT left running healthy.
set -euo pipefail

REPO=/opt/codearena
ENV_FILE="$REPO/container.env"
NAME=codearena-backend
STAMP=$(date +%Y%m%d%H%M%S)

cd "$REPO"
git pull --ff-only origin main
SHA=$(git rev-parse --short HEAD)
echo "Deploying commit $SHA"

PREV_IMAGE_ID=$(docker image inspect -f '{{.Id}}' "$NAME:latest" 2>/dev/null || true)
if [ -n "$PREV_IMAGE_ID" ]; then
  docker tag "$PREV_IMAGE_ID" "$NAME:rollback-$STAMP"
  echo "Rollback checkpoint: $NAME:rollback-$STAMP"
fi

docker build --build-arg COMMIT_SHA="$SHA" -t "$NAME:latest" backend

run_container() {
  docker run -d --name "$NAME" --restart unless-stopped \
    --pids-limit=512 \
    --cap-add=NET_ADMIN \
    -p 127.0.0.1:4000:4000 \
    --env-file "$ENV_FILE" \
    --mount source=codearena-backend-logs,target=/app/logs \
    "$1" >/dev/null
}

# Boot re-runs the migrate/seed chain (~20-30s) before the server listens, so poll rather than
# checking once.
wait_healthy() {
  local out
  for _ in $(seq 1 24); do
    out=$(curl -fs http://127.0.0.1:4000/api/health 2>/dev/null || true)
    case "$out" in *'"status":"ok"'*) echo "$out"; return 0 ;; esac
    sleep 5
  done
  return 1
}

docker stop "$NAME" >/dev/null 2>&1 || true
docker rm "$NAME" >/dev/null 2>&1 || true
run_container "$NAME:latest"

if health=$(wait_healthy) && [[ "$health" == *"$SHA"* ]]; then
  echo "Deployed $SHA and healthy: $health"
  exit 0
fi

echo "New version did not come up healthy reporting commit $SHA -- rolling back." >&2
docker logs --tail 40 "$NAME" >&2 || true
docker rm -f "$NAME" >/dev/null 2>&1 || true
if [ -n "$PREV_IMAGE_ID" ]; then
  run_container "$NAME:rollback-$STAMP"
  if wait_healthy >/dev/null; then
    echo "Rolled back to the previous image; it is healthy." >&2
  else
    echo "ROLLBACK IMAGE IS ALSO UNHEALTHY -- manual intervention required." >&2
  fi
fi
exit 1
