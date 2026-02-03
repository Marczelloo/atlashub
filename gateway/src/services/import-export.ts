import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';
import { platformDb } from '../db/platform.js';
import { projectDb } from '../db/project.js';
import { auditService } from './audit.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

const IMPORT_EXPORT_BUCKET = 'atlashub-imports';

const s3Client = new S3Client({
  endpoint: `http${config.minio.useSSL ? 's' : ''}://${config.minio.endpoint}:${config.minio.port}`,
  region: config.minio.region,
  credentials: {
    accessKeyId: config.minio.accessKey,
    secretAccessKey: config.minio.secretKey,
  },
  forcePathStyle: true,
});

export interface ImportExportJob {
  id: string;
  projectId: string;
  operation: 'import' | 'export';
  targetType: 'database' | 'table';
  tableName: string | null;
  objectKey: string | null;
  format: 'csv' | 'json' | 'sql';
  status: 'pending' | 'running' | 'completed' | 'failed';
  rowsProcessed: number;
  rowsTotal: number | null;
  errorMessage: string | null;
  options: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ExportTableInput {
  projectId: string;
  tableName: string;
  format: 'csv' | 'json';
  options?: {
    where?: string; // SQL WHERE clause (admin only, sanitized)
    limit?: number;
    columns?: string[];
  };
}

export interface ImportTableInput {
  projectId: string;
  tableName: string;
  format: 'csv' | 'json';
  data: string; // CSV or JSON string
  options?: {
    upsertColumn?: string; // Column to use for upsert (must be unique/primary key)
    skipFirstRow?: boolean; // For CSV with headers
    columnMapping?: Record<string, string>; // Map CSV columns to table columns
  };
}

// Ensure import/export bucket exists
async function ensureImportExportBucket(): Promise<void> {
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    await s3Client.send(
      new ListObjectsV2Command({
        Bucket: IMPORT_EXPORT_BUCKET,
        MaxKeys: 1,
      })
    );
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'NoSuchBucket') {
      const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
      await s3Client.send(new CreateBucketCommand({ Bucket: IMPORT_EXPORT_BUCKET }));
    }
  }
}

// Parse CSV string into array of objects
function parseCSV(
  csvData: string,
  skipFirstRow = true
): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvData.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Parse header row
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  // Parse data rows
  const dataStartIndex = skipFirstRow ? 1 : 0;
  const rows: Record<string, string>[] = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

// Parse a single CSV line respecting quotes
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

// Validate table exists and get columns
async function getTableColumns(
  projectId: string,
  tableName: string
): Promise<Array<{ name: string; type: string; nullable: boolean }>> {
  const result = await projectDb.queryAsOwner<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    projectId,
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError(`Table "${tableName}" not found`);
  }

  return result.rows.map((row) => ({
    name: row.column_name,
    type: row.data_type,
    nullable: row.is_nullable === 'YES',
  }));
}

