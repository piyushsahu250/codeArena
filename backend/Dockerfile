FROM node:20-slim

# Toolchains needed by the judge for C, C++, Java and Python submissions.
# `time` (GNU time, not the bash builtin) gives the judge real per-submission peak-memory
# reporting via `time -v -o <file>` — writing its report to a file rather than stderr keeps it
# cleanly separate from the submitted program's own stderr output.
#
# default-jdk-headless (not default-jdk) — same javac/java the judge invokes by name, but skips
# the GUI/font/print/X11 packages that default-jdk pulls in. Those packages' postinst scripts
# (ca-certificates-java in particular) are a well-known source of intermittent "exit status 1"
# Docker build failures under CPU/memory-constrained build hosts — the headless variant is both
# smaller (faster build, less likely to hit a host resource ceiling) and has fewer postinst steps
# that can flake. Acquire::Retries survives transient Debian-mirror hiccups on apt-get update.
RUN apt-get update -o Acquire::Retries=3 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    default-jdk-headless \
    python3 \
    time \
    postgresql-client \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

# Dedicated, unprivileged, fixed-UID/GID system user for compiling/running untrusted
# student-submitted code (see judge.js's DROP_PRIVILEGES). --no-create-home / nologin:
# this user never logs in or needs a home dir, only needs to be spawn()-able. A fixed
# numeric UID/GID (not just a name) lets judge.js reference the same identity via a
# constant without depending on useradd's allocation order, and node:20-slim already
# defines its own `node` user at uid 1000 by base-image convention — 10001 avoids ever
# depending on that coincidence.
RUN groupadd --system --gid 10001 sandbox \
    && useradd --system --no-create-home --shell /usr/sbin/nologin \
       --uid 10001 --gid 10001 sandbox

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# /app holds application source, node_modules, and prisma/schema.prisma — none of it
# should be readable by the unprivileged `sandbox` user once it starts running student
# code, since a submission trying `open("/app/...")` should hit a permission error, not
# read anything. root:root + 750 (owner rwx, group r-x, others none) denies `sandbox`
# (its own group, gid 10001, not root's) outright.
RUN chown -R root:root /app && chmod -R 750 /app

EXPOSE 4000
CMD ["sh", "-c", "node prisma/dedupeDuplicateSubmissions.js; node scripts/migrateRegistrationNumbers.js; npx prisma db push --skip-generate --accept-data-loss && (node scripts/migrateAcademicGroups.js; true) && (node scripts/fixFunctionModeTestCaseInputs.js; true) && (node scripts/backfillModuleCodingTestCases.js; true) && (node scripts/auditFunctionModeTestCaseInputs.js; true) && (node scripts/backfillChapters.js; true) && (node scripts/backfillCourseVisibility.js; true) && (node scripts/backfillTestInstituteId.js; true) && (node scripts/backfillTestSubjectUnit.js; true) && (node scripts/backfillGarbledRollNumbers.js; true) && (node scripts/backfillProfileEncryption.js; true) && (node scripts/fixIntegratedMTechAcademicGroup.js; true) && (node scripts/addSearchIndexes.js; true) && (node scripts/addChallengeScopeIndexes.js; true) && (node scripts/seedReadinessSubjects.js; true) && (node scripts/backfillSubjects.js; true) && (npm run seed || true) && npm start"]
