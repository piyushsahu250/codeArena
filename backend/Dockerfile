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

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

EXPOSE 4000
CMD ["sh", "-c", "node prisma/dedupeDuplicateSubmissions.js; npx prisma db push --skip-generate --accept-data-loss && (node scripts/migrateAcademicGroups.js; true) && (node scripts/fixFunctionModeTestCaseInputs.js; true) && (node scripts/backfillModuleCodingTestCases.js; true) && (node scripts/auditFunctionModeTestCaseInputs.js; true) && (node scripts/backfillChapters.js; true) && (node scripts/backfillCourseVisibility.js; true) && (npm run seed || true) && npm start"]
