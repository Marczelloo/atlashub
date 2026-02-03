import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../.env') });

export const config = {
  // Node environment
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // PostgreSQL
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'platform',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '',
    maxPoolSize: parseInt(process.env.POSTGRES_MAX_POOL_SIZE || '3', 10),
  },

  // Scheduler settings
  scheduler: {
    // How often to check for due jobs (ms)
    pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '10000', 10),
    // Default timeout for HTTP jobs (ms)
    defaultTimeoutMs: parseInt(process.env.SCHEDULER_DEFAULT_TIMEOUT_MS || '30000', 10),
    // Max concurrent job executions
    maxConcurrentJobs: parseInt(process.env.SCHEDULER_MAX_CONCURRENT_JOBS || '5', 10),
    // Lock duration for job execution (prevent double-execution)
    lockDurationMs: parseInt(process.env.SCHEDULER_LOCK_DURATION_MS || '300000', 10), // 5 min
  },

  // Discord notifications
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    enabled: !!process.env.DISCORD_WEBHOOK_URL,
  },

  // Encryption key for HTTP headers/body
  platformMasterKey: process.env.PLATFORM_MASTER_KEY || '',
} as const;
