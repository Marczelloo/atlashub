FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Build stage
FROM base AS builder
WORKDIR /app

# Configure pnpm for flat node_modules (no symlinks)
RUN echo "node-linker=hoisted" > .npmrc

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY scheduler/package.json ./scheduler/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared ./packages/shared
COPY scheduler ./scheduler

# Build shared package first
WORKDIR /app/packages/shared
RUN pnpm build

# Build scheduler
WORKDIR /app/scheduler
RUN pnpm build

# Production dependencies stage
FROM base AS prod-deps
WORKDIR /app

# Configure pnpm for flat node_modules
RUN echo "node-linker=hoisted" > .npmrc

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY scheduler/package.json ./scheduler/

RUN pnpm install --frozen-lockfile --prod

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 atlashub

# Copy built scheduler code
COPY --from=builder --chown=atlashub:nodejs /app/scheduler/dist ./dist
COPY --from=builder --chown=atlashub:nodejs /app/scheduler/package.json ./package.json

# Copy built shared package
COPY --from=builder --chown=atlashub:nodejs /app/packages/shared/dist ./node_modules/@atlashub/shared/dist
COPY --from=builder --chown=atlashub:nodejs /app/packages/shared/package.json ./node_modules/@atlashub/shared/package.json

# Copy production dependencies (hoisted - flat structure)
COPY --from=prod-deps --chown=atlashub:nodejs /app/node_modules ./node_modules

USER atlashub

CMD ["node", "dist/index.js"]
