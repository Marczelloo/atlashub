import { z } from 'zod';
import { parseTrustProxy } from '../lib/trust-proxy.js';
import { MAX_OBJECT_BYTES, parseByteSize } from '../lib/upload-limits.js';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Which proxies may set X-Forwarded-For. Default trusts only hops on private
  // networks (cloudflared, Docker bridge), so a client cannot fake its IP by
  // sending the header itself. Accepts true/false, a hop count, or IPs/CIDRs
  // and the presets loopback, linklocal, uniquelocal (comma-separated).
  TRUST_PROXY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('loopback,linklocal,uniquelocal')
  ),

  // CORS
  CORS_ORIGINS: z.string().default('*'),

  // Cookie domain (for cross-subdomain auth, e.g., '.marczelloo.dev')
  COOKIE_DOMAIN: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  // Per-project request limits per window: "projectId=300,otherProjectId=500".
  // Projects not listed use RATE_LIMIT_MAX. Invalid entries are ignored with a warning.
  RATE_LIMIT_PROJECT_OVERRIDES: z.string().default(''),

  // Auth rate limiting (for brute-force protection)
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(300000), // 5 minutes

  // Admin rate limit floor (minimum requests even for admins)
  ADMIN_RATE_LIMIT_FLOOR: z.coerce.number().int().min(100).default(1000),

  // CSP reporting (optional)
  CSP_REPORT_URI: z.string().url().optional().or(z.literal('')),

  // Body limits
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(2 * 1024 * 1024), // 2MB

  // Postgres - Platform DB
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('platform'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
  POSTGRES_IDLE_TIMEOUT_MS: z.coerce.number().int().default(30000),
  POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce.number().int().default(5000),
  // Connections per project database pool (app role serves the public API).
  // Every cached project holds its own pools, so keep these small.
  PROJECT_DB_APP_POOL_SIZE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(50).default(3)
  ),
  PROJECT_DB_OWNER_POOL_SIZE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(50).default(3)
  ),

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_USE_SSL: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_REGION: z.string().default('us-east-1'),
  MINIO_PUBLIC_URL: z.string().url().optional().or(z.literal('')),

  // Security
  PLATFORM_MASTER_KEY: z.string().min(32), // For encrypting project DB creds (AES-256)
  JWT_SECRET: z.string().min(32), // For signing JWT tokens
  SESSION_EXPIRY_HOURS: z.coerce.number().int().min(1).default(24),

  // Initial admin setup (first run only)
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_PASSWORD: z.string().min(8).optional().or(z.literal('')),

  // Legacy - can be removed
  DEV_ADMIN_TOKEN: z.string().optional(),
  CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
  CF_ACCESS_AUDIENCE: z.string().optional(),

  // Query limits
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5000),
  MAX_ROWS_PER_QUERY: z.coerce.number().int().min(1).max(10000).default(1000),
  DEFAULT_ROWS_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),

  // Storage
  PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().min(60).default(3600),
  // Default upload limit for every project: bytes or a size with a unit (500MB, 5GB).
  MAX_UPLOAD_SIZE_BYTES: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : parseByteSize(String(v)) ?? v),
    z.number().int().positive().max(MAX_OBJECT_BYTES).default(100 * 1024 * 1024) // 100MB
  ),
  // Per-project or per-bucket upload limits: "<projectId>=5GB,<projectId>/videos=50GB"
  STORAGE_UPLOAD_LIMITS: z.string().default(''),
});

function validateCorsConfig(origins: string | true | string[], isProduction: boolean): void {
  if (isProduction && origins === true) {
    console.error('ERROR: CORS_ORIGINS cannot be "*" in production.');
    console.error('Please specify allowed origins (comma-separated), e.g.:');
    console.error('CORS_ORIGINS=https://app.example.com,https://admin.example.com');
    process.exit(1);
  }
}

function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  // Validate CORS in production
  const corsOrigins = result.data.CORS_ORIGINS === '*' ? true : result.data.CORS_ORIGINS.split(',');
  validateCorsConfig(corsOrigins, result.data.NODE_ENV === 'production');

  return result.data;
}

const env = parseEnv();

export const config = {
  isDev: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  corsOrigins: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(','),
  cookieDomain: env.COOKIE_DOMAIN,
  rateLimitMax: env.RATE_LIMIT_MAX,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  rateLimitProjectOverrides: env.RATE_LIMIT_PROJECT_OVERRIDES,
  bodyLimitBytes: env.BODY_LIMIT_BYTES,

  postgres: {
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    maxPoolSize: env.POSTGRES_MAX_POOL_SIZE,
    idleTimeoutMs: env.POSTGRES_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: env.POSTGRES_CONNECTION_TIMEOUT_MS,
    projectAppPoolSize: env.PROJECT_DB_APP_POOL_SIZE,
    projectOwnerPoolSize: env.PROJECT_DB_OWNER_POOL_SIZE,
  },

  minio: {
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
    region: env.MINIO_REGION,
    publicUrl: env.MINIO_PUBLIC_URL || undefined,
  },

  security: {
    platformMasterKey: env.PLATFORM_MASTER_KEY,
    jwtSecret: env.JWT_SECRET,
    sessionExpiryHours: env.SESSION_EXPIRY_HOURS,
    adminEmail: env.ADMIN_EMAIL || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    devAdminToken: env.DEV_ADMIN_TOKEN,
    cfAccessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    cfAccessAudience: env.CF_ACCESS_AUDIENCE,
    cfAccessEnabled: Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUDIENCE),
    authRateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    authRateLimitWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    adminRateLimitFloor: env.ADMIN_RATE_LIMIT_FLOOR,
    cspReportUri: env.CSP_REPORT_URI || undefined,
  },

  query: {
    statementTimeoutMs: env.STATEMENT_TIMEOUT_MS,
    maxRowsPerQuery: env.MAX_ROWS_PER_QUERY,
    defaultRowsLimit: env.DEFAULT_ROWS_LIMIT,
  },

  storage: {
    presignedUrlExpirySeconds: env.PRESIGNED_URL_EXPIRY_SECONDS,
    maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES,
    uploadLimits: env.STORAGE_UPLOAD_LIMITS,
  },
} as const;

export type Config = typeof config;
