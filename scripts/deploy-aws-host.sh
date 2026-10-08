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
#   2b. SCHEMA GUARD: refuse to deploy if the new schema would drop/alter-type live columns or tables (see below)
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

# 2b. SCHEMA GUARD -- the container applies schema changes with `prisma db push --accept-data-loss` on every boot (there is no migrations
# history), and rolling the IMAGE back does not undo a column/table that boot already dropped. So before the old container is touched,
# diff the live database against the new schema (read-only) and refuse to continue if it would drop a table/column/enum or change a
# column type. Index changes and additive changes (new tables/columns/indexes) pass. The manually managed trigram search indexes
# (scripts/addSearchIndexes.js) legitimately show as DROP INDEX and are ignored. Override deliberately with ALLOW_DESTRUCTIVE_SCHEMA=1.
echo "Schema guard: comparing the new schema with the live database (read-only)..."
if ! DIFF=$(docker run --rm --env-file "$ENV_FILE" --entrypoint sh "$NAME:latest" -c 'npx prisma migrate diff --from-url "$DIRECT_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script' 2>/tmp/schema-guard.err); then
  echo "Schema guard could not run (see below). Refusing to deploy; the running version is untouched." >&2
  cat /tmp/schema-guard.err >&2
  exit 2
fi
DESTRUCTIVE=$(printf '%s\n' "$DIFF" | grep -v '^--' | grep -iE 'DROP TABLE|DROP COLUMN|DROP TYPE|ALTER COLUMN .* TYPE' || true)
if [ -n "$DESTRUCTIVE" ]; then
  echo "Schema guard: this deploy would make DESTRUCTIVE schema changes to the live database:" >&2
  printf '%s\n' "$DESTRUCTIVE" >&2
  if [ "${ALLOW_DESTRUCTIVE_SCHEMA:-0}" != "1" ]; then
    echo "Refusing to deploy. Take a backup, then re-run with ALLOW_DESTRUCTIVE_SCHEMA=1 if this is intended. The running version is untouched." >&2
    exit 2
  fi
  echo "ALLOW_DESTRUCTIVE_SCHEMA=1 is set -- continuing." >&2
else
  echo "Schema guard: no destructive changes ($(printf '%s\n' "$DIFF" | grep -vc '^--\|^$' || true) statements, additive/index only)."
fi

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
