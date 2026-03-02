/**
 * @atlashub/sdk
 * Official TypeScript SDK for AtlasHub
 *
 * A Supabase-like SDK for interacting with AtlasHub services including:
 * - Database (PostgreSQL with chainable query builder)
 * - Storage (S3-compatible file storage)
 * - Auth (Email/password authentication)
 *
 * @example
 * ```typescript
 * import { createClient } from '@atlashub/sdk'
 *
 * const client = createClient({
 *   url: 'https://api.yoursite.com',
 *   apiKey: 'pk_your_publishable_key'
 * })
 *
 * // Database operations
 * const { data, error } = await client
 *   .from('users')
 *   .select('*')
 *   .eq('status', 'active')
 *   .order('created_at', { ascending: false })
 *   .limit(10)
 *
 * // Storage operations
 * const bucket = client.storage.from('images')
 * await bucket.upload('avatar.png', file)
 *
 * // Auth operations
 * const { data: session } = await client.auth.signIn({
 *   email: 'user@example.com',
 *   password: 'password'
 * })
 * ```
 */

// ============================================================
// Main Client
// ============================================================

export { AtlasHubClient, createClient } from './client.js';

// ============================================================
// Database
// ============================================================

export { DatabaseClient, QueryBuilder } from './database.js';
export type { TableInfo, DeleteResult, QueryOptions, InsertOptions, UpdateOptions } from './types.js';

// ============================================================
// Storage
// ============================================================

export { StorageClient, BucketRef } from './storage.js';
export type {
  SignedUploadResponse,
  SignedDownloadResponse,
  StorageObject,
  ListObjectsOptions,
  UploadOptions,
  DownloadOptions,
} from './types.js';

// ============================================================
// Auth
// ============================================================

export { AuthClient } from './auth.js';
export type { AuthChangeEvent } from './auth.js';
export type { User, Session, SignInCredentials, SignUpCredentials } from './types.js';

// ============================================================
// Types
// ============================================================

export {
  // Error types
  AtlasHubError,
  // Config types
  type AtlasHubClientOptions,
  // API types
  type ApiResponse,
  type ApiError,
  // Filter types
  type FilterOperator,
  type OrderDirection,
  // Row types
  type Row,
  type MaybeRow,
  // Internal types
  type ParsedFilter,
  type ParsedOrder,
} from './types.js';

// ============================================================
// Default Export
// ============================================================

export default createClient;
