#!/bin/sh
# This container now starts as real root (see the Dockerfile: no `USER app` directive anymore) —
# specifically so this script can install the network-isolation iptables rule below, which
# genuinely needs root in this environment (confirmed live: CAP_NET_ADMIN granted via setcap was
# NOT sufficient for either the nft or legacy iptables backend here — both require actual uid 0
# for their respective kernel-level checks, a real kernel restriction, not a permissions
# oversight). This root phase is brief and does exactly one thing before dropping privileges —
# everything else this script does, and the long-running Node process itself, runs as `app`
# (uid 10000), never as root.
if [ "$(id -u)" = "0" ]; then
  # DROP_PRIVILEGES/SANDBOX_UID must match judge.js's own JUDGE_DROP_PRIVILEGES/JUDGE_SANDBOX_UID
  # constants — this runs before Node ever starts, so it can't just import judge.js's JS. Idempotent
  # (-C before -A) so a container restart never stacks duplicate rules. Never fatal: any failure
  # here is a loud warning, not a boot-blocking error — the platform must still come up (without
  # network isolation, same as before this existed) even if iptables is unavailable or misbehaves.
  if [ "$JUDGE_DROP_PRIVILEGES" = "true" ]; then
    SANDBOX_UID="${JUDGE_SANDBOX_UID:-10001}"
    if iptables-legacy -C OUTPUT -m owner --uid-owner "$SANDBOX_UID" -j DROP 2>/dev/null; then
      echo "entrypoint: network-isolation rule already present for uid $SANDBOX_UID"
    elif iptables-legacy -A OUTPUT -m owner --uid-owner "$SANDBOX_UID" -j DROP 2>/tmp/iptables-setup.err; then
      echo "entrypoint: network-isolation rule installed — outbound traffic from uid $SANDBOX_UID (sandbox) is now blocked"
    else
      echo "entrypoint: WARNING - failed to install network-isolation rule for uid $SANDBOX_UID: $(cat /tmp/iptables-setup.err 2>/dev/null)" >&2
    fi
    rm -f /tmp/iptables-setup.err
  fi

  # Drop to `app` for everything from here on, by re-executing this SAME script under the
  # dropped identity — the `id -u` check above is false on that re-entry, so this whole root-only
  # block is skipped the second time through and execution falls straight to the role-detection
  # logic below, now running as `app`. Deliberately does NOT add --no-new-privs here (unlike
  # judge.js's own setpriv usage one level down, for the sandbox-uid drop specifically): node's
  # own file capabilities (setuid/setgid/chown/fowner/kill, granted via the Dockerfile's setcap)
  # must still take effect on the exec below for the existing per-submission privilege-drop
  # mechanism to keep working — --no-new-privs here would block exactly that.
  exec setpriv --reuid=10000 --regid=10000 --clear-groups "$0" "$@"
fi

# Everything below this line always runs as `app` (uid 10000), never as root.
#
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
