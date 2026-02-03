import { spawn } from 'node:child_process';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';
import { platformDb } from '../db/platform.js';
import { auditService } from './audit.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

const BACKUP_BUCKET = 'atlashub-backups';

const s3Client = new S3Client({
  endpoint: `http${config.minio.useSSL ? 's' : ''}://${config.minio.endpoint}:${config.minio.port}`,
  region: config.minio.region,
  credentials: {
    accessKeyId: config.minio.accessKey,
    secretAccessKey: config.minio.secretKey,
  },
  forcePathStyle: true,
});

export interface Backup {
  id: string;
  projectId: string | null;
  backupType: 'platform' | 'project' | 'table';
  tableName: string | null;
  objectKey: string;
  sizeBytes: number;
  format: 'sql' | 'csv' | 'json';
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage: string | null;
  retentionDays: number | null;
  expiresAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreateBackupInput {
  projectId?: string | null;
  backupType: 'platform' | 'project' | 'table';
  tableName?: string;
  format?: 'sql' | 'csv' | 'json';
  retentionDays?: number;
}

// Run pg_dump command
async function runPgDump(
  connectionString: string,
  options: string[] = []
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = ['-d', connectionString, ...options];
    const proc = spawn('pg_dump', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: string[] = [];

    proc.stdout.on('data', (data) => stdoutChunks.push(data));
    proc.stderr.on('data', (data) => stderrChunks.push(data.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: stderrChunks.join(''),
        });
      } else {
        reject(new Error(`pg_dump exited with code ${code}: ${stderrChunks.join('')}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn pg_dump: ${err.message}`));
    });
  });
}

// Ensure backup bucket exists
async function ensureBackupBucket(): Promise<void> {
  try {
    await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BACKUP_BUCKET,
        MaxKeys: 1,
      })
    );
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'NoSuchBucket') {
      // Create bucket
      const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
      await s3Client.send(new CreateBucketCommand({ Bucket: BACKUP_BUCKET }));
    } else {
      throw error;
    }
  }
}

