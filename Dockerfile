# SafeClaw — sandboxed agent execution
# Runs the Claude Agent SDK inside a container with limited filesystem access.
# API keys are passed via environment variables at runtime (never baked in).

FROM node:20-alpine

RUN addgroup -S safeclaw && adduser -S safeclaw -G safeclaw

WORKDIR /app

COPY package.json ./
RUN npm install --production && npm cache clean --force

COPY src/ ./src/
COPY policies/ ./policies/

# Workspace directory for agent file operations
RUN mkdir -p /workspace && chown safeclaw:safeclaw /workspace

USER safeclaw

# The agent operates on files in /workspace
WORKDIR /workspace

ENTRYPOINT ["node", "/app/src/cli.js"]
CMD ["--help"]
