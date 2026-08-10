import { randomUUID } from 'node:crypto';
import { bucketNameSchema } from '@atlashub/shared';
import { platformDb } from '../db/platform.js';
import { BadRequestError, ConflictError } from '../lib/errors.js';

export interface Bucket {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
}

function parseBucketName(name: unknown): string {
  const result = bucketNameSchema.safeParse(name);
  if (!result.success) {
    throw new BadRequestError('Invalid bucket name', result.error.flatten().fieldErrors);
  }
  return result.data;
}

export const bucketService = {
  async listBuckets(projectId: string): Promise<Bucket[]> {
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      name: string;
      created_at: Date;
    }>(
      `SELECT id, project_id, name, created_at
       FROM buckets
       WHERE project_id = $1
       ORDER BY name`,
      [projectId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      createdAt: row.created_at,
    }));
  },

  async createBucket(projectId: string, name: unknown): Promise<Bucket> {
    const validatedName = parseBucketName(name);

    try {
      const result = await platformDb.query<{
        id: string;
        project_id: string;
        name: string;
        created_at: Date;
      }>(
        `INSERT INTO buckets (id, project_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, project_id, name, created_at`,
        [randomUUID(), projectId, validatedName]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        createdAt: row.created_at,
      };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictError(`Bucket "${validatedName}" already exists`);
      }
      throw error;
    }
  },
};
