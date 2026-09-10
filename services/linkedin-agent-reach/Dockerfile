FROM node:20-bookworm-slim

# Chromium dependencies required by the mcp-server-linkedin browser session.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 python3-pip pipx \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin
# mcp-server-linkedin is distributed as a Python package; pin the version you verified.
RUN pipx install mcp-server-linkedin || pip install --break-system-packages mcp-server-linkedin

WORKDIR /app
COPY package.json ./
COPY src ./src

# Persistent volume for the signed-in LinkedIn session.
ENV MCP_PROFILE_DIR=/data/linkedin-profile
VOLUME ["/data"]

ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/healthz || exit 1

CMD ["node", "src/server.js"]
