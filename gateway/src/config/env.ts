import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // CORS
  CORS_ORIGINS: z.string().default('*'),

  // Cookie domain (for cross-subdomain auth, e.g., '.marczelloo.dev')
  COOKIE_DOMAIN: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),

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
  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .int()
    .default(100 * 1024 * 1024), // 100MB
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

const env = parseEnv();

export const config = {
  isDev: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(','),
  cookieDomain: env.COOKIE_DOMAIN,
  rateLimitMax: env.RATE_LIMIT_MAX,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
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
  },

  minio: {
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
    region: env.MINIO_REGION,
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
  },

  query: {
    statementTimeoutMs: env.STATEMENT_TIMEOUT_MS,
    maxRowsPerQuery: env.MAX_ROWS_PER_QUERY,
    defaultRowsLimit: env.DEFAULT_ROWS_LIMIT,
  },

  storage: {
    presignedUrlExpirySeconds: env.PRESIGNED_URL_EXPIRY_SECONDS,
    maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES,
  },
} as const;

export type Config = typeof config;
