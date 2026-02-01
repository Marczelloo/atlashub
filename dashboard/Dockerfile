FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Build stage
FROM base AS builder
WORKDIR /app

# Configure pnpm for flat node_modules (required for standalone output)
RUN echo "node-linker=hoisted" > .npmrc

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

# Accept build-time env vars for Next.js public variables
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:4545
ENV NEXT_PUBLIC_GATEWAY_URL=${NEXT_PUBLIC_GATEWAY_URL}

RUN pnpm build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy public files
COPY --from=builder /app/dashboard/public ./public

# Copy standalone output - with hoisted pnpm, structure is simpler
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/static ./dashboard/.next/static

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

WORKDIR /app/dashboard

CMD ["node", "server.js"]
