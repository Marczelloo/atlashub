FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Dependencies + build stage (combined for pnpm workspace)
FROM base AS builder
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY dashboard/package.json ./dashboard/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared ./packages/shared
COPY dashboard ./dashboard

# Build shared package first
WORKDIR /app/packages/shared
RUN pnpm build

# Build dashboard
WORKDIR /app/dashboard
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/static ./.next/static

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