export const backupService = {
  async listBackups(projectId?: string | null): Promise<Backup[]> {
    let query = `
      SELECT id, project_id, backup_type, table_name, object_key, size_bytes, format,
             status, error_message, retention_days, expires_at, created_by, created_at, completed_at
      FROM backups
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

    query += ' ORDER BY created_at DESC LIMIT 100';

    const result = await platformDb.query<{
      id: string;
      project_id: string | null;
      backup_type: 'platform' | 'project' | 'table';
      table_name: string | null;
      object_key: string;
      size_bytes: string;
      format: 'sql' | 'csv' | 'json';
      status: 'pending' | 'running' | 'completed' | 'failed';
      error_message: string | null;
      retention_days: number | null;
      expires_at: Date | null;
      created_by: string | null;
      created_at: Date;
      completed_at: Date | null;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      backupType: row.backup_type,
      tableName: row.table_name,
      objectKey: row.object_key,
      sizeBytes: parseInt(row.size_bytes, 10),
      format: row.format,
      status: row.status,
      errorMessage: row.error_message,
      retentionDays: row.retention_days,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  },

  async getBackup(id: string): Promise<Backup | null> {
    const result = await platformDb.query<{
      id: string;
      project_id: string | null;
      backup_type: 'platform' | 'project' | 'table';
      table_name: string | null;
      object_key: string;
      size_bytes: string;
      format: 'sql' | 'csv' | 'json';
      status: 'pending' | 'running' | 'completed' | 'failed';
      error_message: string | null;
      retention_days: number | null;
      expires_at: Date | null;
      created_by: string | null;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id, project_id, backup_type, table_name, object_key, size_bytes, format,
              status, error_message, retention_days, expires_at, created_by, created_at, completed_at
       FROM backups WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      backupType: row.backup_type,
      tableName: row.table_name,
      objectKey: row.object_key,
      sizeBytes: parseInt(row.size_bytes, 10),
      format: row.format,
      status: row.status,
      errorMessage: row.error_message,
      retentionDays: row.retention_days,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  },

  async createBackup(input: CreateBackupInput, userId?: string): Promise<Backup> {
    await ensureBackupBucket();

    // Generate object key
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let objectKey: string;

    if (input.backupType === 'platform') {
      objectKey = `platform/platform_${timestamp}.sql`;
    } else if (input.backupType === 'project') {
      if (!input.projectId) throw new BadRequestError('projectId required for project backup');
      objectKey = `projects/${input.projectId}/full_${timestamp}.sql`;
    } else {
      if (!input.projectId) throw new BadRequestError('projectId required for table backup');
      if (!input.tableName) throw new BadRequestError('tableName required for table backup');
      const format = input.format || 'csv';
      objectKey = `projects/${input.projectId}/tables/${input.tableName}_${timestamp}.${format}`;
    }

    const expiresAt = input.retentionDays
      ? new Date(Date.now() + input.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    // Create backup record
    const insertResult = await platformDb.query<{ id: string }>(
      `INSERT INTO backups (project_id, backup_type, table_name, object_key, format, status, retention_days, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
       RETURNING id`,
      [
        input.projectId ?? null,
        input.backupType,
        input.tableName ?? null,
        objectKey,
        input.format ?? 'sql',
        input.retentionDays ?? null,
        expiresAt,
        userId ?? null,
      ]
    );

    const backupId = insertResult.rows[0].id;

    // Start backup process asynchronously
    this.runBackup(backupId, input).catch((err) => {
      console.error('Backup failed:', err);
    });

    await auditService.log({
      action: 'backup.created',
      projectId: input.projectId ?? undefined,
      userId,
      details: { backupId, backupType: input.backupType },
    });

    return (await this.getBackup(backupId))!;
  },

  async runBackup(backupId: string, input: CreateBackupInput): Promise<void> {
    // Update status to running
    await platformDb.query(`UPDATE backups SET status = 'running' WHERE id = $1`, [backupId]);

    try {
      let data: Buffer;

      if (input.backupType === 'platform') {
        // Platform DB backup using pg_dump
        const connStr = `postgresql://${config.postgres.user}:${config.postgres.password}@${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`;
        const result = await runPgDump(connStr, ['--no-owner', '--no-acl', '-Fc']);
        data = result.stdout;
      } else if (input.backupType === 'project') {
        // Project DB backup - need to get connection string
        const credsResult = await platformDb.query<{
          encrypted_connection_string: string;
          iv: string;
          auth_tag: string;
        }>(
          `SELECT encrypted_connection_string, iv, auth_tag FROM project_db_creds
           WHERE project_id = $1 AND role = 'owner'`,
          [input.projectId]
        );

        if (credsResult.rows.length === 0) {
          throw new Error('Project credentials not found');
        }

        const { decrypt } = await import('../lib/crypto.js');
        const connStr = decrypt(
          credsResult.rows[0].encrypted_connection_string,
          credsResult.rows[0].iv,
          credsResult.rows[0].auth_tag
        );
        const result = await runPgDump(connStr, ['--no-owner', '--no-acl', '-Fc']);
        data = result.stdout;
      } else {
        // Table backup - export as CSV or JSON
        const format = input.format === 'json' ? 'json' : 'csv';
        data = await this.exportTable(input.projectId!, input.tableName!, format);
      }

      // Get backup record for object key
      const backup = await this.getBackup(backupId);
      if (!backup) throw new Error('Backup record not found');

      // Upload to MinIO
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BACKUP_BUCKET,
          Key: backup.objectKey,
          Body: data,
          ContentType:
            input.backupType === 'table' && input.format === 'json'
              ? 'application/json'
              : input.backupType === 'table' && input.format === 'csv'
                ? 'text/csv'
                : 'application/octet-stream',
        })
      );

      // Update record as completed
      await platformDb.query(
        `UPDATE backups SET status = 'completed', size_bytes = $2, completed_at = NOW() WHERE id = $1`,
        [backupId, data.length]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await platformDb.query(
        `UPDATE backups SET status = 'failed', error_message = $2 WHERE id = $1`,
        [backupId, message]
      );
      throw error;
    }
  },

  async exportTable(projectId: string, tableName: string, format: 'csv' | 'json'): Promise<Buffer> {
    // Get project DB credentials
    const { projectDb } = await import('../db/project.js');

    const result = await projectDb.queryAsOwner<Record<string, unknown>>(
      projectId,
      `SELECT * FROM "${tableName}" LIMIT 100000` // Safety limit
    );

    if (format === 'json') {
      return Buffer.from(JSON.stringify(result.rows, null, 2));
    } else {
      // CSV format
      if (result.rows.length === 0) {
        return Buffer.from('');
      }
      const headers = Object.keys(result.rows[0]);
      const lines = [
        headers.join(','),
        ...result.rows.map((row) =>
          headers
            .map((h) => {
              const val = row[h];
              if (val === null || val === undefined) return '';
              const str = String(val);
              // Escape CSV special characters
              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(',')
        ),
      ];
      return Buffer.from(lines.join('\n'));
    }
  },

  async getDownloadUrl(backupId: string): Promise<{ downloadUrl: string; expiresIn: number }> {
    const backup = await this.getBackup(backupId);
    if (!backup) throw new NotFoundError('Backup not found');
    if (backup.status !== 'completed') throw new BadRequestError('Backup not completed');

    const expiresIn = 3600; // 1 hour
    const command = new GetObjectCommand({
      Bucket: BACKUP_BUCKET,
      Key: backup.objectKey,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return { downloadUrl, expiresIn };
  },

  async deleteBackup(backupId: string, userId?: string): Promise<void> {
    const backup = await this.getBackup(backupId);
    if (!backup) throw new NotFoundError('Backup not found');

    // Delete from MinIO
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: BACKUP_BUCKET,
          Key: backup.objectKey,
        })
      );
    } catch {
      // Ignore if file doesn't exist
    }

    // Delete from database
    await platformDb.query('DELETE FROM backups WHERE id = $1', [backupId]);

    await auditService.log({
      action: 'backup.deleted',
      projectId: backup.projectId ?? undefined,
      userId,
      details: { backupId, backupType: backup.backupType },
    });
  },

  async cleanupExpiredBackups(): Promise<number> {
    // Get expired backups
    const result = await platformDb.query<{ id: string; object_key: string }>(
      `SELECT id, object_key FROM backups WHERE expires_at IS NOT NULL AND expires_at < NOW()`
    );

    for (const row of result.rows) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: BACKUP_BUCKET,
            Key: row.object_key,
          })
        );
      } catch {
        // Ignore
      }
    }

    await platformDb.query(
      `DELETE FROM backups WHERE expires_at IS NOT NULL AND expires_at < NOW()`
    );

    return result.rows.length;
  },
};
