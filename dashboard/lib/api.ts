const GATEWAY_URL =
  typeof window !== 'undefined'
    ? process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001'
    : process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3001';

async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: HeadersInit = {
    ...options.headers,
  };

  // Only set Content-Type for requests with a body
  if (options.body) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  // Add dev admin token in development (available in browser via NEXT_PUBLIC_)
  const devToken = process.env.NEXT_PUBLIC_DEV_ADMIN_TOKEN;
  if (devToken) {
    (headers as Record<string, string>)['x-dev-admin-token'] = devToken;
  }

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Send cookies for auth
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  // Handle 204 No Content responses
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  projectId: string;
  keyType: 'publishable' | 'secret';
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

// Stats interfaces
export interface StatsOverview {
  totalProjects: number;
  totalUsers: number;
  totalFiles: number;
  totalStorageBytes: number;
  activeApiKeys: number;
  adminUsers: number;
  regularUsers: number;
}

export interface ProjectStats {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  storageBytes: number;
  fileCount: number;
  apiKeyCount: number;
  bucketCount: number;
}

export interface TimelineData {
  date: string;
  projects: number;
  users: number;
  files: number;
}

export interface ActivityItem {
  id: string;
  action: string;
  projectId: string | null;
  projectName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateProjectResponse {
  project: Project;
  publishableKey: string;
  secretKey: string;
}

// Cron Job interfaces
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
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobRun {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: 'running' | 'success' | 'fail' | 'timeout' | 'cancelled';
  httpStatus: number | null;
  errorText: string | null;
  logObjectKey: string | null;
  logPreview: string | null;
  attemptNumber: number;
  createdAt: string;
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

// Backup interfaces
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
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateBackupInput {
  projectId?: string | null;
  backupType: 'platform' | 'project' | 'table';
  tableName?: string;
  format?: 'sql' | 'csv' | 'json';
  retentionDays?: number;
}

// Import/Export interfaces
export interface ImportExportJob {
  id: string;
  projectId: string;
  jobType: 'import' | 'export';
  tableName: string;
  objectKey: string | null;
  format: 'csv' | 'json';
  status: 'pending' | 'running' | 'completed' | 'failed';
  rowCount: number | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExportTableInput {
  projectId: string;
  tableName: string;
  format: 'csv' | 'json';
  options?: {
    limit?: number;
    columns?: string[];
  };
}

export interface ImportTableInput {
  projectId: string;
  tableName: string;
  format: 'csv' | 'json';
  objectKey: string;
  mode: 'insert' | 'upsert';
}

export const api = {
  // Projects
  async listProjects(): Promise<{ data: Project[] }> {
    return fetchApi('/admin/projects');
  },

  async getProject(id: string): Promise<{ data: Project }> {
    return fetchApi(`/admin/projects/${id}`);
  },

  async createProject(data: {
    name: string;
    description?: string;
  }): Promise<{ data: CreateProjectResponse }> {
    return fetchApi('/admin/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteProject(id: string): Promise<void> {
    await fetchApi(`/admin/projects/${id}`, { method: 'DELETE' });
  },

  // API Keys
  async listProjectKeys(projectId: string): Promise<{ data: ApiKey[] }> {
    return fetchApi(`/admin/projects/${projectId}/keys`);
  },

  async rotateKey(
    projectId: string,
    keyType: 'publishable' | 'secret'
  ): Promise<{ data: { apiKey: ApiKey; newKey: string } }> {
    return fetchApi(`/admin/projects/${projectId}/keys/rotate`, {
      method: 'POST',
      body: JSON.stringify({ keyType }),
    });
  },

  async revokeKey(projectId: string, keyId: string): Promise<void> {
    await fetchApi(`/admin/projects/${projectId}/keys/${keyId}`, { method: 'DELETE' });
  },

  // SQL Editor
  async executeSQL(
    projectId: string,
    sql: string
  ): Promise<{
    data: {
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      executionTimeMs: number;
    };
  }> {
    return fetchApi(`/admin/projects/${projectId}/sql`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  },

  // Tables
  async listTables(projectId: string): Promise<{
    data: Array<{ name: string; type: 'table' | 'view' }>;
  }> {
    return fetchApi(`/admin/projects/${projectId}/tables`);
  },

  async getTableColumns(
    projectId: string,
    tableName: string
  ): Promise<{
    data: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
  }> {
    return fetchApi(`/admin/projects/${projectId}/tables/${tableName}/columns`);
  },

  // Storage
  async listBuckets(projectId: string): Promise<{
    data: Array<{ id: string; name: string; createdAt: string }>;
  }> {
    return fetchApi(`/admin/projects/${projectId}/buckets`);
  },

  async listFiles(
    projectId: string,
    bucketName: string,
    prefix?: string
  ): Promise<{
    data: Array<{ key: string; size: number; lastModified: string }>;
  }> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    return fetchApi(`/admin/projects/${projectId}/buckets/${bucketName}/files${params}`);
  },

  async getSignedUploadUrl(
    projectId: string,
    bucket: string,
    path: string,
    contentType: string,
    maxSize?: number
  ): Promise<{ objectKey: string; uploadUrl: string; expiresIn: number }> {
    return fetchApi(`/admin/projects/${projectId}/signed-upload`, {
      method: 'POST',
      body: JSON.stringify({ bucket, path, contentType, maxSize }),
    });
  },

  async deleteFile(
    projectId: string,
    bucketName: string,
    objectKey: string
  ): Promise<{ success: boolean }> {
    return fetchApi(
      `/admin/projects/${projectId}/buckets/${bucketName}/files?objectKey=${encodeURIComponent(objectKey)}`,
      { method: 'DELETE' }
    );
  },

  async getSignedDownloadUrl(
    projectId: string,
    bucketName: string,
    objectKey: string
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    return fetchApi(
      `/admin/projects/${projectId}/buckets/${bucketName}/signed-download?objectKey=${encodeURIComponent(objectKey)}`
    );
  },

  // Stats
  async getStatsOverview(): Promise<StatsOverview> {
    return fetchApi('/admin/stats/overview');
  },

  async getProjectsStats(): Promise<{ projects: ProjectStats[] }> {
    return fetchApi('/admin/stats/projects');
  },

  async getTimeline(days?: number): Promise<{ timeline: TimelineData[] }> {
    const params = days ? `?days=${days}` : '';
    return fetchApi(`/admin/stats/timeline${params}`);
  },

  async getActivity(limit?: number): Promise<{ activity: ActivityItem[] }> {
    const params = limit ? `?limit=${limit}` : '';
    return fetchApi(`/admin/activity${params}`);
  },

  // Settings
  async getSettings(): Promise<PlatformSettings> {
    return fetchApi('/admin/settings');
  },

  async updateRateLimits(
    rateLimitMax: number,
    rateLimitWindowMs: number
  ): Promise<{
    message: string;
    rateLimitMax: number;
    rateLimitWindowMs: number;
  }> {
    return fetchApi('/admin/settings/rate-limits', {
      method: 'PUT',
      body: JSON.stringify({ rateLimitMax, rateLimitWindowMs }),
    });
  },

  async updateDatabaseLimits(
    sqlMaxRows: number,
    sqlStatementTimeoutMs: number
  ): Promise<{
    message: string;
    sqlMaxRows: number;
    sqlStatementTimeoutMs: number;
  }> {
    return fetchApi('/admin/settings/database-limits', {
      method: 'PUT',
      body: JSON.stringify({ sqlMaxRows, sqlStatementTimeoutMs }),
    });
  },

  async updateStorageSettings(minioPublicUrl: string): Promise<{
    message: string;
    minioPublicUrl: string;
  }> {
    return fetchApi('/admin/settings/storage', {
      method: 'PUT',
      body: JSON.stringify({ minioPublicUrl }),
    });
  },

  // Cron Jobs
  async listCronJobs(projectId?: string | null): Promise<{ data: CronJob[] }> {
    const params = projectId !== undefined ? `?projectId=${projectId ?? 'null'}` : '';
    return fetchApi(`/admin/cron${params}`);
  },

  async getCronJob(id: string): Promise<{ data: CronJob }> {
    return fetchApi(`/admin/cron/${id}`);
  },

  async createCronJob(data: CreateCronJobInput): Promise<{ data: CronJob }> {
    return fetchApi('/admin/cron', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCronJob(id: string, data: UpdateCronJobInput): Promise<{ data: CronJob }> {
    return fetchApi(`/admin/cron/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteCronJob(id: string): Promise<void> {
    await fetchApi(`/admin/cron/${id}`, { method: 'DELETE' });
  },

  async toggleCronJob(id: string, enabled: boolean): Promise<{ data: CronJob }> {
    return fetchApi(`/admin/cron/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  async runCronJob(id: string): Promise<{ data: { message: string; runId: string } }> {
    return fetchApi(`/admin/cron/${id}/run`, { method: 'POST' });
  },

  async getCronJobRuns(jobId: string, limit?: number): Promise<{ data: CronJobRun[] }> {
    const params = limit ? `?limit=${limit}` : '';
    return fetchApi(`/admin/cron/${jobId}/runs${params}`);
  },

  // Backups
  async listBackups(projectId?: string | null): Promise<{ data: Backup[] }> {
    const params = projectId !== undefined ? `?projectId=${projectId ?? 'null'}` : '';
    return fetchApi(`/admin/backups${params}`);
  },

  async getBackup(id: string): Promise<{ data: Backup }> {
    return fetchApi(`/admin/backups/${id}`);
  },

  async createBackup(data: CreateBackupInput): Promise<{ data: Backup }> {
    return fetchApi('/admin/backups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getBackupDownloadUrl(
    id: string
  ): Promise<{ data: { downloadUrl: string; expiresIn: number } }> {
    return fetchApi(`/admin/backups/${id}/download`);
  },

  async deleteBackup(id: string): Promise<void> {
    await fetchApi(`/admin/backups/${id}`, { method: 'DELETE' });
  },

  async cleanupExpiredBackups(): Promise<{ data: { deletedCount: number } }> {
    return fetchApi('/admin/backups/cleanup', { method: 'POST' });
  },

  // Data Tools (Import/Export) - Per Project
  async listDataToolsJobs(projectId: string): Promise<{ data: ImportExportJob[] }> {
    return fetchApi(`/admin/projects/${projectId}/data-tools/jobs`);
  },

  async exportTable(
    projectId: string,
    tableName: string,
    format: 'csv' | 'json',
    options?: { limit?: number; columns?: string[] }
  ): Promise<string> {
    const response = await fetch(`${GATEWAY_URL}/admin/projects/${projectId}/data-tools/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.NEXT_PUBLIC_DEV_ADMIN_TOKEN
          ? { 'x-dev-admin-token': process.env.NEXT_PUBLIC_DEV_ADMIN_TOKEN }
          : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ tableName, format, ...options }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Export failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.text();
  },

  async importTable(
    projectId: string,
    tableName: string,
    format: 'csv' | 'json',
    data: string,
    mode: 'insert' | 'upsert' = 'insert'
  ): Promise<{ data: { rowCount: number } }> {
    return fetchApi(`/admin/projects/${projectId}/data-tools/import`, {
      method: 'POST',
      body: JSON.stringify({ tableName, format, data, mode }),
    });
  },

  async getDataToolsUploadUrl(
    projectId: string,
    filename: string,
    contentType: string
  ): Promise<{ data: { uploadUrl: string; objectKey: string; expiresIn: number } }> {
    return fetchApi(`/admin/projects/${projectId}/data-tools/upload-url`, {
      method: 'POST',
      body: JSON.stringify({ filename, contentType }),
    });
  },
};

// Platform Settings interface
export interface PlatformSettings {
  version: string;
  nodeEnv: string;
  port: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  sqlMaxRows: number;
  sqlStatementTimeoutMs: number;
  minioEndpoint: string;
  minioPublicUrl: string;
  totalProjects: number;
  totalUsers: number;
  totalApiKeys: number;
}
