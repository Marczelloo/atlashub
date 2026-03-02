import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { platformDb } from '../db/platform.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { auditService } from './audit.js';

// Webhook event types
export type WebhookEventType = 'record.created' | 'record.updated' | 'record.deleted';

export const WEBHOOK_EVENTS: WebhookEventType[] = ['record.created', 'record.updated', 'record.deleted'];

// Max payload size to store (100KB)
const MAX_PAYLOAD_SIZE = 100 * 1024;

// Max response body size to store (10KB)
const MAX_RESPONSE_SIZE = 10 * 1024;

export interface Webhook {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  secretHash: string;
  events: WebhookEventType[];
  tableFilter: string[];
  headers: Record<string, string>;
  timeoutMs: number;
  enabled: boolean;
  maxRetries: number;
  retryBackoffMs: number;
  lastTriggeredAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: WebhookEventType;
  projectId: string;
  tableName: string;
  payload: Record<string, unknown>;
  requestHeaders: Record<string, string> | null;
  httpStatus: number | null;
  responseBody: string | null;
  responseHeaders: Record<string, string> | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attemptNumber: number;
  nextRetryAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface CreateWebhookInput {
  projectId: string;
  name: string;
  description?: string;
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  secret: string; // The raw secret (will be hashed)
  events: WebhookEventType[];
  tableFilter?: string[];
  headers?: Record<string, string>;
  timeoutMs?: number;
  enabled?: boolean;
  maxRetries?: number;
  retryBackoffMs?: number;
}

export interface UpdateWebhookInput {
  name?: string;
  description?: string;
  url?: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  secret?: string; // New secret (will be hashed)
  events?: WebhookEventType[];
  tableFilter?: string[];
  headers?: Record<string, string>;
  timeoutMs?: number;
  enabled?: boolean;
  maxRetries?: number;
  retryBackoffMs?: number;
}

export interface WebhookTriggerPayload {
  eventType: WebhookEventType;
  projectId: string;
  tableName: string;
  record: Record<string, unknown>;
  oldRecord?: Record<string, unknown>;
  timestamp: Date;
}

// Hash a secret for storage
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// Generate HMAC-SHA256 signature for payload verification
export function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

// Verify HMAC-SHA256 signature (constant-time comparison)
export function verifySignature(payload: string, secret: string, signature: string): boolean {
  const expectedSignature = generateSignature(payload, secret);
  // Extract the hash part if it includes the prefix
  const expectedHash = expectedSignature;
  const providedHash = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;

  // Use constant-time comparison
  try {
    return timingSafeEqual(Buffer.from(expectedHash), Buffer.from(providedHash));
  } catch {
    return false;
  }
}

// Calculate exponential backoff delay
function calculateBackoff(attempt: number, baseMs: number): number {
  // Exponential backoff with jitter: base * 2^attempt + random(0, base)
  const exponentialDelay = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * baseMs);
  return exponentialDelay + jitter;
}

// Truncate string to max length
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...[truncated]';
}

