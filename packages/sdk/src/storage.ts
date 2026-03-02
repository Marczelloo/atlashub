/**
 * @atlashub/sdk - Storage Client
 * File storage operations with presigned URLs
 */

import type {
  ApiResponse,
  AtlasHubError,
  DownloadOptions,
  ListObjectsOptions,
  SignedDownloadResponse,
  SignedUploadResponse,
  StorageObject,
  UploadOptions,
} from './types.js';

// ============================================================
// Storage Client
// ============================================================

export class StorageClient {
  private _baseUrl: string;
  private _headers: Record<string, string>;
  private _fetch: typeof fetch;
  private _timeout: number;

  constructor(
    baseUrl: string,
    headers: Record<string, string>,
    fetchFn: typeof fetch,
    timeout: number
  ) {
    this._baseUrl = baseUrl;
    this._headers = headers;
    this._fetch = fetchFn;
    this._timeout = timeout;
  }

  /**
   * Get a signed upload URL for uploading a file
   * @example
   * const { data, error } = await client.storage.getUploadUrl({
   *   bucket: 'images',
   *   path: 'avatars/user123.png',
   *   contentType: 'image/png'
   * })
   *
   * // Then upload the file using the signed URL
   * await fetch(data.uploadUrl, {
   *   method: 'PUT',
   *   body: file,
   *   headers: { 'Content-Type': 'image/png' }
   * })
   */
  async getUploadUrl(
    options: UploadOptions
  ): Promise<ApiResponse<SignedUploadResponse>> {
    return this._request<SignedUploadResponse>('POST', '/storage/signed-upload', {
      bucket: options.bucket,
      path: options.path,
      contentType: options.contentType,
      maxSize: options.maxSize,
    });
  }

  /**
   * Get a signed download URL for downloading a file
   * @example
   * const { data, error } = await client.storage.getDownloadUrl({
   *   bucket: 'images',
   *   objectKey: 'avatars/user123.png'
   * })
   *
   * // Then download the file using the signed URL
   * const response = await fetch(data.downloadUrl)
   * const blob = await response.blob()
   */
  async getDownloadUrl(
    options: DownloadOptions
  ): Promise<ApiResponse<SignedDownloadResponse>> {
    const params = new URLSearchParams({
      bucket: options.bucket,
      objectKey: options.objectKey,
    });

    return this._request<SignedDownloadResponse>(
      'GET',
      `/storage/signed-download?${params.toString()}`
    );
  }

