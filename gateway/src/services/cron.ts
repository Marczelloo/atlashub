import { platformDb } from '../db/platform.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { auditService } from './audit.js';

export interface CronJob {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
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
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CronJobRun {
  id: string;
  jobId: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  status: 'running' | 'success' | 'fail' | 'timeout' | 'cancelled';
  httpStatus: number | null;
  errorText: string | null;
  logObjectKey: string | null;
  logPreview: string | null;
  attemptNumber: number;
  createdAt: Date;
}

export interface CreateCronJobInput {
  projectId?: string | null;
  name: string;
  description?: string;
  jobType: 'http' | 'platform';
  scheduleCron: string;
  timezone?: string;
  httpUrl?: string;
  httpMethod?: string;
  httpHeaders?: Record<string, string>;
  httpBody?: unknown;
  platformAction?: string;
  platformConfig?: Record<string, unknown>;
  enabled?: boolean;
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
}

export interface UpdateCronJobInput {
  name?: string;
  description?: string;
  scheduleCron?: string;
  timezone?: string;
  httpUrl?: string;
  httpMethod?: string;
  httpHeaders?: Record<string, string>;
  httpBody?: unknown;
  platformAction?: string;
  platformConfig?: Record<string, unknown>;
  enabled?: boolean;
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
}

// Parse cron expression and compute next run time
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseNextRunTime(_cronExpression: string, _timezone = 'UTC'): Date {
  // Simple cron parser for: minute hour day month weekday
  // For MVP: support basic patterns
  const now = new Date();
  // For simplicity, just schedule 1 minute in the future if enabled
  // In production, use a proper cron parser like cron-parser package
  return new Date(now.getTime() + 60000);
}

// Validate cron expression (basic validation)
function validateCronExpression(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  // Standard cron: 5 parts (minute hour day month weekday)
  // Extended: 6 parts (second minute hour day month weekday)
  return parts.length >= 5 && parts.length <= 6;
}

// Allowed platform actions (whitelist)
const ALLOWED_PLATFORM_ACTIONS = [
  'backup.platform',
  'backup.project',
  'cleanup.audit_logs',
  'cleanup.old_runs',
  'cleanup.expired_backups',
];

export const cronService = {
  async listJobs(projectId?: string | null): Promise<CronJob[]> {
    let query = `
      SELECT id, project_id, name, description, job_type, schedule_cron, timezone,
             http_url, http_method, http_headers_encrypted, http_body_encrypted,
             headers_iv, headers_auth_tag, body_iv, body_auth_tag,
             platform_action, platform_config, enabled, timeout_ms, retries, retry_backoff_ms,
             last_run_at, next_run_at, created_at, updated_at
      FROM cron_jobs
    `;
    const params: unknown[] = [];

    if (projectId !== undefined) {
      if (projectId === null) {
        query += ' WHERE project_id IS NULL';
      } else {
        query += ' WHERE project_id = $1';
        params.push(projectId);
      }
    }

    query += ' ORDER BY created_at DESC';

    const result = await platformDb.query<{
      id: string;
      project_id: string | null;
      name: string;
      description: string | null;
      job_type: 'http' | 'platform';
      schedule_cron: string;
      timezone: string;
      http_url: string | null;
      http_method: string | null;
      http_headers_encrypted: string | null;
      http_body_encrypted: string | null;
      headers_iv: string | null;
      headers_auth_tag: string | null;
      body_iv: string | null;
      body_auth_tag: string | null;
      platform_action: string | null;
      platform_config: Record<string, unknown> | null;
      enabled: boolean;
      timeout_ms: number;
      retries: number;
      retry_backoff_ms: number;
      last_run_at: Date | null;
      next_run_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      jobType: row.job_type,
      scheduleCron: row.schedule_cron,
      timezone: row.timezone,
      httpUrl: row.http_url,
      httpMethod: row.http_method,
      httpHeaders:
        row.http_headers_encrypted && row.headers_iv && row.headers_auth_tag
          ? JSON.parse(decrypt(row.http_headers_encrypted, row.headers_iv, row.headers_auth_tag))
          : null,
      httpBody:
        row.http_body_encrypted && row.body_iv && row.body_auth_tag
          ? JSON.parse(decrypt(row.http_body_encrypted, row.body_iv, row.body_auth_tag))
          : null,
      platformAction: row.platform_action,
      platformConfig: row.platform_config,
      enabled: row.enabled,
      timeoutMs: row.timeout_ms,
      retries: row.retries,
      retryBackoffMs: row.retry_backoff_ms,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  async getJob(id: string): Promise<CronJob | null> {
    const result = await platformDb.query<{
      id: string;
      project_id: string | null;
      name: string;
      description: string | null;
      job_type: 'http' | 'platform';
      schedule_cron: string;
      timezone: string;
      http_url: string | null;
      http_method: string | null;
      http_headers_encrypted: string | null;
      http_body_encrypted: string | null;
      headers_iv: string | null;
      headers_auth_tag: string | null;
      body_iv: string | null;
      body_auth_tag: string | null;
      platform_action: string | null;
      platform_config: Record<string, unknown> | null;
      enabled: boolean;
      timeout_ms: number;
      retries: number;
      retry_backoff_ms: number;
      last_run_at: Date | null;
      next_run_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, project_id, name, description, job_type, schedule_cron, timezone,
              http_url, http_method, http_headers_encrypted, http_body_encrypted,
              headers_iv, headers_auth_tag, body_iv, body_auth_tag,
              platform_action, platform_config, enabled, timeout_ms, retries, retry_backoff_ms,
              last_run_at, next_run_at, created_at, updated_at
       FROM cron_jobs WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      jobType: row.job_type,
      scheduleCron: row.schedule_cron,
      timezone: row.timezone,
      httpUrl: row.http_url,
      httpMethod: row.http_method,
      httpHeaders:
        row.http_headers_encrypted && row.headers_iv && row.headers_auth_tag
          ? JSON.parse(decrypt(row.http_headers_encrypted, row.headers_iv, row.headers_auth_tag))
          : null,
      httpBody:
        row.http_body_encrypted && row.body_iv && row.body_auth_tag
          ? JSON.parse(decrypt(row.http_body_encrypted, row.body_iv, row.body_auth_tag))
          : null,
      platformAction: row.platform_action,
      platformConfig: row.platform_config,
      enabled: row.enabled,
      timeoutMs: row.timeout_ms,
      retries: row.retries,
      retryBackoffMs: row.retry_backoff_ms,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async createJob(input: CreateCronJobInput, userId?: string): Promise<CronJob> {
    // Validate cron expression
    if (!validateCronExpression(input.scheduleCron)) {
      throw new BadRequestError('Invalid cron expression');
    }

    // Validate platform action if applicable
    if (input.jobType === 'platform') {
      if (!input.platformAction || !ALLOWED_PLATFORM_ACTIONS.includes(input.platformAction)) {
        throw new BadRequestError(
          `Invalid platform action. Allowed: ${ALLOWED_PLATFORM_ACTIONS.join(', ')}`
        );
      }
    }

    // Validate HTTP job has URL
    if (input.jobType === 'http' && !input.httpUrl) {
      throw new BadRequestError('HTTP jobs require a URL');
    }

    // Encrypt headers and body if provided
    let headersEncrypted: string | null = null;
    let headersIv: string | null = null;
    let headersAuthTag: string | null = null;
    let bodyEncrypted: string | null = null;
    let bodyIv: string | null = null;
    let bodyAuthTag: string | null = null;

    if (input.httpHeaders && Object.keys(input.httpHeaders).length > 0) {
      const enc = encrypt(JSON.stringify(input.httpHeaders));
      headersEncrypted = enc.encrypted;
      headersIv = enc.iv;
      headersAuthTag = enc.authTag;
    }

    if (input.httpBody !== undefined) {
      const enc = encrypt(JSON.stringify(input.httpBody));
      bodyEncrypted = enc.encrypted;
      bodyIv = enc.iv;
      bodyAuthTag = enc.authTag;
    }

    const nextRunAt =
      input.enabled !== false ? parseNextRunTime(input.scheduleCron, input.timezone) : null;

    const result = await platformDb.query<{ id: string }>(
      `INSERT INTO cron_jobs (
        project_id, name, description, job_type, schedule_cron, timezone,
        http_url, http_method, http_headers_encrypted, http_body_encrypted,
        headers_iv, headers_auth_tag, body_iv, body_auth_tag,
        platform_action, platform_config, enabled, timeout_ms, retries, retry_backoff_ms, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING id`,
      [
        input.projectId ?? null,
        input.name,
        input.description ?? null,
        input.jobType,
        input.scheduleCron,
        input.timezone ?? 'UTC',
        input.httpUrl ?? null,
        input.httpMethod ?? 'GET',
        headersEncrypted,
        bodyEncrypted,
        headersIv,
        headersAuthTag,
        bodyIv,
        bodyAuthTag,
        input.platformAction ?? null,
        input.platformConfig ? JSON.stringify(input.platformConfig) : null,
        input.enabled !== false,
        input.timeoutMs ?? 30000,
        input.retries ?? 0,
        input.retryBackoffMs ?? 1000,
        nextRunAt,
      ]
    );

    await auditService.log({
      action: 'cron_job.created',
      projectId: input.projectId ?? undefined,
      userId,
      details: { jobId: result.rows[0].id, name: input.name, jobType: input.jobType },
    });

    return (await this.getJob(result.rows[0].id))!;
  },

  async updateJob(id: string, input: UpdateCronJobInput, userId?: string): Promise<CronJob> {
    const job = await this.getJob(id);
    if (!job) {
      throw new NotFoundError('Cron job not found');
    }

    // Validate cron expression if provided
    if (input.scheduleCron && !validateCronExpression(input.scheduleCron)) {
      throw new BadRequestError('Invalid cron expression');
    }

    // Build update query dynamically
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    const addUpdate = (field: string, value: unknown) => {
      updates.push(`${field} = $${paramIndex++}`);
      params.push(value);
    };

    if (input.name !== undefined) addUpdate('name', input.name);
    if (input.description !== undefined) addUpdate('description', input.description);
    if (input.scheduleCron !== undefined) addUpdate('schedule_cron', input.scheduleCron);
    if (input.timezone !== undefined) addUpdate('timezone', input.timezone);
    if (input.httpUrl !== undefined) addUpdate('http_url', input.httpUrl);
    if (input.httpMethod !== undefined) addUpdate('http_method', input.httpMethod);
    if (input.platformAction !== undefined) addUpdate('platform_action', input.platformAction);
    if (input.platformConfig !== undefined)
      addUpdate('platform_config', JSON.stringify(input.platformConfig));
    if (input.enabled !== undefined) addUpdate('enabled', input.enabled);
    if (input.timeoutMs !== undefined) addUpdate('timeout_ms', input.timeoutMs);
    if (input.retries !== undefined) addUpdate('retries', input.retries);
    if (input.retryBackoffMs !== undefined) addUpdate('retry_backoff_ms', input.retryBackoffMs);

    if (input.httpHeaders !== undefined) {
      if (input.httpHeaders && Object.keys(input.httpHeaders).length > 0) {
        const enc = encrypt(JSON.stringify(input.httpHeaders));
        addUpdate('http_headers_encrypted', enc.encrypted);
        addUpdate('headers_iv', enc.iv);
        addUpdate('headers_auth_tag', enc.authTag);
      } else {
        addUpdate('http_headers_encrypted', null);
        addUpdate('headers_iv', null);
        addUpdate('headers_auth_tag', null);
      }
    }

    if (input.httpBody !== undefined) {
      if (input.httpBody !== null) {
        const enc = encrypt(JSON.stringify(input.httpBody));
        addUpdate('http_body_encrypted', enc.encrypted);
        addUpdate('body_iv', enc.iv);
        addUpdate('body_auth_tag', enc.authTag);
      } else {
        addUpdate('http_body_encrypted', null);
        addUpdate('body_iv', null);
        addUpdate('body_auth_tag', null);
      }
    }

    // Recalculate next_run_at if schedule or enabled changed
    if (input.scheduleCron !== undefined || input.enabled !== undefined) {
      const enabled = input.enabled ?? job.enabled;
      const schedule = input.scheduleCron ?? job.scheduleCron;
      const timezone = input.timezone ?? job.timezone;
      const nextRunAt = enabled ? parseNextRunTime(schedule, timezone) : null;
      addUpdate('next_run_at', nextRunAt);
    }

    if (updates.length === 0) {
      return job;
    }

    params.push(id);
    await platformDb.query(
      `UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    await auditService.log({
      action: 'cron_job.updated',
      projectId: job.projectId ?? undefined,
      userId,
      details: { jobId: id, changes: Object.keys(input) },
    });

    return (await this.getJob(id))!;
  },

  async deleteJob(id: string, userId?: string): Promise<void> {
    const job = await this.getJob(id);
    if (!job) {
      throw new NotFoundError('Cron job not found');
    }

    await platformDb.query('DELETE FROM cron_jobs WHERE id = $1', [id]);

    await auditService.log({
      action: 'cron_job.deleted',
      projectId: job.projectId ?? undefined,
      userId,
      details: { jobId: id, name: job.name },
    });
  },

  async toggleJob(id: string, enabled: boolean, userId?: string): Promise<CronJob> {
    return this.updateJob(id, { enabled }, userId);
  },

  // Run history
  async listRuns(jobId: string, limit = 50): Promise<CronJobRun[]> {
    const result = await platformDb.query<{
      id: string;
      job_id: string;
      started_at: Date;
      finished_at: Date | null;
      duration_ms: number | null;
      status: 'running' | 'success' | 'fail' | 'timeout' | 'cancelled';
      http_status: number | null;
      error_text: string | null;
      log_object_key: string | null;
      log_preview: string | null;
      attempt_number: number;
      created_at: Date;
    }>(
      `SELECT id, job_id, started_at, finished_at, duration_ms, status,
              http_status, error_text, log_object_key, log_preview, attempt_number, created_at
       FROM cron_job_runs
       WHERE job_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [jobId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      status: row.status,
      httpStatus: row.http_status,
      errorText: row.error_text,
      logObjectKey: row.log_object_key,
      logPreview: row.log_preview,
      attemptNumber: row.attempt_number,
      createdAt: row.created_at,
    }));
  },

  async createRun(jobId: string, attemptNumber = 1): Promise<string> {
    const result = await platformDb.query<{ id: string }>(
      `INSERT INTO cron_job_runs (job_id, attempt_number) VALUES ($1, $2) RETURNING id`,
      [jobId, attemptNumber]
    );
    return result.rows[0].id;
  },

  async updateRun(
    runId: string,
    update: {
      status?: 'running' | 'success' | 'fail' | 'timeout' | 'cancelled';
      httpStatus?: number;
      errorText?: string;
      logObjectKey?: string;
      logPreview?: string;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (update.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(update.status);
      if (update.status !== 'running') {
        updates.push(`finished_at = NOW()`);
        updates.push(`duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000`);
      }
    }
    if (update.httpStatus !== undefined) {
      updates.push(`http_status = $${paramIndex++}`);
      params.push(update.httpStatus);
    }
    if (update.errorText !== undefined) {
      updates.push(`error_text = $${paramIndex++}`);
      params.push(update.errorText);
    }
    if (update.logObjectKey !== undefined) {
      updates.push(`log_object_key = $${paramIndex++}`);
      params.push(update.logObjectKey);
    }
    if (update.logPreview !== undefined) {
      updates.push(`log_preview = $${paramIndex++}`);
      params.push(update.logPreview);
    }

    if (updates.length === 0) return;

    params.push(runId);
    await platformDb.query(
      `UPDATE cron_job_runs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );
  },

  async updateJobLastRun(jobId: string, nextRunAt?: Date): Promise<void> {
    await platformDb.query(
      `UPDATE cron_jobs SET last_run_at = NOW(), next_run_at = $2 WHERE id = $1`,
      [jobId, nextRunAt ?? null]
    );
  },

  // Get jobs that are due to run
  async getDueJobs(): Promise<CronJob[]> {
    const result = await platformDb.query<{
      id: string;
      project_id: string | null;
      name: string;
      description: string | null;
      job_type: 'http' | 'platform';
      schedule_cron: string;
      timezone: string;
      http_url: string | null;
      http_method: string | null;
      http_headers_encrypted: string | null;
      http_body_encrypted: string | null;
      headers_iv: string | null;
      headers_auth_tag: string | null;
      body_iv: string | null;
      body_auth_tag: string | null;
      platform_action: string | null;
      platform_config: Record<string, unknown> | null;
      enabled: boolean;
      timeout_ms: number;
      retries: number;
      retry_backoff_ms: number;
      last_run_at: Date | null;
      next_run_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT id, project_id, name, description, job_type, schedule_cron, timezone,
             http_url, http_method, http_headers_encrypted, http_body_encrypted,
             headers_iv, headers_auth_tag, body_iv, body_auth_tag,
             platform_action, platform_config, enabled, timeout_ms, retries, retry_backoff_ms,
             last_run_at, next_run_at, created_at, updated_at
      FROM cron_jobs
      WHERE enabled = true AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT 10
    `);

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      jobType: row.job_type,
      scheduleCron: row.schedule_cron,
      timezone: row.timezone,
      httpUrl: row.http_url,
      httpMethod: row.http_method,
      httpHeaders:
        row.http_headers_encrypted && row.headers_iv && row.headers_auth_tag
          ? JSON.parse(decrypt(row.http_headers_encrypted, row.headers_iv, row.headers_auth_tag))
          : null,
      httpBody:
        row.http_body_encrypted && row.body_iv && row.body_auth_tag
          ? JSON.parse(decrypt(row.http_body_encrypted, row.body_iv, row.body_auth_tag))
          : null,
      platformAction: row.platform_action,
      platformConfig: row.platform_config,
      enabled: row.enabled,
      timeoutMs: row.timeout_ms,
      retries: row.retries,
      retryBackoffMs: row.retry_backoff_ms,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },
};
