/**
 * @atlashub/sdk - Type Definitions
 * Core types for the AtlasHub SDK
 */

// ============================================================
// Client Configuration
// ============================================================

export interface AtlasHubClientOptions {
  /** The base URL of your AtlasHub gateway (e.g., 'https://api.example.com') */
  url: string;
  /** Your publishable or secret API key */
  apiKey: string;
  /** Optional project ID (can be inferred from API key) */
  projectId?: string;
  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom fetch function (useful for testing or custom environments) */
  fetch?: typeof fetch;
}

// ============================================================
// API Response Types
// ============================================================

export interface ApiResponse<T> {
  data: T;
  meta?: {
    rowCount?: number;
    total?: number;
    limit?: number;
    offset?: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

export class AtlasHubError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly error: string;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'AtlasHubError';
    this.statusCode = apiError.statusCode;
    this.details = apiError.details;
    this.error = apiError.error;
  }
}

// ============================================================
// Filter Operators
// ============================================================

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'like'
  | 'ilike'
  | 'in';

export type OrderDirection = 'asc' | 'desc';

// ============================================================
// Database Types
// ============================================================

export interface TableInfo {
  tableName: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
  }>;
}

export interface QueryOptions {
  /** Columns to select (comma-separated or '*') */
  select?: string;
  /** Order by column and direction (e.g., 'created_at.desc') */
  order?: string;
  /** Maximum number of rows to return */
  limit?: number;
  /** Number of rows to skip */
  offset?: number;
}

export interface InsertOptions {
  /** Return the inserted rows */
  returning?: boolean;
}

export interface UpdateOptions {
  /** Return the updated rows */
  returning?: boolean;
}

export interface DeleteResult {
  deletedCount: number;
}

// ============================================================
// Storage Types
// ============================================================

export interface SignedUploadResponse {
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface SignedDownloadResponse {
  downloadUrl: string;
  expiresIn: number;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

export interface ListObjectsOptions {
  /** Filter objects by prefix */
  prefix?: string;
  /** Maximum number of objects to return */
  limit?: number;
}

export interface UploadOptions {
  /** Bucket name */
  bucket: string;
  /** Object path/key */
  path: string;
  /** Content type of the file */
  contentType: string;
  /** Maximum allowed file size in bytes */
  maxSize?: number;
}

export interface DownloadOptions {
  /** Bucket name */
  bucket: string;
  /** Object key to download */
  objectKey: string;
}

// ============================================================
// Auth Types
// ============================================================

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  accessToken: string;
  user: User;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  /** Invite key (required if registration is invite-only) */
  inviteKey?: string;
}

// ============================================================
// Query Builder Types (Internal)
// ============================================================

export interface ParsedFilter {
  column: string;
  operator: FilterOperator;
  value: string | string[];
}

export interface ParsedOrder {
  column: string;
  direction: OrderDirection;
}

// ============================================================
// Generic Row Type
// ============================================================

export type Row = Record<string, unknown>;

export type MaybeRow = Row | undefined;
