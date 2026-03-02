import { z } from 'zod';

// ============================================================
// Project Schemas
// ============================================================

export const projectIdSchema = z.string().uuid();

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const projectSchema = z.object({
  id: projectIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================================
// API Key Schemas
// ============================================================

export const apiKeyTypeSchema = z.enum(['publishable', 'secret']);

export const apiKeySchema = z.object({
  id: z.string().uuid(),
  projectId: projectIdSchema,
  keyType: apiKeyTypeSchema,
  keyPrefix: z.string(), // first 8 chars for identification
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
});

export const rotateApiKeySchema = z.object({
  keyType: apiKeyTypeSchema,
});

// ============================================================
// Bucket / Storage Schemas
// ============================================================

export const bucketNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    'Bucket name must be lowercase alphanumeric with hyphens, not starting/ending with hyphen'
  );

export const objectPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[a-zA-Z0-9!_.*'()/-]+$/, 'Invalid object path characters');

export const signedUploadRequestSchema = z.object({
  bucket: bucketNameSchema,
  path: objectPathSchema,
  contentType: z.string().min(1).max(255),
  maxSize: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .optional(), // max 100MB
});

export const signedUploadResponseSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string().url(),
  expiresIn: z.number().int(),
});

export const signedDownloadRequestSchema = z.object({
  bucket: bucketNameSchema,
  objectKey: z.string().min(1),
});

export const signedDownloadResponseSchema = z.object({
  downloadUrl: z.string().url(),
  expiresIn: z.number().int(),
});

export const fileMetadataSchema = z.object({
  id: z.string().uuid(),
  projectId: projectIdSchema,
  bucket: z.string(),
  objectKey: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  createdAt: z.coerce.date(),
});

// ============================================================
// Public CRUD API Schemas
// ============================================================

export const tableNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z_][a-z0-9_]*$/i, 'Invalid table name');

export const columnNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z_][a-z0-9_]*$/i, 'Invalid column name');

export const filterOperatorSchema = z.enum([
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'like',
  'ilike',
  'in',
]);

export const orderDirectionSchema = z.enum(['asc', 'desc']);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const tableInfoSchema = z.object({
  tableName: z.string(),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      nullable: z.boolean(),
      defaultValue: z.string().nullable(),
    })
  ),
});

export const selectQuerySchema = z.object({
  select: z.string().optional(), // comma-separated columns or *
  order: z.string().optional(), // column.asc or column.desc
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  // filters are dynamic: eq.column=value, neq.column=value, etc.
});

export const insertBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  returning: z.boolean().optional(),
});

export const updateBodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
  returning: z.boolean().optional(),
});

// ============================================================
// DDL Extension Schemas
// ============================================================

export const alterColumnSchema = z.object({
  type: z.string().min(1).max(100).optional(),
  using: z.string().max(500).optional(),
  nullable: z.boolean().optional(),
  defaultValue: z.string().max(255).optional(),
  dropDefault: z.boolean().optional(),
  addConstraint: z.object({
    name: z.string().min(1).max(63),
    type: z.enum(['check', 'unique', 'not_null']),
    expression: z.string().max(1000).optional(), // Required for check constraints
  }).optional(),
  dropConstraint: z.string().min(1).max(63).optional(),
}).refine(data => {
  // At least one modification must be specified
  return Object.keys(data).length > 0;
}, { message: 'At least one modification must be specified' });

export const createIndexSchema = z.object({
  name: z.string().min(1).max(63),
  table: z.string().min(1).max(63),
  columns: z.array(z.string().min(1).max(63)).min(1).max(10),
  unique: z.boolean().optional().default(false),
  where: z.string().max(500).optional(),
  ifNotExists: z.boolean().optional().default(false),
});

export const dropIndexSchema = z.object({
  ifExists: z.boolean().optional().default(false),
});

export const truncateTableSchema = z.object({
  restartIdentity: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});

// ============================================================
// Admin SQL Editor Schemas
// ============================================================

export const sqlQuerySchema = z.object({
  sql: z.string().min(1).max(50000),
  params: z.array(z.unknown()).optional(),
});

export const sqlResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  executionTimeMs: z.number(),
});

// ============================================================
// Audit Log Schemas
// ============================================================

export const auditActionSchema = z.enum([
  'project.create',
  'project.delete',
  'apikey.create',
  'apikey.rotate',
  'apikey.revoke',
  'sql.execute',
  'storage.upload',
  'storage.delete',
]);

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  projectId: projectIdSchema.nullable(),
  action: auditActionSchema,
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.coerce.date(),
});

// ============================================================
// Error Response Schema
// ============================================================

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
  details: z.unknown().optional(),
});

// ============================================================
// Type Exports
// ============================================================

export type AlterColumnInput = z.infer<typeof alterColumnSchema>;
export type CreateIndexInput = z.infer<typeof createIndexSchema>;
export type DropIndexInput = z.infer<typeof dropIndexSchema>;
export type TruncateTableInput = z.infer<typeof truncateTableSchema>;
