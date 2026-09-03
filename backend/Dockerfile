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
# libcairo2-dev/libpango1.0-dev/libjpeg-dev/libgif-dev/librsvg2-dev/libpixman-1-dev: build-time
# headers the `canvas` npm package (node-canvas) needs to compile its native binding against —
# used by resumeOcr.js to rasterize scanned-PDF pages before running Tesseract OCR on them.
# `canvas` was chosen over the no-native-deps @napi-rs/canvas alternative specifically because
# pdfjs-dist's own Node rendering internals are hardcoded to node-canvas's exact mutable-canvas
# semantics (confirmed live: @napi-rs/canvas's canvas object threw an uncatchable native error the
# moment pdf.js's internal cleanup path touched it) — this is the combination pdf.js actually
# expects, not a preference.
RUN apt-get update -o Acquire::Retries=3 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    default-jdk-headless \
    python3 \
    time \
    postgresql-client \
    util-linux \
    libcap2-bin \
    iptables \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
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

# Separate, non-root identity for the main API process itself (distinct uid from `sandbox`,
# which stays reserved for untrusted student-code execution only — one identity being
# compromised was never meant to also grant the other's access).
RUN groupadd --system --gid 10000 app \
    && useradd --system --no-create-home --shell /usr/sbin/nologin \
       --uid 10000 --gid 10000 app

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# /app holds application source, node_modules, and prisma/schema.prisma — none of it
# should be readable by the unprivileged `sandbox` user once it starts running student
# code, since a submission trying `open("/app/...")` should hit a permission error, not
# read anything. app:app + 750 (owner rwx, group r-x, others none) denies `sandbox`
# (its own separate group, gid 10001) outright.
RUN chown -R app:app /app && chmod -R 750 /app

# iptables (both the nft and legacy backends) takes an exclusive lock on this file before editing
# rules — /run itself is root:root 755 in this base image (confirmed: it's a plain image-layer
# directory here, not a tmpfs remounted at container start, so this persists to runtime), which
# blocks `app` from ever creating it fresh at runtime even with CAP_NET_ADMIN. Pre-creating it here
# and handing it to `app` sidesteps that — opening an *existing* file for locking only needs
# permission on the file itself, not its parent directory. Confirmed live: cap_net_admin alone
# was NOT sufficient for the nft-backed `iptables` binary (its rule-set generation-id check
# requires actual uid 0, not just the capability — a real kernel/nftables restriction, not a
# permissions oversight), so setupNetworkIsolation() in judge.js uses `iptables-legacy` instead,
# which only needed this lock file fixed.
RUN touch /run/xtables.lock && chown app:app /run/xtables.lock && chmod 600 /run/xtables.lock

# Grants the `node` binary itself (not the `app` user broadly, and not the whole container via
# --cap-add) exactly the capabilities judge.js needs: CAP_SETUID/CAP_SETGID to drop its
# child processes to `sandbox` before executing student code; CAP_CHOWN because judge.js
# fs.chownSync()s each submission's temp directory/file to `sandbox` BEFORE that child runs (see
# prepare()'s "sandbox needs read access" comment below); and CAP_FOWNER because the very next
# step, fs.chmodSync(file, 0o440), runs AFTER that chown already transferred ownership away from
# `app` to `sandbox` — chmod on a file you no longer own needs FOWNER regardless of the other two.
# CAP_KILL is the same story one level up: on timeout / output-limit-exceeded, spawnWithTimeout's
# killTimer calls process.kill(-child.pid, "SIGKILL") to reap the whole process group — but that
# group's real uid is `sandbox`, not `app` (DROP_PRIVILEGES already dropped it before exec), and
# signaling a process owned by a different uid needs CAP_KILL regardless of parent/child
# relationship. (The first three of these five gaps were caught one at a time by actually testing
# this path before deploying, not by reasoning about it in advance — the judge's warm-up compile
# failed first with "EPERM ... chown", then "EPERM ... chmod" on the same temp file, until CHOWN
# then FOWNER were added; KILL is added proactively here since the same uid-boundary reasoning
# applies to it and a broken timeout-kill would be a much worse failure mode to discover live —
# a runaway submission that can't be killed — than a warm-up compile error.) Those five are already
# inside Docker's default capability bounding set — granting them via setcap doesn't add anything
# new at the container level, it just lets a non-root process actually exercise capabilities that
# were always available to root by default.
#
# Must target the real binary, not the /usr/local/bin/node symlink node:20-slim ships —
# `readlink -f` resolves it, since file capabilities are stored as an xattr on the actual inode and
# are silently no-ops on a symlink. NOTE: does NOT include cap_net_admin — the network-isolation
# iptables rule is installed once, as real root, in docker-entrypoint.sh below, before this
# container ever drops to `app`, so node itself never needs that capability. (It was tried here
# first via setcap; confirmed live that CAP_NET_ADMIN via file capability alone is NOT sufficient
# for either the nft or legacy iptables backend in this environment — both require actual uid 0
# for their respective kernel-level rule-set-generation/table-init checks, a genuine kernel
# restriction, not a permissions oversight on this platform's part.)
RUN setcap cap_setuid,cap_setgid,cap_chown,cap_fowner,cap_kill=+ep "$(readlink -f "$(which node)")"

# No `USER app` here (deliberately, unlike before) — this container now starts as real root so
# docker-entrypoint.sh can install the network-isolation iptables rule (see its own comment for
# why that genuinely needs root in this environment), then drops to `app` itself via `setpriv`
# before the long-running Node process ever starts. Everything this image's own build steps did
# above already ran as whatever user was active at each RUN line (root, same as always — this
# directive only ever affected runtime, never build), so nothing above this line changes.

EXPOSE 4000
# docker-entrypoint.sh now has two jobs where it used to have one: a brief real-root phase to
# install the network-isolation rule (see its own comment), then drop to `app` via `setpriv`
# before continuing into its original auto-detect-role logic (Render vs Cloud Run Service vs
# Cloud Run migration Job) completely unchanged from before.
CMD ["sh", "docker-entrypoint.sh"]
