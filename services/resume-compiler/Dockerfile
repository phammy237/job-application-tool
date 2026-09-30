# Career OS résumé compile service.
#
# Two-stage build: compile the TypeScript server, then assemble a minimal runtime image with
# the `tectonic` binary and a pre-warmed resource cache baked in, so the compile step at request
# time never needs network access (see src/server.ts's own doc comment for the full security
# rationale — this file only implements it).
#
# NOTE: still not verified against a real `docker build` — the Tectonic release asset name and
# CLI flags follow Tectonic's documented V1 CLI (`--outdir`, `-C/--only-cached`,
# TECTONIC_CACHE_DIR), but run `docker build` once locally before deploying.

# ---- Stage 1: compile the TypeScript server -------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime image -------------------------------------------------------------------
FROM debian:bookworm-slim

# Node (to run the compiled server). curl/gnupg are install-time only; they're purged in the
# Tectonic step below, *after* its download — purging them here would break that download.
# ca-certificates stays for the build-time cache warm-up.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install tectonic itself. The musl build is statically linked, so it needs no extra shared
# libraries on this slim base (the -gnu build dynamically links fontconfig/harfbuzz/openssl).
ARG TECTONIC_VERSION=0.15.0
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    -o /tmp/tectonic.tar.gz && \
    tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin && \
    rm /tmp/tectonic.tar.gz && \
    chmod +x /usr/local/bin/tectonic && \
    apt-get purge -y curl gnupg && \
    apt-get autoremove -y

# Never run as root — this process only ever touches its own temp directory and the cache below.
RUN useradd --system --create-home --shell /usr/sbin/nologin compiler

# Tectonic keeps downloaded bundle files (and generated format files) in its cache directory.
# Pin that to a fixed path owned by the runtime user: a warm-up run as root would fill
# /root/.cache, which `compiler` can't read, and every request-time `--only-cached` compile would
# then fail.
ENV TECTONIC_CACHE_DIR=/opt/tectonic-cache
RUN mkdir -p "$TECTONIC_CACHE_DIR" && chown compiler "$TECTONIC_CACHE_DIR"

USER compiler

# Warm the cache at BUILD time (the one and only network call tectonic ever makes for this
# deployment) by compiling a small document as the runtime user. Every request-time compile
# after this point runs with `--only-cached`, which errors instead of reaching the network if
# anything is missing. Add any package your résumé templates \usepackage to warm.tex, or those
# compiles will fail closed. `printf`, not `echo`: /bin/sh here is dash, whose echo turns the
# "\b" in "\begin" into a backspace character.
RUN mkdir -p /tmp/warm && \
    printf '%s\n' \
      '\documentclass[letterpaper,11pt]{article}' \
      '\usepackage[margin=0.75in]{geometry}' \
      '\usepackage[hidelinks]{hyperref}' \
      '\usepackage{enumitem}' \
      '\usepackage{titlesec}' \
      '\usepackage[T1]{fontenc}' \
      '\begin{document}warm\end{document}' > /tmp/warm/warm.tex && \
    tectonic /tmp/warm/warm.tex --outdir /tmp/warm && \
    test -s /tmp/warm/warm.pdf && \
    rm -rf /tmp/warm

WORKDIR /app
COPY --from=builder --chown=compiler /app/dist ./dist
COPY --chown=compiler package.json ./

EXPOSE 8080
CMD ["node", "dist/server.js"]

# ---- Deployment notes (container-level limits this file cannot self-impose) -----------------
# Resource limits and network isolation for the CONTAINER itself belong at the orchestration
# layer, not in this Dockerfile:
#   docker run --network=bridge --memory=512m --cpus=1 --pids-limit=64 \
#     --read-only --tmpfs /tmp:size=64m \
#     -e RESUME_COMPILER_TOKEN=... -p 8080:8080 resume-compiler
# (The container's own inbound HTTP port still needs network — it's the `tectonic` SUBPROCESS
# that must never reach out, which `--only-cached` + the pre-warmed cache above guarantees
# regardless of what network policy wraps the container.)
# On Fly.io/Railway, set the equivalent memory/CPU limits in their respective app config, and
# set RESUME_COMPILER_TOKEN as a secret, never a plain env var in a committed config file.