  /**
   * Upload a file directly (gets presigned URL and uploads)
   * @example
   * const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
   * const { data, error } = await client.storage.upload({
   *   bucket: 'uploads',
   *   path: 'files/test.txt',
   *   file
   * })
   */
  async upload(
    options: UploadOptions & { file: File | Blob }
  ): Promise<ApiResponse<{ objectKey: string }>> {
    // Get signed upload URL
    const uploadUrlResponse = await this.getUploadUrl({
      bucket: options.bucket,
      path: options.path,
      contentType: options.contentType,
      maxSize: options.maxSize,
    });

    if (!uploadUrlResponse.data) {
      return uploadUrlResponse as ApiResponse<{ objectKey: string }>;
    }

    const { uploadUrl, objectKey } = uploadUrlResponse.data;

    // Upload the file to the presigned URL
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const uploadResponse = await this._fetch(uploadUrl, {
        method: 'PUT',
        body: options.file,
        headers: {
          'Content-Type': options.contentType,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!uploadResponse.ok) {
        throw new Error(
          JSON.stringify({
            error: 'Upload Failed',
            message: `Failed to upload file: ${uploadResponse.statusText}`,
            statusCode: uploadResponse.status,
          })
        );
      }

      return { data: { objectKey } };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Download a file directly (gets presigned URL and downloads)
   * @example
   * const { data, error } = await client.storage.download({
   *   bucket: 'images',
   *   objectKey: 'avatars/user123.png'
   * })
   *
   * if (data) {
   *   const url = URL.createObjectURL(data)
   *   // Use the blob URL
   * }
   */
  async download(
    options: DownloadOptions
  ): Promise<ApiResponse<Blob>> {
    // Get signed download URL
    const downloadUrlResponse = await this.getDownloadUrl(options);

    if (!downloadUrlResponse.data) {
      return downloadUrlResponse as unknown as ApiResponse<Blob>;
    }

    const { downloadUrl } = downloadUrlResponse.data;

    // Download the file from the presigned URL
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const downloadResponse = await this._fetch(downloadUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!downloadResponse.ok) {
        throw new Error(
          JSON.stringify({
            error: 'Download Failed',
            message: `Failed to download file: ${downloadResponse.statusText}`,
            statusCode: downloadResponse.status,
          })
        );
      }

      const blob = await downloadResponse.blob();
      return { data: blob };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * List objects in a bucket (requires secret key)
   * @example
   * const { data, error } = await client.storage.list({
   *   bucket: 'images',
   *   prefix: 'avatars/',
   *   limit: 100
   * })
   */
  async list(
    options: ListObjectsOptions & { bucket: string }
  ): Promise<ApiResponse<StorageObject[]>> {
    const params = new URLSearchParams({
      bucket: options.bucket,
    });

    if (options.prefix) {
      params.set('prefix', options.prefix);
    }
    if (options.limit) {
      params.set('limit', String(options.limit));
    }

    return this._request<StorageObject[]>(
      'GET',
      `/storage/list?${params.toString()}`
    );
  }

  /**
   * Delete an object from storage
   * @example
   * const { error } = await client.storage.delete({
   *   bucket: 'images',
   *   objectKey: 'avatars/user123.png'
   * })
   */
  async delete(
    options: { bucket: string; objectKey: string }
  ): Promise<ApiResponse<void>> {
    const params = new URLSearchParams({
      bucket: options.bucket,
      objectKey: options.objectKey,
    });

    return this._request<void>('DELETE', `/storage/object?${params.toString()}`);
  }

  /**
   * Create a new bucket (admin only)
   * @example
   * const { error } = await client.storage.createBucket('new-bucket')
   */
  async createBucket(name: string): Promise<ApiResponse<{ name: string }>> {
    return this._request<{ name: string }>('POST', '/admin/storage/buckets', {
      name,
    });
  }

  /**
   * List all buckets (admin only)
   * @example
   * const { data, error } = await client.storage.listBuckets()
   */
  async listBuckets(): Promise<ApiResponse<Array<{ id: string; name: string; createdAt: Date }>>> {
    return this._request<Array<{ id: string; name: string; createdAt: Date }>>(
      'GET',
      '/admin/storage/buckets'
    );
  }

  /**
   * Internal request method
   */
  private async _request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this._baseUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const response = await this._fetch(url.toString(), {
        method,
        headers: {
          ...this._headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 204 No Content
      if (response.status === 204) {
        return { data: undefined as T };
      }

      if (!response.ok) {
        const errorData = (await response.json()) as {
          error?: string;
          message?: string;
          statusCode?: number;
          details?: unknown;
        };
        throw new Error(
          JSON.stringify({
            error: errorData.error || 'Request failed',
            message: errorData.message || response.statusText,
            statusCode: errorData.statusCode || response.status,
            details: errorData.details,
          })
        );
      }

      return (await response.json()) as ApiResponse<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          throw new Error(JSON.stringify(parsed));
        } catch {
          if (error.name === 'AbortError') {
            throw new Error(
              JSON.stringify({
                error: 'Timeout',
                message: 'Request timed out',
                statusCode: 408,
              })
            );
          }
          throw new Error(
            JSON.stringify({
              error: 'Network Error',
              message: error.message,
              statusCode: 0,
            })
          );
        }
      }
      throw error;
    }
  }
}

// ============================================================
// Bucket Reference (for fluent API)
// ============================================================

/**
 * Reference to a specific storage bucket
 * @example
 * const bucket = client.storage.from('images')
 * const { data, error } = await bucket.upload('avatars/user.png', file)
 */
export class BucketRef {
  private _client: StorageClient;
  private _bucket: string;

  constructor(client: StorageClient, bucket: string) {
    this._client = client;
    this._bucket = bucket;
  }

  /**
   * Upload a file to this bucket
   */
  async upload(
    path: string,
    file: File | Blob,
    contentType?: string
  ): Promise<ApiResponse<{ objectKey: string }>> {
    return this._client.upload({
      bucket: this._bucket,
      path,
      file,
      contentType: contentType || file.type || 'application/octet-stream',
    });
  }

  /**
   * Download a file from this bucket
   */
  async download(objectKey: string): Promise<ApiResponse<Blob>> {
    return this._client.download({
      bucket: this._bucket,
      objectKey,
    });
  }

  /**
   * Get a signed upload URL
   */
  async getUploadUrl(
    path: string,
    contentType: string,
    maxSize?: number
  ): Promise<ApiResponse<SignedUploadResponse>> {
    return this._client.getUploadUrl({
      bucket: this._bucket,
      path,
      contentType,
      maxSize,
    });
  }

  /**
   * Get a signed download URL
   */
  async getDownloadUrl(objectKey: string): Promise<ApiResponse<SignedDownloadResponse>> {
    return this._client.getDownloadUrl({
      bucket: this._bucket,
      objectKey,
    });
  }

  /**
   * List objects in this bucket
   */
  async list(options?: Omit<ListObjectsOptions, 'bucket'>): Promise<ApiResponse<StorageObject[]>> {
    return this._client.list({
      bucket: this._bucket,
      ...options,
    });
  }

  /**
   * Delete an object from this bucket
   */
  async delete(objectKey: string): Promise<ApiResponse<void>> {
    return this._client.delete({
      bucket: this._bucket,
      objectKey,
    });
  }
}
