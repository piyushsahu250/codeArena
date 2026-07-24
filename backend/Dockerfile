FROM node:20-slim

# Toolchains needed by the judge for C, C++, Java and Python submissions.
# `time` (GNU time, not the bash builtin) gives the judge real per-submission peak-memory
# reporting via `time -v -o <file>` — writing its report to a file rather than stderr keeps it
# cleanly separate from the submitted program's own stderr output.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    default-jdk \
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
CMD ["sh", "-c", "node prisma/dedupeDuplicateSubmissions.js; npx prisma db push --skip-generate --accept-data-loss && (node scripts/migrateAcademicGroups.js; true) && (node scripts/fixFunctionModeTestCaseInputs.js; true) && (node scripts/backfillModuleCodingTestCases.js; true) && (node scripts/auditFunctionModeTestCaseInputs.js; true) && (npm run seed || true) && npm start"]
