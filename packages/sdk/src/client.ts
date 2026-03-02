/**
 * @atlashub/sdk - AtlasHub Client
 * Main client class for interacting with AtlasHub services
 */

import { AtlasHubError, type AtlasHubClientOptions, type ApiResponse, type Row } from './types.js';
import { DatabaseClient, QueryBuilder } from './database.js';
import { AuthClient } from './auth.js';
import { StorageClient, BucketRef } from './storage.js';

// ============================================================
// AtlasHub Client
// ============================================================

/**
 * Main client for interacting with AtlasHub services
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
 * const { data, error } = await client.from('users').select('*')
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
export class AtlasHubClient {
  private _options: AtlasHubClientOptions;
  private _fetch: typeof fetch;
  private _database: DatabaseClient;
  private _auth: AuthClient;
  private _storage: StorageClient;

  constructor(options: AtlasHubClientOptions) {
    this._options = options;
    this._fetch = options.fetch ?? globalThis.fetch;

    // Validate required options
    if (!options.url) {
      throw new Error('AtlasHub client requires a "url" option');
    }
    if (!options.apiKey) {
      throw new Error('AtlasHub client requires an "apiKey" option');
    }

    // Build base headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': options.apiKey,
      ...options.headers,
    };

    const timeout = options.timeout ?? 30000;

    // Initialize sub-clients
    this._database = new DatabaseClient(
      options.url,
      headers,
      this._fetch,
      timeout
    );
    this._auth = new AuthClient(options.url, headers, this._fetch, timeout);
    this._storage = new StorageClient(
      options.url,
      headers,
      this._fetch,
      timeout
    );
  }

  // ============================================================
  // Database Methods
  // ============================================================

  /**
   * Create a query builder for a table
   *
   * @example
   * ```typescript
   * // Select all users
   * const { data, error } = await client.from('users').select('*')
   *
   * // Select with filters
   * const { data, error } = await client
   *   .from('users')
   *   .select('id, name, email')
   *   .eq('status', 'active')
   *   .order('created_at', { ascending: false })
   *   .limit(10)
   *
   * // Insert
   * const { data, error } = await client
   *   .from('users')
   *   .insert({ name: 'John', email: 'john@example.com' })
   *
   * // Update
   * const { data, error } = await client
   *   .from('users')
   *   .update({ name: 'Jane' })
   *   .eq('id', 1)
   *
   * // Delete
   * const { data, error } = await client
   *   .from('users')
   *   .delete()
   *   .eq('id', 1)
   * ```
   */
  from<T extends Row = Row>(table: string): QueryBuilder<T> {
    return this._database.from<T>(table);
  }

  /**
   * Get list of available tables
   *
   * @example
   * const { data: tables, error } = await client.getTables()
   */
  async getTables(): Promise<ApiResponse<string[]>> {
    return this._database.getTables();
  }

  /**
   * Execute a raw SQL query (requires secret key)
   *
   * @example
   * const { data, error } = await client.raw(
   *   'SELECT * FROM users WHERE id = $1',
   *   [1]
   * )
   */
  async raw<T extends Row = Row>(
    sql: string,
    params?: unknown[]
  ): Promise<ApiResponse<{ columns: string[]; rows: T[]; rowCount: number }>> {
    return this._database.raw<T>(sql, params);
  }

  /**
   * Access the database client directly
   */
  get db(): DatabaseClient {
    return this._database;
  }

  // ============================================================
  // Auth Methods
  // ============================================================

  /**
   * Access authentication methods
   *
   * @example
   * // Sign in
   * const { data, error } = await client.auth.signIn({
   *   email: 'user@example.com',
   *   password: 'password'
   * })
   *
   * // Get current user
   * const { data: user } = await client.auth.getUser()
   *
   * // Sign out
   * await client.auth.signOut()
   */
  get auth(): AuthClient {
    return this._auth;
  }

  // ============================================================
  // Storage Methods
  // ============================================================

  /**
   * Access storage methods
   *
   * @example
   * // Get a bucket reference
   * const bucket = client.storage.from('images')
   *
   * // Upload a file
   * const { data, error } = await client.storage.upload({
   *   bucket: 'images',
   *   path: 'avatars/user.png',
   *   file: file
   * })
   *
   * // Download a file
   * const { data: blob } = await client.storage.download({
   *   bucket: 'images',
   *   objectKey: 'avatars/user.png'
   * })
   */
  get storage(): StorageRef {
    return new StorageRef(this._storage);
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Get the client configuration
   */
  get config(): Readonly<AtlasHubClientOptions> {
    return { ...this._options };
  }

  /**
   * Make a custom request to the API
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this._options.url);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this._options.apiKey,
      ...this._options.headers,
    };

    const timeout = this._options.timeout ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this._fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json()) as {
          error?: string;
          message?: string;
          statusCode?: number;
          details?: unknown;
        };
        throw new AtlasHubError({
          error: errorData.error || 'Request failed',
          message: errorData.message || response.statusText,
          statusCode: errorData.statusCode || response.status,
          details: errorData.details,
        });
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return { data: undefined as T };
      }

      return (await response.json()) as ApiResponse<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof AtlasHubError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new AtlasHubError({
            error: 'Timeout',
            message: 'Request timed out',
            statusCode: 408,
          });
        }
        throw new AtlasHubError({
          error: 'Network Error',
          message: error.message,
          statusCode: 0,
        });
      }
      throw error;
    }
  }
}

// ============================================================
// Storage Reference (Fluent API)
// ============================================================

/**
 * Storage reference for fluent bucket access
 */
class StorageRef {
  private _client: StorageClient;

  constructor(client: StorageClient) {
    this._client = client;
  }

  /**
   * Get a reference to a specific bucket
   *
   * @example
   * const bucket = client.storage.from('images')
   * await bucket.upload('avatar.png', file)
   */
  from(bucket: string): BucketRef {
    return new BucketRef(this._client, bucket);
  }

  /**
   * Get a signed upload URL
   *
   * @example
   * const { data, error } = await client.storage.getUploadUrl({
   *   bucket: 'images',
   *   path: 'avatars/user.png',
   *   contentType: 'image/png'
   * })
   */
  getUploadUrl(options: {
    bucket: string;
    path: string;
    contentType: string;
    maxSize?: number;
  }) {
    return this._client.getUploadUrl(options);
  }

  /**
   * Get a signed download URL
   *
   * @example
   * const { data, error } = await client.storage.getDownloadUrl({
   *   bucket: 'images',
   *   objectKey: 'avatars/user.png'
   * })
   */
  getDownloadUrl(options: { bucket: string; objectKey: string }) {
    return this._client.getDownloadUrl(options);
  }

  /**
   * Upload a file
   *
   * @example
   * const { data, error } = await client.storage.upload({
   *   bucket: 'images',
   *   path: 'avatars/user.png',
   *   file: file
   * })
   */
  upload(options: {
    bucket: string;
    path: string;
    file: File | Blob;
    contentType: string;
    maxSize?: number;
  }) {
    return this._client.upload(options);
  }

  /**
   * Download a file
   *
   * @example
   * const { data, error } = await client.storage.download({
   *   bucket: 'images',
   *   objectKey: 'avatars/user.png'
   * })
   */
  download(options: { bucket: string; objectKey: string }) {
    return this._client.download(options);
  }

  /**
   * List objects in a bucket
   *
   * @example
   * const { data, error } = await client.storage.list({
   *   bucket: 'images',
   *   prefix: 'avatars/',
   *   limit: 100
   * })
   */
  list(options: { bucket: string; prefix?: string; limit?: number }) {
    return this._client.list(options);
  }

  /**
   * Delete an object
   *
   * @example
   * const { error } = await client.storage.delete({
   *   bucket: 'images',
   *   objectKey: 'avatars/user.png'
   * })
   */
  delete(options: { bucket: string; objectKey: string }) {
    return this._client.delete(options);
  }

  /**
   * Create a new bucket
   */
  createBucket(name: string) {
    return this._client.createBucket(name);
  }

  /**
   * List all buckets
   */
  listBuckets() {
    return this._client.listBuckets();
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a new AtlasHub client
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
 * // Use the client
 * const { data, error } = await client.from('users').select('*')
 * ```
 */
export function createClient(options: AtlasHubClientOptions): AtlasHubClient {
  return new AtlasHubClient(options);
}
