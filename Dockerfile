# ── Stage 1: Build ──
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/types/package.json packages/types/
COPY packages/providers/package.json packages/providers/
COPY packages/tools/package.json packages/tools/
COPY packages/memory/package.json packages/memory/
COPY packages/core/package.json packages/core/
COPY packages/gateway/package.json packages/gateway/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Install runtime CLI tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl python3 && \
    rm -rf /var/lib/apt/lists/*

# Install Deno
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

# Copy built artifacts from builder
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/types/package.json packages/types/
COPY --from=builder /app/packages/types/dist packages/types/dist
COPY --from=builder /app/packages/providers/package.json packages/providers/
COPY --from=builder /app/packages/providers/dist packages/providers/dist
COPY --from=builder /app/packages/tools/package.json packages/tools/
COPY --from=builder /app/packages/tools/dist packages/tools/dist
COPY --from=builder /app/packages/memory/package.json packages/memory/
COPY --from=builder /app/packages/memory/dist packages/memory/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/gateway/package.json packages/gateway/
COPY --from=builder /app/packages/gateway/dist packages/gateway/dist
COPY --from=builder /app/packages/cli/package.json packages/cli/
COPY --from=builder /app/packages/cli/dist packages/cli/dist
COPY --from=builder /app/packages/web/package.json packages/web/
COPY --from=builder /app/packages/web/dist packages/web/dist

# Copy non-code assets
COPY system-prompt.md ./
COPY skills/ skills/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Create data directory
RUN mkdir -p data/tmp data/temp

ENV PORT=3100
ENV HOST=0.0.0.0
EXPOSE 3100

CMD ["node", "packages/gateway/dist/index.js"]