export const webhookService = {
  // ============================================================
  // Webhook CRUD Operations
  // ============================================================

  async listWebhooks(projectId: string): Promise<Webhook[]> {
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      name: string;
      description: string | null;
      url: string;
      method: string;
      secret_hash: string;
      events: WebhookEventType[];
      table_filter: string[];
      headers: Record<string, string>;
      timeout_ms: number;
      enabled: boolean;
      max_retries: number;
      retry_backoff_ms: number;
      last_triggered_at: Date | null;
      last_success_at: Date | null;
      last_failure_at: Date | null;
      created_by: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, project_id, name, description, url, method, secret_hash,
              events, table_filter, headers, timeout_ms, enabled, max_retries, retry_backoff_ms,
              last_triggered_at, last_success_at, last_failure_at, created_by, created_at, updated_at
       FROM webhooks
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      url: row.url,
      method: row.method as 'POST' | 'PUT' | 'PATCH',
      secretHash: row.secret_hash,
      events: row.events,
      tableFilter: row.table_filter,
      headers: row.headers,
      timeoutMs: row.timeout_ms,
      enabled: row.enabled,
      maxRetries: row.max_retries,
      retryBackoffMs: row.retry_backoff_ms,
      lastTriggeredAt: row.last_triggered_at,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  async getWebhook(id: string): Promise<Webhook | null> {
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      name: string;
      description: string | null;
      url: string;
      method: string;
      secret_hash: string;
      events: WebhookEventType[];
      table_filter: string[];
      headers: Record<string, string>;
      timeout_ms: number;
      enabled: boolean;
      max_retries: number;
      retry_backoff_ms: number;
      last_triggered_at: Date | null;
      last_success_at: Date | null;
      last_failure_at: Date | null;
      created_by: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, project_id, name, description, url, method, secret_hash,
              events, table_filter, headers, timeout_ms, enabled, max_retries, retry_backoff_ms,
              last_triggered_at, last_success_at, last_failure_at, created_by, created_at, updated_at
       FROM webhooks WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      url: row.url,
      method: row.method as 'POST' | 'PUT' | 'PATCH',
      secretHash: row.secret_hash,
      events: row.events,
      tableFilter: row.table_filter,
      headers: row.headers,
      timeoutMs: row.timeout_ms,
      enabled: row.enabled,
      maxRetries: row.max_retries,
      retryBackoffMs: row.retry_backoff_ms,
      lastTriggeredAt: row.last_triggered_at,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async createWebhook(input: CreateWebhookInput, userId?: string): Promise<Webhook> {
    // Validate events
    const invalidEvents = input.events.filter((e) => !WEBHOOK_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      throw new BadRequestError(`Invalid event types: ${invalidEvents.join(', ')}`);
    }

    if (input.events.length === 0) {
      throw new BadRequestError('At least one event type is required');
    }

    // Validate URL
    try {
      const url = new URL(input.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new BadRequestError('URL must use HTTP or HTTPS protocol');
      }
    } catch (e) {
      throw new BadRequestError('Invalid URL format');
    }

    // Validate secret length
    if (input.secret.length < 16) {
      throw new BadRequestError('Secret must be at least 16 characters');
    }

    const result = await platformDb.query<{ id: string }>(
      `INSERT INTO webhooks (
        project_id, name, description, url, method, secret_hash,
        events, table_filter, headers, timeout_ms, enabled, max_retries, retry_backoff_ms, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        input.projectId,
        input.name,
        input.description ?? null,
        input.url,
        input.method ?? 'POST',
        hashSecret(input.secret),
        JSON.stringify(input.events),
        JSON.stringify(input.tableFilter ?? []),
        JSON.stringify(input.headers ?? {}),
        input.timeoutMs ?? 30000,
        input.enabled !== false,
        input.maxRetries ?? 3,
        input.retryBackoffMs ?? 1000,
        userId ?? null,
      ]
    );

    await auditService.log({
      action: 'webhook.created',
      projectId: input.projectId,
      userId,
      details: { webhookId: result.rows[0].id, name: input.name, events: input.events },
    });

    return (await this.getWebhook(result.rows[0].id))!;
  },

  async updateWebhook(id: string, input: UpdateWebhookInput, userId?: string): Promise<Webhook> {
    const webhook = await this.getWebhook(id);
    if (!webhook) {
      throw new NotFoundError('Webhook not found');
    }

    // Validate events if provided
    if (input.events) {
      const invalidEvents = input.events.filter((e) => !WEBHOOK_EVENTS.includes(e));
      if (invalidEvents.length > 0) {
        throw new BadRequestError(`Invalid event types: ${invalidEvents.join(', ')}`);
      }
      if (input.events.length === 0) {
        throw new BadRequestError('At least one event type is required');
      }
    }

    // Validate URL if provided
    if (input.url) {
      try {
        const url = new URL(input.url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new BadRequestError('URL must use HTTP or HTTPS protocol');
        }
      } catch (e) {
        throw new BadRequestError('Invalid URL format');
      }
    }

    // Validate secret length if provided
    if (input.secret && input.secret.length < 16) {
      throw new BadRequestError('Secret must be at least 16 characters');
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
    if (input.url !== undefined) addUpdate('url', input.url);
    if (input.method !== undefined) addUpdate('method', input.method);
    if (input.secret !== undefined) addUpdate('secret_hash', hashSecret(input.secret));
    if (input.events !== undefined) addUpdate('events', JSON.stringify(input.events));
    if (input.tableFilter !== undefined) addUpdate('table_filter', JSON.stringify(input.tableFilter));
    if (input.headers !== undefined) addUpdate('headers', JSON.stringify(input.headers));
    if (input.timeoutMs !== undefined) addUpdate('timeout_ms', input.timeoutMs);
    if (input.enabled !== undefined) addUpdate('enabled', input.enabled);
    if (input.maxRetries !== undefined) addUpdate('max_retries', input.maxRetries);
    if (input.retryBackoffMs !== undefined) addUpdate('retry_backoff_ms', input.retryBackoffMs);

    if (updates.length === 0) {
      return webhook;
    }

    params.push(id);
    await platformDb.query(
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    await auditService.log({
      action: 'webhook.updated',
      projectId: webhook.projectId,
      userId,
      details: { webhookId: id, changes: Object.keys(input) },
    });

    return (await this.getWebhook(id))!;
  },

  async deleteWebhook(id: string, userId?: string): Promise<void> {
    const webhook = await this.getWebhook(id);
    if (!webhook) {
      throw new NotFoundError('Webhook not found');
    }

    await platformDb.query('DELETE FROM webhooks WHERE id = $1', [id]);

    await auditService.log({
      action: 'webhook.deleted',
      projectId: webhook.projectId,
      userId,
      details: { webhookId: id, name: webhook.name },
    });
  },

  async toggleWebhook(id: string, enabled: boolean, userId?: string): Promise<Webhook> {
    return this.updateWebhook(id, { enabled }, userId);
  },

  // ============================================================
  // Webhook Triggering and Delivery
  // ============================================================

  /**
   * Trigger webhooks for a database event
   * This should be called after insert/update/delete operations
   */
  async triggerWebhooks(payload: WebhookTriggerPayload): Promise<void> {
    // Find all enabled webhooks for this project that subscribe to this event
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      url: string;
      method: string;
      secret_hash: string;
      events: WebhookEventType[];
      table_filter: string[];
      headers: Record<string, string>;
      timeout_ms: number;
      max_retries: number;
      retry_backoff_ms: number;
    }>(
      `SELECT id, project_id, url, method, secret_hash, events, table_filter, headers, timeout_ms, max_retries, retry_backoff_ms
       FROM webhooks
       WHERE project_id = $1 AND enabled = true AND events @> $2::jsonb`,
      [payload.projectId, JSON.stringify([payload.eventType])]
    );

    for (const webhook of result.rows) {
      // Check table filter
      if (webhook.table_filter.length > 0 && !webhook.table_filter.includes(payload.tableName)) {
        continue;
      }

      // Create delivery record
      const deliveryId = await this.createDelivery({
        webhookId: webhook.id,
        eventType: payload.eventType,
        projectId: payload.projectId,
        tableName: payload.tableName,
        payload: {
          event: payload.eventType,
          project_id: payload.projectId,
          table: payload.tableName,
          data: payload.record,
          old_data: payload.oldRecord,
          timestamp: payload.timestamp.toISOString(),
        },
      });

      // Queue the delivery (run asynchronously)
      this.deliverWebhook(deliveryId, webhook, payload).catch((error) => {
        console.error(`Webhook delivery error for ${webhook.id}:`, error);
      });
    }
  },

  /**
   * Create a delivery record
   */
  async createDelivery(input: {
    webhookId: string;
    eventType: WebhookEventType;
    projectId: string;
    tableName: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    // Truncate payload if too large
    let payloadStr = JSON.stringify(input.payload);
    if (payloadStr.length > MAX_PAYLOAD_SIZE) {
      input.payload = {
        ...input.payload,
        _truncated: true,
        _message: 'Payload was too large and has been truncated',
      };
      payloadStr = JSON.stringify(input.payload);
      if (payloadStr.length > MAX_PAYLOAD_SIZE) {
        input.payload = {
          event: input.eventType,
          project_id: input.projectId,
          table: input.tableName,
          _truncated: true,
          _message: 'Original payload was too large',
          timestamp: input.payload.timestamp || new Date().toISOString(),
        };
      }
    }

    const result = await platformDb.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, project_id, table_name, payload, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [input.webhookId, input.eventType, input.projectId, input.tableName, JSON.stringify(input.payload)]
    );

    return result.rows[0].id;
  },

  /**
   * Deliver a webhook (with retry logic)
   */
  async deliverWebhook(
    deliveryId: string,
    webhookConfig: {
      id: string;
      url: string;
      method: string;
      secret_hash: string;
      headers: Record<string, string>;
      timeout_ms: number;
      max_retries: number;
      retry_backoff_ms: number;
    },
    payload: WebhookTriggerPayload,
    attemptNumber = 1
  ): Promise<boolean> {
    const delivery = await this.getDelivery(deliveryId);
    if (!delivery) {
      console.error(`Delivery ${deliveryId} not found`);
      return false;
    }

    const payloadStr = JSON.stringify(delivery.payload);
    const startTime = Date.now();

    // Update delivery status to indicate we're attempting
    await this.updateDelivery(deliveryId, {
      status: attemptNumber > 1 ? 'retrying' : 'pending',
      attemptNumber,
    });

    try {
      // Generate signature using a deterministic secret reference
      // Note: In production, the actual secret should be passed from the route handler
      // For now, we use the secret hash as an identifier
      const signature = generateSignature(payloadStr, webhookConfig.secret_hash);

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-AtlasHub-Event': payload.eventType,
        'X-AtlasHub-Delivery': deliveryId,
        'X-AtlasHub-Signature': signature,
        'User-Agent': 'AtlasHub-Webhook/1.0',
        ...webhookConfig.headers,
      };

      // Make HTTP request using fetch (Node.js 18+)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), webhookConfig.timeout_ms);

      let response: Response;
      try {
        response = await fetch(webhookConfig.url, {
          method: webhookConfig.method,
          headers,
          body: payloadStr,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text();

      // Check if successful (2xx status code)
      const isSuccess = response.status >= 200 && response.status < 300;

      if (isSuccess) {
        // Update delivery as successful
        await this.updateDelivery(deliveryId, {
          status: 'success',
          httpStatus: response.status,
          responseBody: truncate(responseBody, MAX_RESPONSE_SIZE),
          responseHeaders: Object.fromEntries(response.headers.entries()),
          durationMs,
          completedAt: new Date(),
        });

        // Update webhook last success
        await platformDb.query(
          `UPDATE webhooks SET last_triggered_at = NOW(), last_success_at = NOW() WHERE id = $1`,
          [webhookConfig.id]
        );

        return true;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.status}`);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if we should retry
      const shouldRetry = attemptNumber < webhookConfig.max_retries;
      const nextRetryAt = shouldRetry
        ? new Date(Date.now() + calculateBackoff(attemptNumber, webhookConfig.retry_backoff_ms))
        : null;

      // Update delivery status
      await this.updateDelivery(deliveryId, {
        status: shouldRetry ? 'retrying' : 'failed',
        errorMessage: truncate(errorMessage, 1000),
        durationMs,
        nextRetryAt,
      });

      // Update webhook last failure
      await platformDb.query(
        `UPDATE webhooks SET last_triggered_at = NOW(), last_failure_at = NOW() WHERE id = $1`,
        [webhookConfig.id]
      );

      if (shouldRetry) {
        // Schedule retry (in production, this would use a job queue)
        console.log(`Scheduling retry ${attemptNumber + 1}/${webhookConfig.max_retries} for delivery ${deliveryId}`);
        // For MVP, we'll just log it - in production, integrate with the scheduler
      }

      return false;
    }
  },

  /**
   * Get pending retries that are due
   */
  async getPendingRetries(): Promise<Array<{ deliveryId: string; webhookId: string; attemptNumber: number }>> {
    const result = await platformDb.query<{
      id: string;
      webhook_id: string;
      attempt_number: number;
    }>(
      `SELECT id, webhook_id, attempt_number
       FROM webhook_deliveries
       WHERE status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW()
       LIMIT 100`
    );

    return result.rows.map((row) => ({
      deliveryId: row.id,
      webhookId: row.webhook_id,
      attemptNumber: row.attempt_number,
    }));
  },

  // ============================================================
  // Delivery History
  // ============================================================

  async listDeliveries(
    webhookId: string,
    options: { limit?: number; status?: string } = {}
  ): Promise<WebhookDelivery[]> {
    const limit = options.limit ?? 50;
    let query = `
      SELECT id, webhook_id, event_type, project_id, table_name, payload, request_headers,
             http_status, response_body, response_headers, started_at, completed_at, duration_ms,
             status, attempt_number, next_retry_at, error_message, created_at
      FROM webhook_deliveries
      WHERE webhook_id = $1
    `;
    const params: unknown[] = [webhookId];
    let paramIndex = 2;

    if (options.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(options.status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await platformDb.query<{
      id: string;
      webhook_id: string;
      event_type: WebhookEventType;
      project_id: string;
      table_name: string;
      payload: Record<string, unknown>;
      request_headers: Record<string, string> | null;
      http_status: number | null;
      response_body: string | null;
      response_headers: Record<string, string> | null;
      started_at: Date;
      completed_at: Date | null;
      duration_ms: number | null;
      status: 'pending' | 'success' | 'failed' | 'retrying';
      attempt_number: number;
      next_retry_at: Date | null;
      error_message: string | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      webhookId: row.webhook_id,
      eventType: row.event_type,
      projectId: row.project_id,
      tableName: row.table_name,
      payload: row.payload,
      requestHeaders: row.request_headers,
      httpStatus: row.http_status,
      responseBody: row.response_body,
      responseHeaders: row.response_headers,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      status: row.status,
      attemptNumber: row.attempt_number,
      nextRetryAt: row.next_retry_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
  },

  async getDelivery(id: string): Promise<WebhookDelivery | null> {
    const result = await platformDb.query<{
      id: string;
      webhook_id: string;
      event_type: WebhookEventType;
      project_id: string;
      table_name: string;
      payload: Record<string, unknown>;
      request_headers: Record<string, string> | null;
      http_status: number | null;
      response_body: string | null;
      response_headers: Record<string, string> | null;
      started_at: Date;
      completed_at: Date | null;
      duration_ms: number | null;
      status: 'pending' | 'success' | 'failed' | 'retrying';
      attempt_number: number;
      next_retry_at: Date | null;
      error_message: string | null;
      created_at: Date;
    }>(
      `SELECT id, webhook_id, event_type, project_id, table_name, payload, request_headers,
              http_status, response_body, response_headers, started_at, completed_at, duration_ms,
              status, attempt_number, next_retry_at, error_message, created_at
       FROM webhook_deliveries WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      webhookId: row.webhook_id,
      eventType: row.event_type,
      projectId: row.project_id,
      tableName: row.table_name,
      payload: row.payload,
      requestHeaders: row.request_headers,
      httpStatus: row.http_status,
      responseBody: row.response_body,
      responseHeaders: row.response_headers,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      status: row.status,
      attemptNumber: row.attempt_number,
      nextRetryAt: row.next_retry_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  },

  async updateDelivery(
    id: string,
    update: {
      status?: 'pending' | 'success' | 'failed' | 'retrying';
      httpStatus?: number;
      responseBody?: string;
      responseHeaders?: Record<string, string>;
      durationMs?: number;
      completedAt?: Date;
      attemptNumber?: number;
      nextRetryAt?: Date | null;
      errorMessage?: string;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (update.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(update.status);
    }
    if (update.httpStatus !== undefined) {
      updates.push(`http_status = $${paramIndex++}`);
      params.push(update.httpStatus);
    }
    if (update.responseBody !== undefined) {
      updates.push(`response_body = $${paramIndex++}`);
      params.push(update.responseBody);
    }
    if (update.responseHeaders !== undefined) {
      updates.push(`response_headers = $${paramIndex++}`);
      params.push(JSON.stringify(update.responseHeaders));
    }
    if (update.durationMs !== undefined) {
      updates.push(`duration_ms = $${paramIndex++}`);
      params.push(update.durationMs);
    }
    if (update.completedAt !== undefined) {
      updates.push(`completed_at = $${paramIndex++}`);
      params.push(update.completedAt);
    }
    if (update.attemptNumber !== undefined) {
      updates.push(`attempt_number = $${paramIndex++}`);
      params.push(update.attemptNumber);
    }
    if (update.nextRetryAt !== undefined) {
      updates.push(`next_retry_at = $${paramIndex++}`);
      params.push(update.nextRetryAt);
    }
    if (update.errorMessage !== undefined) {
      updates.push(`error_message = $${paramIndex++}`);
      params.push(update.errorMessage);
    }

    if (updates.length === 0) return;

    params.push(id);
    await platformDb.query(
      `UPDATE webhook_deliveries SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );
  },

  // ============================================================
  // Redelivery
  // ============================================================

  async redeliver(deliveryId: string): Promise<boolean> {
    const delivery = await this.getDelivery(deliveryId);
    if (!delivery) {
      throw new NotFoundError('Delivery not found');
    }

    const webhook = await this.getWebhook(delivery.webhookId);
    if (!webhook) {
      throw new NotFoundError('Webhook not found');
    }

    if (!webhook.enabled) {
      throw new BadRequestError('Webhook is disabled');
    }

    // Create a new delivery record for this redelivery attempt
    const newDeliveryId = await this.createDelivery({
      webhookId: webhook.id,
      eventType: delivery.eventType,
      projectId: delivery.projectId,
      tableName: delivery.tableName,
      payload: delivery.payload,
    });

    // Attempt delivery
    return this.deliverWebhook(
      newDeliveryId,
      {
        id: webhook.id,
        url: webhook.url,
        method: webhook.method,
        secret_hash: webhook.secretHash,
        headers: webhook.headers,
        timeout_ms: webhook.timeoutMs,
        max_retries: webhook.maxRetries,
        retry_backoff_ms: webhook.retryBackoffMs,
      },
      {
        eventType: delivery.eventType,
        projectId: delivery.projectId,
        tableName: delivery.tableName,
        record: (delivery.payload.data as Record<string, unknown>) || {},
        oldRecord: (delivery.payload.old_data as Record<string, unknown>) || undefined,
        timestamp: new Date(),
      }
    );
  },
};
