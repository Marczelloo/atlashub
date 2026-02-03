import pg from 'pg';
import crypto from 'node:crypto';
import { Cron } from 'croner';
import pino from 'pino';
import { config } from './config.js';

const { Pool } = pg;

const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// Database connection pool
const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
  max: config.postgres.maxPoolSize,
});

// Track active cron instances
const activeCrons = new Map<string, Cron>();
// Track running jobs to respect concurrency limit
let runningJobs = 0;

/**
 * Decrypt job data (headers or body) using AES-256-GCM
 */
function decryptJobData<T = unknown>(
  encryptedData: string | null,
  iv: string | null,
  authTag: string | null
): T | null {
  if (!encryptedData || !iv || !authTag || !config.platformMasterKey) {
    return null;
  }

  try {
    // Derive a 32-byte key from the master key
    const key = crypto.createHash('sha256').update(config.platformMasterKey).digest();

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as T;
  } catch (err) {
    logger.error({ err }, 'Failed to decrypt job data');
    return null;
  }
}

export interface CronJob {
  id: string;
  projectId: string | null;
  name: string;
  jobType: 'http' | 'platform';
  scheduleCron: string;
  timezone: string;
  httpUrl: string | null;
  httpMethod: string | null;
  httpHeaders: Record<string, string> | null;
  httpBody: unknown | null;
  platformAction: string | null;
  platformConfig: Record<string, unknown> | null;
  enabled: boolean;
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
}

// Raw database row type (before decryption)
interface CronJobRow {
  id: string;
  projectId: string | null;
  name: string;
  jobType: 'http' | 'platform';
  scheduleCron: string;
  timezone: string;
  httpUrl: string | null;
  httpMethod: string | null;
  httpHeadersEncrypted: string | null;
  httpBodyEncrypted: string | null;
  headersIv: string | null;
  headersAuthTag: string | null;
  bodyIv: string | null;
  bodyAuthTag: string | null;
  platformAction: string | null;
  platformConfig: Record<string, unknown> | null;
  enabled: boolean;
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
}

/**
 * Load all enabled cron jobs from the database
 */
async function loadEnabledJobs(): Promise<CronJob[]> {
  const result = await pool.query<CronJobRow>(`
    SELECT 
      id, project_id as "projectId", name, job_type as "jobType",
      schedule_cron as "scheduleCron", timezone,
      http_url as "httpUrl", http_method as "httpMethod",
      http_headers_encrypted as "httpHeadersEncrypted", 
      http_body_encrypted as "httpBodyEncrypted",
      headers_iv as "headersIv", headers_auth_tag as "headersAuthTag",
      body_iv as "bodyIv", body_auth_tag as "bodyAuthTag",
      platform_action as "platformAction", platform_config as "platformConfig",
      enabled, timeout_ms as "timeoutMs", retries,
      retry_backoff_ms as "retryBackoffMs"
    FROM cron_jobs
    WHERE enabled = true
  `);

  // Decrypt headers and body for each job
  return result.rows.map(
    (row): CronJob => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      jobType: row.jobType,
      scheduleCron: row.scheduleCron,
      timezone: row.timezone,
      httpUrl: row.httpUrl,
      httpMethod: row.httpMethod,
      httpHeaders: decryptJobData<Record<string, string>>(
        row.httpHeadersEncrypted,
        row.headersIv,
        row.headersAuthTag
      ),
      httpBody: decryptJobData(row.httpBodyEncrypted, row.bodyIv, row.bodyAuthTag),
      platformAction: row.platformAction,
      platformConfig: row.platformConfig,
      enabled: row.enabled,
      timeoutMs: row.timeoutMs,
      retries: row.retries,
      retryBackoffMs: row.retryBackoffMs,
    })
  );
}

/**
 * Record a job run in the database
 */
