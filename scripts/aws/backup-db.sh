#!/bin/bash
# REFERENCE COPY of the production backup job, kept here for review and version control.
# The deployed copy is /root/backup-db.sh on the application host (EC2 i-02bedc5ba41539f46), run by root's cron at 20:00 UTC daily:
#   0 20 * * * /bin/bash /root/backup-db.sh >> /root/backup-cron.log 2>&1
# Copied unchanged from the host on 2026-11-16 (read-only audit, docs/AUDIT_2026-11_PHASE2.md finding A2-18). It contains no secret: the connection string is fetched from SSM Parameter Store.
# Changing the host copy is an infrastructure change and needs approval. Known gaps (see docs/BACKUP_AND_RECOVERY.md): no restore test, dumps are kept on the host and never pruned, the
# comment below still mentions Neon (the database is now AWS RDS PostgreSQL 18).
set -e
REGION="ap-south-1"
BUCKET="codearena-backups-640538431170"
STAMP=$(date +%Y%m%d-%H%M%S)
DUMPFILE="codearena-backup-$STAMP.dump"

echo "--- fetching DB connection string ---"
DIRECT_DATABASE_URL=$(aws ssm get-parameter --name /DIRECT_DATABASE_URL --with-decryption --region "$REGION" --query 'Parameter.Value' --output text)

echo "--- running pg_dump (custom format, via postgres:18 -- matches Neon's server version) ---"
mkdir -p /root/backup-tmp
docker run --rm -v /root/backup-tmp:/out postgres:18 \
  pg_dump "$DIRECT_DATABASE_URL" --format=custom -f "/out/$DUMPFILE"
mv "/root/backup-tmp/$DUMPFILE" "/root/$DUMPFILE"

SIZE=$(stat -c%s "/root/$DUMPFILE")
echo "--- dump size: $SIZE bytes ---"
if [ "$SIZE" -lt 1000 ]; then
  echo "ERROR: dump suspiciously small, aborting upload"
  exit 1
fi

echo "--- uploading to S3 ---"
aws s3 cp "/root/$DUMPFILE" "s3://$BUCKET/$DUMPFILE" --region "$REGION"

echo "--- verifying upload ---"
aws s3api head-object --bucket "$BUCKET" --key "$DUMPFILE" --region "$REGION" > /dev/null && echo "Upload confirmed in S3"

echo "--- structural validity check (pg_restore --list) ---"
cp "/root/$DUMPFILE" "/root/backup-tmp/$DUMPFILE"
docker run --rm -v /root/backup-tmp:/out postgres:18 pg_restore --list "/out/$DUMPFILE" | wc -l
rm -f "/root/backup-tmp/$DUMPFILE"

echo "--- backup complete: $DUMPFILE (kept at /root/$DUMPFILE for restore test) ---"
