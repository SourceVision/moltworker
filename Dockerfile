FROM docker.io/cloudflare/sandbox:0.7.0

# Install Node.js 22 (required by OpenClaw) and rsync (for R2 backup sync)
# The base image has Node 20, we need to replace it with Node 22
# Using direct binary download for reliability
ENV NODE_VERSION=22.13.1
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && apt-get update && apt-get install -y xz-utils ca-certificates rsync \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install pnpm globally
RUN npm install -g pnpm

# Install OpenClaw (formerly clawdbot/moltbot)
# Uses latest by default; OPENCLAW_VERSION env var can override at runtime
RUN npm install -g openclaw@latest \
    && openclaw --version

# Create OpenClaw directories
# Legacy .clawdbot paths are kept for R2 backup migration
RUN mkdir -p /root/.openclaw \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# Copy startup script and helper scripts
# Build cache bust: 2026-02-08-v30-multi-provider
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
COPY scripts/ /usr/local/bin/scripts/
RUN chmod +x /usr/local/bin/start-openclaw.sh \
    && chmod +x /usr/local/bin/scripts/*.js

# Copy custom skills
COPY skills/ /root/clawd/skills/

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789