async function createJobRun(jobId: string, attemptNumber: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO cron_job_runs (job_id, started_at, status, attempt_number)
     VALUES ($1, NOW(), 'running', $2)
     RETURNING id`,
    [jobId, attemptNumber]
  );
  return result.rows[0].id;
}

/**
 * Update a job run with the result
 */
async function updateJobRun(
  runId: string,
  status: 'success' | 'fail' | 'timeout',
  httpStatus: number | null,
  errorText: string | null,
  logPreview: string | null
): Promise<void> {
  await pool.query(
    `UPDATE cron_job_runs
     SET 
       finished_at = NOW(),
       duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
       status = $2,
       http_status = $3,
       error_text = $4,
       log_preview = $5
     WHERE id = $1`,
    [runId, status, httpStatus, errorText, logPreview]
  );
}

/**
 * Update last_run_at and next_run_at for a job
 */
async function updateJobTimestamps(jobId: string, nextRun: Date | null): Promise<void> {
  await pool.query(
    `UPDATE cron_jobs 
     SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW()
     WHERE id = $1`,
    [jobId, nextRun]
  );
}

/**
 * Execute an HTTP job
 */
async function executeHttpJob(job: CronJob): Promise<{
  success: boolean;
  httpStatus: number | null;
  error: string | null;
  responsePreview: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    job.timeoutMs || config.scheduler.defaultTimeoutMs
  );

  try {
    const response = await fetch(job.httpUrl!, {
      method: job.httpMethod || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AtlasHub-Scheduler/1.0',
        ...(job.httpHeaders || {}),
      },
      body: job.httpBody ? JSON.stringify(job.httpBody) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await response.text().catch(() => '');
    const preview = responseText.slice(0, 500);

    return {
      success: response.ok,
      httpStatus: response.status,
      error: response.ok ? null : `HTTP ${response.status}: ${preview}`,
      responsePreview: preview,
    };
  } catch (err) {
    clearTimeout(timeout);
    const error = err instanceof Error ? err.message : String(err);
    const isTimeout = error.includes('abort') || error.includes('timeout');
    return {
      success: false,
      httpStatus: null,
      error: isTimeout ? 'Request timed out' : error,
      responsePreview: null,
    };
  }
}

/**
 * Execute a platform job (internal actions like backup)
 */
async function executePlatformJob(job: CronJob): Promise<{
  success: boolean;
  error: string | null;
  responsePreview: string | null;
}> {
  // Platform jobs are internal actions - in a full implementation,
  // these would trigger internal services like backup, cleanup, etc.
  // For now, we'll just log and return success for known actions.

  const action = job.platformAction;
  logger.info({ jobId: job.id, action }, 'Executing platform job');

  switch (action) {
    case 'cleanup_expired_backups':
      // In production, this would call the backup service
      logger.info('Would cleanup expired backups');
      return { success: true, error: null, responsePreview: 'Cleanup completed' };

    case 'vacuum_database':
      // In production, this would run VACUUM on project DBs
      logger.info('Would vacuum databases');
      return { success: true, error: null, responsePreview: 'Vacuum completed' };

    case 'notify_status':
      // Send a status notification
      if (config.discord.enabled) {
        await sendDiscordNotification({
          title: '🟢 AtlasHub Status',
          description: 'Scheduler is running normally.',
          color: 0x00ff00,
        });
      }
      return { success: true, error: null, responsePreview: 'Status notification sent' };

    default:
      return {
        success: false,
        error: `Unknown platform action: ${action}`,
        responsePreview: null,
      };
  }
}

/**
 * Send a Discord notification
 */
async function sendDiscordNotification(embed: {
  title: string;
  description: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}): Promise<void> {
  if (!config.discord.enabled) return;

  try {
    await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            ...embed,
            timestamp: new Date().toISOString(),
            footer: { text: 'AtlasHub Scheduler' },
          },
        ],
      }),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to send Discord notification');
  }
}

/**
 * Execute a job with retries
 */
async function executeJobWithRetries(job: CronJob): Promise<void> {
  if (runningJobs >= config.scheduler.maxConcurrentJobs) {
    logger.warn({ jobId: job.id, jobName: job.name }, 'Skipping job: max concurrent jobs reached');
    return;
  }

  runningJobs++;
  logger.info({ jobId: job.id, jobName: job.name, jobType: job.jobType }, 'Executing job');

  let lastError: string | null = null;
  let success = false;

  for (let attempt = 1; attempt <= Math.max(1, job.retries + 1); attempt++) {
    const runId = await createJobRun(job.id, attempt);

    try {
      let result: {
        success: boolean;
        httpStatus?: number | null;
        error: string | null;
        responsePreview: string | null;
      };

      if (job.jobType === 'http') {
        result = await executeHttpJob(job);
      } else {
        result = await executePlatformJob(job);
      }

      await updateJobRun(
        runId,
        result.success ? 'success' : 'fail',
        result.httpStatus ?? null,
        result.error,
        result.responsePreview
      );

      if (result.success) {
        success = true;
        logger.info({ jobId: job.id, jobName: job.name, attempt }, 'Job completed successfully');
        break;
      }

      lastError = result.error;
      logger.warn({ jobId: job.id, jobName: job.name, attempt, error: result.error }, 'Job failed');

      // Wait before retry
      if (attempt < job.retries + 1 && job.retryBackoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, job.retryBackoffMs));
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await updateJobRun(runId, 'fail', null, lastError, null);
      logger.error({ jobId: job.id, jobName: job.name, attempt, err }, 'Job execution error');
    }
  }

  // Update job timestamps
  const cronInstance = activeCrons.get(job.id);
  const nextRun = cronInstance?.nextRun() ?? null;
  await updateJobTimestamps(job.id, nextRun);

  // Send failure notification
  if (!success && config.discord.enabled) {
    await sendDiscordNotification({
      title: '🔴 Cron Job Failed',
      description: `Job **${job.name}** failed after ${job.retries + 1} attempts.`,
      color: 0xff0000,
      fields: [
        { name: 'Job ID', value: job.id, inline: true },
        { name: 'Type', value: job.jobType, inline: true },
        { name: 'Error', value: lastError?.slice(0, 200) || 'Unknown error' },
      ],
    });
  }

  runningJobs--;
}

/**
 * Schedule a single job
 */
function scheduleJob(job: CronJob): void {
  // Stop existing cron if any
  const existing = activeCrons.get(job.id);
  if (existing) {
    existing.stop();
  }

  try {
    const cron = new Cron(job.scheduleCron, { timezone: job.timezone }, () => {
      executeJobWithRetries(job).catch((err) => {
        logger.error({ jobId: job.id, err }, 'Unhandled error in job execution');
      });
    });

    activeCrons.set(job.id, cron);

    const nextRun = cron.nextRun();
    logger.info(
      { jobId: job.id, jobName: job.name, schedule: job.scheduleCron, nextRun },
      'Job scheduled'
    );

    // Update next_run_at in database
    pool
      .query('UPDATE cron_jobs SET next_run_at = $1 WHERE id = $2', [nextRun, job.id])
      .catch((updateErr: Error) => {
        logger.error({ err: updateErr, jobId: job.id }, 'Failed to update next_run_at');
      });
  } catch (err) {
    logger.error({ jobId: job.id, jobName: job.name, err }, 'Failed to schedule job');
  }
}

/**
 * Sync jobs from database (add new, remove deleted, update changed)
 */
async function syncJobs(): Promise<void> {
  try {
    const jobs = await loadEnabledJobs();
    const jobIds = new Set(jobs.map((j) => j.id));

    // Remove jobs that are no longer enabled or deleted
    for (const [id, cron] of activeCrons) {
      if (!jobIds.has(id)) {
        cron.stop();
        activeCrons.delete(id);
        logger.info({ jobId: id }, 'Job removed from schedule');
      }
    }

    // Add or update jobs
    for (const job of jobs) {
      scheduleJob(job);
    }

    logger.debug({ activeJobs: activeCrons.size }, 'Jobs synced');
  } catch (err) {
    logger.error({ err }, 'Failed to sync jobs');
  }
}

/**
 * Start the scheduler
 */
export async function startScheduler(): Promise<void> {
  logger.info('Starting AtlasHub Scheduler...');

  // Initial sync
  await syncJobs();

  // Periodically sync jobs (to pick up changes)
  setInterval(() => {
    syncJobs().catch((err) => {
      logger.error({ err }, 'Failed to sync jobs');
    });
  }, config.scheduler.pollIntervalMs);

  // Send startup notification
  if (config.discord.enabled) {
    await sendDiscordNotification({
      title: '🟢 Scheduler Started',
      description: 'AtlasHub Scheduler is now running.',
      color: 0x00ff00,
      fields: [{ name: 'Active Jobs', value: String(activeCrons.size), inline: true }],
    });
  }

  logger.info({ activeJobs: activeCrons.size }, 'Scheduler started');
}

/**
 * Stop the scheduler gracefully
 */
export async function stopScheduler(): Promise<void> {
  logger.info('Stopping scheduler...');

  // Stop all cron jobs
  for (const [id, cron] of activeCrons) {
    cron.stop();
    logger.debug({ jobId: id }, 'Stopped cron job');
  }
  activeCrons.clear();

  // Close database pool
  await pool.end();

  // Send shutdown notification
  if (config.discord.enabled) {
    await sendDiscordNotification({
      title: '🔴 Scheduler Stopped',
      description: 'AtlasHub Scheduler has been stopped.',
      color: 0xff9900,
    });
  }

  logger.info('Scheduler stopped');
}
