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

# Pre-deploy gate: a variable that is used but never declared only fails when that line runs (a 500 for the one request that reaches it), so it is
# caught here instead. If the linter itself cannot run (no network), the deploy is not blocked.
echo "Pre-deploy gate: undefined variables in backend code..."
bash "$REPO/scripts/lint-backend-host.sh" > /tmp/lint-backend-gate.out 2>&1 || true
if grep -q 'no-undef' /tmp/oxlint-backend.txt 2>/dev/null; then
  echo "ABORTING deploy: undefined variables found in backend code:" >&2
  grep 'no-undef' /tmp/oxlint-backend.txt | head -20 >&2
  exit 6
fi

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

# Separate judge service (optional, switched by JUDGE_REMOTE_ENABLED=1 in container.env). The API and the judge are two containers of the SAME
# image on a private docker network: the judge (JUDGE_ROLE=server, no database access, own CPU/memory limits) executes student code and the API
# calls it over HTTP with an HMAC-signed request. With the flag off, no judge container exists and code runs in-process as before; if the judge is
# unreachable the API falls back to running code in-process (utils/judgeGateway.js).
NETWORK=codearena-net
JUDGE_NAME=codearena-judge
env_value() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | tr -d '\015'; }
JUDGE_REMOTE=$(env_value JUDGE_REMOTE_ENABLED)
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
if [ "$JUDGE_REMOTE" = "1" ] && [ -z "$(env_value JUDGE_SHARED_SECRET)" ]; then
  echo "JUDGE_SHARED_SECRET=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$ENV_FILE"
  echo "Generated JUDGE_SHARED_SECRET in $ENV_FILE"
fi

run_judge() {
  grep -E '^JUDGE_' "$ENV_FILE" | grep -vE '^JUDGE_(REMOTE_ENABLED|URL|CONCURRENCY|MAX_QUEUE_SIZE)=' > /tmp/judge.env
  docker run -d --name "$JUDGE_NAME" --restart unless-stopped --network "$NETWORK" \
    --pids-limit=512 --cap-add=NET_ADMIN --cpus="${JUDGE_CPUS:-1.6}" --memory="${JUDGE_MEMORY:-3g}" \
    --env-file /tmp/judge.env -e JUDGE_ROLE=server \
    -e JUDGE_CONCURRENCY="${JUDGE_SERVER_CONCURRENCY:-2}" -e JUDGE_MAX_QUEUE_SIZE="${JUDGE_SERVER_QUEUE:-200}" \
    "$1" >/dev/null
  rm -f /tmp/judge.env
}
wait_judge_healthy() {
  for _ in $(seq 1 20); do
    docker exec "$JUDGE_NAME" node -e "fetch('http://localhost:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

docker rm -f "$JUDGE_NAME" >/dev/null 2>&1 || true
JUDGE_ARGS=()
if [ "$JUDGE_REMOTE" = "1" ]; then
  run_judge "$NAME:latest"
  if wait_judge_healthy; then
    echo "Judge service is up ($JUDGE_NAME)."
    # the API only queues behind the judge service now, so its own in-process limit is lifted to a safety ceiling
    JUDGE_ARGS=(-e "JUDGE_URL=http://$JUDGE_NAME:4100" -e "JUDGE_CONCURRENCY=${JUDGE_API_CONCURRENCY:-64}" -e "JUDGE_MAX_QUEUE_SIZE=${JUDGE_API_QUEUE:-400}")
  else
    echo "WARNING: the judge service did not become healthy; the API will run code in-process." >&2
    docker logs --tail 20 "$JUDGE_NAME" >&2 || true
    docker rm -f "$JUDGE_NAME" >/dev/null 2>&1 || true
  fi
fi

run_container() {
  docker run -d --name "$NAME" --restart unless-stopped --network "$NETWORK" \
    --pids-limit=512 \
    --cap-add=NET_ADMIN \
    -p 127.0.0.1:4000:4000 \
    --env-file "$ENV_FILE" \
    "${JUDGE_ARGS[@]}" \
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
