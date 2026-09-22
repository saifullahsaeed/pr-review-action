# Harrier — self-hosted code review.
#
# The reviewed code never leaves the machine this container runs on. The model endpoint is
# whatever the team configures, including one inside their own network.
FROM node:24-bookworm-slim

# Versions pinned from the projects' own release metadata (checked 22 Sep 2026):
#   gitleaks v8.30.1  — per-arch assets: gitleaks_<version>_linux_x64.tar.gz / _linux_arm64.tar.gz
#   osv-scanner v2.6.0 — bare binary (not an archive): osv-scanner_linux_amd64 / _linux_arm64
ARG GITLEAKS_VERSION=8.30.1
ARG OSV_SCANNER_VERSION=2.6.0

# Install the scanner binaries for the image's architecture — each project names its assets
# its own way (x64/amd64), so TARGETARCH maps onto both. An amd64 binary in an arm64 image
# runs under emulation on a Mac and fails with an exec format error on a bare arm64 host.
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git jq python3 python3-pip unzip \
 && rm -rf /var/lib/apt/lists/*

# Semgrep (security patterns) and ruff (Python lint) via pip; eslint (JS/TS lint) via npm.
RUN pip3 install --no-cache-dir --break-system-packages semgrep ruff \
 && npm install -g eslint

RUN case "$TARGETARCH" in \
      arm64) GL_ARCH=linux_arm64; OSV_ARCH=linux_arm64 ;; \
      *)     GL_ARCH=linux_x64;   OSV_ARCH=linux_amd64 ;; \
    esac \
 && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${GL_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks \
 && curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_${OSV_ARCH}" \
      -o /usr/local/bin/osv-scanner \
 && chmod +x /usr/local/bin/osv-scanner \
 && gitleaks version \
 && osv-scanner --version \
 && want=$([ "$TARGETARCH" = arm64 ] && echo b700 || echo 3e00) \
 && for b in gitleaks osv-scanner; do \
      got=$(od -An -tx1 -j18 -N2 /usr/local/bin/$b | tr -d ' \n'); \
      echo "$b ELF e_machine: $got (want $want)"; \
      [ "$got" = "$want" ] || { echo "WRONG ARCHITECTURE in $b" >&2; exit 1; }; \
    done

# The mirrored advisory database lives here for air-gapped runs (--offline).
ENV OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/var/cache/osv-db
RUN mkdir -p /var/cache/osv-db

WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY src ./src
COPY schemas ./schemas

# Run as a non-root user: Harrier's job is reading code nobody has vetted yet, so the container
# should not be root while it does. (Harrier's own first review raised this as two HIGH findings.)
# The node base image already owns uid 1000 as its `node` user, so reuse it — `useradd --uid 1000`
# dies on "UID 1000 is not unique".
RUN mkdir -p /report \
 && chown -R node:node /app /report /var/cache/osv-db
USER node

# Sources run as TypeScript directly (Node 24 type stripping); there is no build step.
ENTRYPOINT ["node", "src/cli.ts"]
CMD ["--help"]
