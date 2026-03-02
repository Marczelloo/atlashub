import { randomUUID } from 'crypto';
import { platformDb } from '../db/platform.js';

export interface AuditLogEntry {
  action: string;
  projectId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown>;
}

export const auditService = {
  /**
   * Log an action to the audit trail
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await platformDb.query(
        `INSERT INTO audit_logs (id, action, project_id, user_id, details, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          randomUUID(),
          entry.action,
          entry.projectId || null,
          entry.userId || null,
          entry.details ? JSON.stringify(entry.details) : null,
        ]
      );
    } catch (error) {
      // Don't let audit logging failures break the main operation
      console.error('Failed to log audit entry:', error);
    }
  },

  // Common action types
  actions: {
    // Projects
    PROJECT_CREATED: 'project.created',
    PROJECT_DELETED: 'project.deleted',

    // Users
    USER_CREATED: 'user.created',
    USER_LOGIN: 'user.login',
    USER_DELETED: 'user.deleted',

    // API Keys
    KEY_CREATED: 'key.created',
    KEY_ROTATED: 'key.rotated',
    KEY_REVOKED: 'key.revoked',

    // Invites
    INVITE_CREATED: 'invite.created',
    INVITE_USED: 'invite.used',

    // Storage
    FILE_UPLOADED: 'file.uploaded',
    FILE_DELETED: 'file.deleted',
    BUCKET_CREATED: 'bucket.created',

    // SQL
    SQL_EXECUTED: 'sql.executed',
    TABLE_CREATED: 'table.created',

    // Webhooks
    WEBHOOK_CREATED: 'webhook.created',
    WEBHOOK_UPDATED: 'webhook.updated',
    WEBHOOK_DELETED: 'webhook.deleted',
  },
};
