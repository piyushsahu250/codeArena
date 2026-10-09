#!/usr/bin/env bash
# Runs the named backend verification scripts one after another inside the API container on the AWS host and prints a one-line result per script.
# Usage: bash scripts/run-verifies-host.sh verifyA verifyB ...   Output also in /tmp/verifies.txt. Each script uses disposable data and cleans up after itself.
set -uo pipefail
cd /opt/codearena
: > /tmp/verifies.txt
for name in "$@"; do
  docker cp "backend/scripts/$name.js" "codearena-backend:/app/scripts/$name.js" 2>/dev/null
  out=$(timeout 300 docker exec codearena-backend node "scripts/$name.js" 2>&1); code=$?
  fails=$(echo "$out" | grep -cE '^FAIL|FAILED|✗|AssertionError')
  last=$(echo "$out" | grep -v '^$' | tail -1 | cut -c1-110)
  echo "$name exit=$code failLines=$fails | $last" | tee -a /tmp/verifies.txt
  echo "$out" > "/tmp/verify-$name.log"
  sleep 3
done
echo "== done"
