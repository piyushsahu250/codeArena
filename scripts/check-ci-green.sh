#!/usr/bin/env bash
# Release gate: succeeds only if every required CI check passed for the given commit. Used by scripts/deploy-aws-host.sh so a commit whose CI is red, still
# running, cancelled or missing is not deployed to production. Reads GitHub's public check-runs API (the repository is public; no token needed).
#   scripts/check-ci-green.sh <commit-sha> [owner/repo]
# Exit 0 = all required checks green. Exit 1 = not green (the reason is printed). Exit 2 = could not ask GitHub.
set -uo pipefail
SHA="${1:?usage: check-ci-green.sh <commit-sha> [owner/repo]}"
REPO="${2:-piyushsahu250/codeArena}"
REQUIRED="${CI_REQUIRED_CHECKS:-lint backend frontend integration}"

JSON=$(curl -fsS -m 20 -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/commits/$SHA/check-runs?per_page=100") || { echo "CI gate: could not reach the GitHub API for $SHA" >&2; exit 2; }

# Pretty-printed JSON: a check run's own "name" is at 6 spaces of indent and is followed by its "status" and "conclusion"; nested objects are indented deeper.
RESULT=$(echo "$JSON" | awk '
  /^      "name": "/ { gsub(/^      "name": "|",?$/, ""); name = $0; next }
  /^      "status": "/ { gsub(/^      "status": "|",?$/, ""); status[name] = $0; next }
  /^      "conclusion": / { c = $0; gsub(/^      "conclusion": "?|"?,?$/, "", c); conclusion[name] = c; next }
  END { for (n in status) print n "|" status[n] "|" conclusion[n] }')

ok=1
for need in $REQUIRED; do
  line=$(echo "$RESULT" | grep -E "^${need}\|" | head -1)
  if [ -z "$line" ]; then echo "CI gate: check '$need' has not run for $SHA" >&2; ok=0; continue; fi
  status=$(echo "$line" | cut -d'|' -f2); conc=$(echo "$line" | cut -d'|' -f3)
  if [ "$status" != "completed" ]; then echo "CI gate: check '$need' is still $status for $SHA" >&2; ok=0
  elif [ "$conc" != "success" ]; then echo "CI gate: check '$need' ended '$conc' for $SHA" >&2; ok=0
  else echo "CI gate: $need = success"; fi
done
[ "$ok" = 1 ] && { echo "CI gate: all required checks passed for $SHA"; exit 0; }
exit 1
