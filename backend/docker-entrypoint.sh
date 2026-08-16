#!/bin/sh
# Auto-detects which role this container is running as, via env vars Cloud Run sets
# automatically (never set on Render, so Render's behavior is completely unchanged):
#   CLOUD_RUN_JOB - set only when running as the Cloud Run Job (migration/backfill/seed)
#   K_SERVICE     - set only when running as a Cloud Run Service revision (the API server)
# This lets one Docker image serve as the Cloud Run Service, the Cloud Run migration Job, AND
# the existing Render deployment (kept as a rollback target) with zero external command
# overrides needed and zero behavior change on Render.
if [ -n "$CLOUD_RUN_JOB" ]; then
  # Cloud Run Job: apply migrations/backfills/seed once per deploy, then exit.
  exec sh scripts/migrateAndSeed.sh
elif [ -n "$K_SERVICE" ]; then
  # Cloud Run Service: the Job step already applied migrations for this deploy — just start
  # the API server, fast, safe to cold-start repeatedly.
  exec npm start
else
  # Render (or anywhere else with no separate Job concept): original behavior, unchanged —
  # apply migrations/backfills/seed, then start the server, every boot.
  sh scripts/migrateAndSeed.sh && exec npm start
fi
