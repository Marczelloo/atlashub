'use client';

import { useMemo } from 'react';
import { useDemo } from './demo-context';
import { api } from './api';
import type {
  Project,
  ApiKey,
  StatsOverview,
  ProjectStats,
  TimelineData,
  ActivityItem,
  CreateProjectResponse,
} from './api';
import {
  mockOverview,
  mockProjectStats,
  generateMockTimeline,
  mockActivity,
  mockProjects,
  mockApiKeys,
  mockTables,
  mockBuckets,
  mockFiles,
  mockSqlResult,
} from './demo-data';

// Demo-aware API that returns mock data when in demo mode
export function createDemoApi(isDemo: boolean) {
  if (!isDemo) {
    return api;
  }

  return {
    // Projects
    async listProjects(): Promise<{ data: Project[] }> {
      return { data: mockProjects };
    },

    async getProject(id: string): Promise<{ data: Project }> {
      const project = mockProjects.find((p) => p.id === id || p.name.toLowerCase().includes(id));
      if (!project) {
        throw new Error('Project not found');
      }
      return { data: project };
    },

    async createProject(_data: {
      name: string;
      description?: string;
    }): Promise<{ data: CreateProjectResponse }> {
      throw new Error('Cannot create projects in demo mode');
    },

    async deleteProject(_id: string): Promise<void> {
      throw new Error('Cannot delete projects in demo mode');
    },

    // API Keys
    async listProjectKeys(_projectId: string): Promise<{ data: ApiKey[] }> {
      return { data: mockApiKeys };
    },

    async rotateKey(
      _projectId: string,
      _keyType: 'publishable' | 'secret'
    ): Promise<{ data: { apiKey: ApiKey; newKey: string } }> {
      throw new Error('Cannot rotate keys in demo mode');
    },

    async revokeKey(_projectId: string, _keyId: string): Promise<void> {
      throw new Error('Cannot revoke keys in demo mode');
    },

    // SQL Editor
    async executeSQL(
      _projectId: string,
      _sql: string
    ): Promise<{
      data: {
        columns: string[];
        rows: Record<string, unknown>[];
        rowCount: number;
        executionTimeMs: number;
      };
    }> {
      // Return mock SQL result
      return { data: mockSqlResult };
    },

    // Tables
    async listTables(_projectId: string): Promise<{
      data: Array<{ name: string; type: 'table' | 'view' }>;
    }> {
      return { data: mockTables };
    },

    async getTableColumns(
      _projectId: string,
      tableName: string
    ): Promise<{
      data: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
    }> {
      // Mock column data based on table name
      const mockColumns: Record<
        string,
        Array<{ name: string; type: string; nullable: boolean; default: string | null }>
      > = {
        products: [
          { name: 'id', type: 'integer', nullable: false, default: 'nextval(...)' },
          { name: 'name', type: 'varchar(255)', nullable: false, default: null },
          { name: 'price', type: 'decimal(10,2)', nullable: false, default: '0.00' },
          { name: 'created_at', type: 'timestamp', nullable: false, default: 'now()' },
        ],
        categories: [
          { name: 'id', type: 'integer', nullable: false, default: 'nextval(...)' },
          { name: 'name', type: 'varchar(100)', nullable: false, default: null },
          { name: 'parent_id', type: 'integer', nullable: true, default: null },
        ],
        orders: [
          { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' },
          { name: 'customer_id', type: 'integer', nullable: false, default: null },
          { name: 'total', type: 'decimal(10,2)', nullable: false, default: '0.00' },
          { name: 'status', type: 'varchar(50)', nullable: false, default: "'pending'" },
          { name: 'created_at', type: 'timestamp', nullable: false, default: 'now()' },
        ],
        customers: [
          { name: 'id', type: 'integer', nullable: false, default: 'nextval(...)' },
          { name: 'email', type: 'varchar(255)', nullable: false, default: null },
          { name: 'name', type: 'varchar(255)', nullable: true, default: null },
        ],
      };
      return { data: mockColumns[tableName] || [] };
    },

    // Storage
    async listBuckets(_projectId: string): Promise<{
      data: Array<{ id: string; name: string; createdAt: string }>;
    }> {
      return { data: mockBuckets };
    },

    async listFiles(
      _projectId: string,
      _bucketName: string,
      _prefix?: string
    ): Promise<{
      data: Array<{ key: string; size: number; lastModified: string }>;
    }> {
      return { data: mockFiles };
    },

    async getSignedUploadUrl(
      _projectId: string,
      _bucket: string,
      _path: string,
      _contentType: string,
      _maxSize?: number
    ): Promise<{ objectKey: string; uploadUrl: string; expiresIn: number }> {
      throw new Error('Cannot upload files in demo mode');
    },

    async deleteFile(
      _projectId: string,
      _bucketName: string,
      _objectKey: string
    ): Promise<{ success: boolean }> {
      throw new Error('Cannot delete files in demo mode');
    },

    async getSignedDownloadUrl(
      _projectId: string,
      _bucketName: string,
      _objectKey: string
    ): Promise<{ downloadUrl: string; expiresIn: number }> {
      throw new Error('Cannot download files in demo mode');
    },

    // Stats
    async getStatsOverview(): Promise<StatsOverview> {
      return mockOverview;
    },

    async getProjectsStats(): Promise<{ projects: ProjectStats[] }> {
      return { projects: mockProjectStats };
    },

    async getTimeline(days?: number): Promise<{ timeline: TimelineData[] }> {
      return { timeline: generateMockTimeline(days || 30) };
    },

    async getActivity(limit?: number): Promise<{ activity: ActivityItem[] }> {
      return { activity: mockActivity.slice(0, limit || 20) };
    },

    // Data Tools (Import/Export) - Per Project
    async listDataToolsJobs(_projectId: string): Promise<{
      data: Array<{
        id: string;
        projectId: string;
        jobType: 'import' | 'export';
        status: 'pending' | 'running' | 'completed' | 'failed';
        tableName: string;
        format: 'csv' | 'json';
        rowCount?: number | null;
        errorMessage?: string | null;
        objectKey?: string | null;
        createdAt: string;
        completedAt?: string | null;
      }>;
    }> {
      return {
        data: [
          {
            id: 'job-1',
            projectId: 'demo-project',
            jobType: 'export',
            status: 'completed',
            tableName: 'products',
            format: 'csv',
            rowCount: 156,
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            completedAt: new Date(Date.now() - 3500000).toISOString(),
          },
          {
            id: 'job-2',
            projectId: 'demo-project',
            jobType: 'import',
            status: 'completed',
            tableName: 'customers',
            format: 'json',
            rowCount: 42,
            createdAt: new Date(Date.now() - 86400000).toISOString(),
            completedAt: new Date(Date.now() - 86300000).toISOString(),
          },
        ],
      };
    },

    async exportTable(
      _projectId: string,
      _tableName: string,
      _format: 'csv' | 'json',
      _options?: { limit?: number; columns?: string[] }
    ): Promise<string> {
      throw new Error('Cannot export data in demo mode');
    },

    async importTable(
      _projectId: string,
      _tableName: string,
      _format: 'csv' | 'json',
      _data: string,
      _mode: 'insert' | 'upsert'
    ): Promise<{ data: { rowCount: number } }> {
      throw new Error('Cannot import data in demo mode');
    },

    async getDataToolsUploadUrl(
      _projectId: string,
      _filename: string,
      _contentType: string
    ): Promise<{ data: { uploadUrl: string; objectKey: string; expiresIn: number } }> {
      throw new Error('Cannot upload files in demo mode');
    },
  };
}

// Stable reference for the demo API to avoid infinite re-renders
const demoApiInstance = createDemoApi(true);

// Hook to get the appropriate API based on demo mode
export function useDemoApi() {
  const { isDemo } = useDemo();
  // Return stable references to avoid re-renders
  return useMemo(() => (isDemo ? demoApiInstance : api), [isDemo]);
}
