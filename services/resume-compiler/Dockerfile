# Career OS résumé compile service.
#
# Two-stage build: compile the TypeScript server, then assemble a minimal runtime image with
# the `tectonic` binary and a pre-fetched bundle baked in, so the compile step at request time
# never needs network access (see src/server.ts's own doc comment for the full security
# rationale — this file only implements it).
#
# NOTE: written without access to a real `tectonic` binary or Docker in the environment that
# produced it (sandboxed, no GitHub access, no Docker installed). The tectonic install command
# and CLI flags below are a documented best-effort starting point — verify both against the
# pinned version's actual `--help` output and https://tectonic-typesetting.github.io before
# deploying. Do not assume this Dockerfile builds successfully unmodified.

# ---- Stage 1: compile the TypeScript server -------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime image -------------------------------------------------------------------
FROM debian:bookworm-slim

# Node (to run the compiled server) + curl (install-time only, removed after use) + the
# minimal set of TeX Live support libraries Tectonic's bundled engine needs at runtime.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get purge -y curl gnupg && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Install tectonic itself. The upstream project publishes prebuilt static binaries per release
# on GitHub — pin an exact version here rather than "latest" once you've verified it against
# this Dockerfile locally.
ARG TECTONIC_VERSION=0.15.0
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    -o /tmp/tectonic.tar.gz && \
    tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin && \
    rm /tmp/tectonic.tar.gz && \
    chmod +x /usr/local/bin/tectonic

ENV TECTONIC_BUNDLE_PATH=/opt/tectonic-bundle
RUN mkdir -p ${TECTONIC_BUNDLE_PATH}

# Pre-fetch the default TeXLive bundle into the image at BUILD time (this is the one and only
# network call tectonic ever makes for this deployment) by compiling a trivial document. Every
# request-time compile after this point runs with `--only-cached`, which errors instead of
# reaching the network if anything is missing — the guarantee is enforced by the flag, not just
# by this Dockerfile's intent.
RUN mkdir -p /tmp/warm && echo '\documentclass{article}\begin{document}warm\end{document}' > /tmp/warm/warm.tex && \
    tectonic /tmp/warm/warm.tex --outdir /tmp/warm --bundle ${TECTONIC_BUNDLE_PATH} && \
    rm -rf /tmp/warm

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Never run as root — this process only ever touches its own temp directory.
RUN useradd --system --create-home --shell /usr/sbin/nologin compiler
USER compiler

EXPOSE 8080
CMD ["node", "dist/server.js"]

# ---- Deployment notes (container-level limits this file cannot self-impose) -----------------
# Resource limits and network isolation for the CONTAINER itself belong at the orchestration
# layer, not in this Dockerfile:
#   docker run --network=bridge --memory=512m --cpus=1 --pids-limit=64 \
#     --read-only --tmpfs /tmp:size=64m \
#     -e RESUME_COMPILER_TOKEN=... -p 8080:8080 resume-compiler
# (The container's own inbound HTTP port still needs network — it's the `tectonic` SUBPROCESS
# that must never reach out, which `--only-cached` + the pre-baked bundle above guarantees
# regardless of what network policy wraps the container.)
# On Fly.io/Railway. set the equivalent memory/CPU limits in their respective app config, and
# set RESUME_COMPILER_TOKEN as a secret, never a plain env var in a committed config file.