export const importExportService = {
  async listJobs(projectId: string): Promise<ImportExportJob[]> {
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      operation: 'import' | 'export';
      target_type: 'database' | 'table';
      table_name: string | null;
      object_key: string | null;
      format: 'csv' | 'json' | 'sql';
      status: 'pending' | 'running' | 'completed' | 'failed';
      rows_processed: number;
      rows_total: number | null;
      error_message: string | null;
      options: Record<string, unknown>;
      created_by: string | null;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id, project_id, operation, target_type, table_name, object_key, format,
              status, rows_processed, rows_total, error_message, options, created_by, created_at, completed_at
       FROM import_export_jobs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [projectId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      operation: row.operation,
      targetType: row.target_type,
      tableName: row.table_name,
      objectKey: row.object_key,
      format: row.format,
      status: row.status,
      rowsProcessed: row.rows_processed,
      rowsTotal: row.rows_total,
      errorMessage: row.error_message,
      options: row.options,
      createdBy: row.created_by,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  },

  async exportTable(
    input: ExportTableInput,
    userId?: string
  ): Promise<{ data: string; contentType: string }> {
    // Validate table exists
    const columns = await getTableColumns(input.projectId, input.tableName);

    // Build query
    const selectColumns = input.options?.columns?.length
      ? input.options.columns
          .filter((c) => columns.some((col) => col.name === c))
          .map((c) => `"${c}"`)
          .join(', ')
      : '*';

    if (selectColumns === '') {
      throw new BadRequestError('No valid columns specified');
    }

    const limit = Math.min(input.options?.limit ?? 100000, 100000);
    const query = `SELECT ${selectColumns} FROM "${input.tableName}" LIMIT ${limit}`;

    const result = await projectDb.queryAsOwner<Record<string, unknown>>(input.projectId, query);

    await auditService.log({
      action: 'export.table',
      projectId: input.projectId,
      userId,
      details: { tableName: input.tableName, format: input.format, rowCount: result.rows.length },
    });

    if (input.format === 'json') {
      return {
        data: JSON.stringify(result.rows, null, 2),
        contentType: 'application/json',
      };
    } else {
      // CSV format
      if (result.rows.length === 0) {
        const headers = columns.map((c) => c.name).join(',');
        return { data: headers, contentType: 'text/csv' };
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
              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(',')
        ),
      ];
      return { data: lines.join('\n'), contentType: 'text/csv' };
    }
  },

  async importTable(input: ImportTableInput, userId?: string): Promise<{ rowsImported: number }> {
    // Validate table exists and get columns
    const tableColumns = await getTableColumns(input.projectId, input.tableName);
    const columnNames = tableColumns.map((c) => c.name);

    let rows: Record<string, unknown>[];

    if (input.format === 'json') {
      try {
        const parsed = JSON.parse(input.data);
        if (!Array.isArray(parsed)) {
          throw new BadRequestError('JSON data must be an array of objects');
        }
        rows = parsed;
      } catch (e) {
        if (e instanceof BadRequestError) throw e;
        throw new BadRequestError('Invalid JSON data');
      }
    } else {
      // CSV
      const parsed = parseCSV(input.data, input.options?.skipFirstRow !== false);
      rows = parsed.rows;

      // Apply column mapping if provided
      if (input.options?.columnMapping) {
        rows = rows.map((row) => {
          const mapped: Record<string, unknown> = {};
          for (const [csvCol, tableCol] of Object.entries(input.options!.columnMapping!)) {
            if (row[csvCol] !== undefined && columnNames.includes(tableCol)) {
              mapped[tableCol] = row[csvCol];
            }
          }
          return mapped;
        });
      }
    }

    if (rows.length === 0) {
      return { rowsImported: 0 };
    }

    // Limit import size for safety
    const maxRows = 10000;
    if (rows.length > maxRows) {
      throw new BadRequestError(`Import limited to ${maxRows} rows. Got ${rows.length}.`);
    }

    // Filter columns to only those that exist in the table
    const validColumns = Object.keys(rows[0]).filter((c) => columnNames.includes(c));
    if (validColumns.length === 0) {
      throw new BadRequestError('No valid columns found in import data');
    }

    // Build INSERT query
    const columnList = validColumns.map((c) => `"${c}"`).join(', ');
    const valuePlaceholders = rows
      .map(
        (_, rowIdx) =>
          `(${validColumns.map((_, colIdx) => `$${rowIdx * validColumns.length + colIdx + 1}`).join(', ')})`
      )
      .join(', ');

    const values = rows.flatMap((row) => validColumns.map((col) => row[col] ?? null));

    let query: string;
    if (input.options?.upsertColumn && columnNames.includes(input.options.upsertColumn)) {
      // Use INSERT ... ON CONFLICT DO UPDATE
      const upsertCol = input.options.upsertColumn;
      const updateSet = validColumns
        .filter((c) => c !== upsertCol)
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');

      if (updateSet) {
        query = `INSERT INTO "${input.tableName}" (${columnList}) VALUES ${valuePlaceholders}
                 ON CONFLICT ("${upsertCol}") DO UPDATE SET ${updateSet}`;
      } else {
        query = `INSERT INTO "${input.tableName}" (${columnList}) VALUES ${valuePlaceholders}
                 ON CONFLICT ("${upsertCol}") DO NOTHING`;
      }
    } else {
      query = `INSERT INTO "${input.tableName}" (${columnList}) VALUES ${valuePlaceholders}`;
    }

    const result = await projectDb.queryAsOwner(input.projectId, query, values);

    await auditService.log({
      action: 'import.table',
      projectId: input.projectId,
      userId,
      details: { tableName: input.tableName, format: input.format, rowsImported: result.rowCount },
    });

    return { rowsImported: result.rowCount ?? 0 };
  },

  async getUploadUrl(
    projectId: string,
    filename: string,
    contentType: string
  ): Promise<{ uploadUrl: string; objectKey: string; expiresIn: number }> {
    await ensureImportExportBucket();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const objectKey = `${projectId}/imports/${timestamp}_${filename}`;
    const expiresIn = 3600;

    const command = new PutObjectCommand({
      Bucket: IMPORT_EXPORT_BUCKET,
      Key: objectKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    return { uploadUrl, objectKey, expiresIn };
  },

  async getDownloadUrl(objectKey: string): Promise<{ downloadUrl: string; expiresIn: number }> {
    const expiresIn = 3600;
    const command = new GetObjectCommand({
      Bucket: IMPORT_EXPORT_BUCKET,
      Key: objectKey,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return { downloadUrl, expiresIn };
  },
};
