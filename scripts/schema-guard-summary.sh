#!/usr/bin/env bash
# Describes the schema guard's read-only diff accurately. Reads the output of `prisma migrate diff --script` on stdin and prints a short summary. It decides
# nothing and executes nothing: the guard's safety check (the DESTRUCTIVE grep in scripts/deploy-aws-host.sh) is separate and unchanged.
#
# The manually managed trigram search indexes (<table>_<column>_trgm_idx, created by backend/scripts/addSearchIndexes.js, not declared in schema.prisma) always
# appear in the diff as DROP INDEX statements. They are counted separately and named as what they are, so a reader is never told that DROP INDEX statements are
# "additive".
set -u
DIFF=$(cat)
STATEMENTS=$(printf '%s\n' "$DIFF" | grep -v '^--' | grep -c ';[[:space:]]*$' || true)
TRGM=$(printf '%s\n' "$DIFF" | grep -cE '^DROP INDEX "[A-Za-z0-9_]+_trgm_idx";[[:space:]]*$' || true)
OTHER=$((STATEMENTS - TRGM))
echo "Schema guard: no destructive changes (no DROP TABLE, DROP COLUMN, DROP TYPE or column type change)."
if [ "$TRGM" -gt 0 ]; then
  echo "Schema guard:   - $TRGM DROP INDEX statement(s) for the managed trigram search indexes (*_trgm_idx): ignored by design. They are created by scripts/addSearchIndexes.js outside schema.prisma and appear in every diff. This guard executes nothing."
fi
if [ "$OTHER" -gt 0 ]; then
  echo "Schema guard:   - $OTHER other statement(s) (new tables/columns/indexes or index changes), which prisma db push applies at boot."
else
  echo "Schema guard:   - no other schema statements."
fi
exit 0
