import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Project } from '@atlashub/shared';
import { platformDb } from '../db/platform.js';
import { projectDb } from '../db/project.js';
import { config } from '../config/env.js';
import { generateApiKey, hashApiKey, encrypt, generateSecurePassword } from '../lib/crypto.js';
import { storageService } from './storage.js';
import { apiKeyService } from './api-key.js';
import { webhookService } from './webhook.js';
import { NotFoundError } from '../lib/errors.js';
import { auditService } from './audit.js';

/**
 * Generate a URL-safe slug from a name
 */
function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'project'
  );
}

/**
 * Generate a unique slug by appending a random suffix if needed
 */
async function generateUniqueSlug(baseName: string): Promise<string> {
  const baseSlug = generateSlug(baseName);

  // Check if slug exists
  const existing = await platformDb.query('SELECT 1 FROM projects WHERE slug = $1', [baseSlug]);

  if (existing.rows.length === 0) {
    return baseSlug;
  }

  // Append a random suffix
  const suffix = randomUUID().slice(0, 6);
  return `${baseSlug}-${suffix}`;
}

export const projectService = {
  async listProjects(): Promise<Project[]> {
    const result = await platformDb.query<{
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT id, name, description, created_at, updated_at FROM projects ORDER BY created_at DESC'
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  async getProject(id: string): Promise<Project | undefined> {
    const result = await platformDb.query<{
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT id, name, description, created_at, updated_at FROM projects WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async createProject(data: { name: string; description?: string }): Promise<{
    project: Project;
    publishableKey: string;
    secretKey: string;
  }> {
    const projectId = randomUUID();
    const slug = await generateUniqueSlug(data.name);
    const dbName = `proj_${projectId.replace(/-/g, '_')}`;
    const ownerRole = `${dbName}_owner`;
    const appRole = `${dbName}_app`;
    const ownerPassword = generateSecurePassword();
    const appPassword = generateSecurePassword();

    // Generate API keys
    const publishableKey = generateApiKey('pk');
    const secretKey = generateApiKey('sk');

    // CREATE DATABASE and CREATE ROLE cannot run inside a transaction block
    // Run them first, then do the rest in a transaction
    try {
      await platformDb.query(`CREATE DATABASE "${dbName}"`);
      await platformDb.query(`CREATE ROLE "${ownerRole}" WITH LOGIN PASSWORD '${ownerPassword}'`);
      await platformDb.query(`CREATE ROLE "${appRole}" WITH LOGIN PASSWORD '${appPassword}'`);
      await platformDb.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${ownerRole}"`);
      await platformDb.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${appRole}"`);

      // Connect to the new database to grant schema permissions
      const tempPool = new Pool({
        host: config.postgres.host,
        port: config.postgres.port,
        database: dbName,
        user: config.postgres.user,
        password: config.postgres.password,
        max: 1,
      });

      try {
        // Grant schema permissions to owner role
        await tempPool.query(`GRANT ALL ON SCHEMA public TO "${ownerRole}"`);
        await tempPool.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${ownerRole}"`
        );
        await tempPool.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${ownerRole}"`
        );

        // Grant limited permissions to app role
        await tempPool.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
        await tempPool.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`
        );
        await tempPool.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}"`
        );
      } finally {
        await tempPool.end();
      }
    } catch (error) {
      // Cleanup on failure
      await platformDb.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
      await platformDb.query(`DROP ROLE IF EXISTS "${ownerRole}"`).catch(() => {});
      await platformDb.query(`DROP ROLE IF EXISTS "${appRole}"`).catch(() => {});
      throw error;
    }

    try {
      return await platformDb.transaction(async (client) => {
        // Insert project
        const projectResult = await client.query<{
          id: string;
          name: string;
          slug: string;
          description: string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO projects (id, name, slug, description)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, slug, description, created_at, updated_at`,
          [projectId, data.name, slug, data.description || null]
        );

        const project = {
          id: projectResult.rows[0].id,
          name: projectResult.rows[0].name,
          description: projectResult.rows[0].description,
          createdAt: projectResult.rows[0].created_at,
          updatedAt: projectResult.rows[0].updated_at,
        };

        // Store encrypted credentials
        const ownerConnStr = `postgresql://${ownerRole}:${ownerPassword}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${dbName}`;
        const appConnStr = `postgresql://${appRole}:${appPassword}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${dbName}`;

        const ownerEncrypted = encrypt(ownerConnStr);
        const appEncrypted = encrypt(appConnStr);

        await client.query(
          `INSERT INTO project_db_creds (id, project_id, role, encrypted_connection_string, iv, auth_tag)
           VALUES ($1, $2, 'owner', $3, $4, $5)`,
          [
            randomUUID(),
            projectId,
            ownerEncrypted.encrypted,
            ownerEncrypted.iv,
            ownerEncrypted.authTag,
          ]
        );

        await client.query(
          `INSERT INTO project_db_creds (id, project_id, role, encrypted_connection_string, iv, auth_tag)
           VALUES ($1, $2, 'app', $3, $4, $5)`,
          [randomUUID(), projectId, appEncrypted.encrypted, appEncrypted.iv, appEncrypted.authTag]
        );

        // Store API keys (hashed)
        const publishableKeyId = randomUUID();
        const secretKeyId = randomUUID();

        await client.query(
          `INSERT INTO api_keys (id, project_id, key_type, key_hash, key_prefix)
           VALUES ($1, $2, 'publishable', $3, $4)`,
          [publishableKeyId, projectId, hashApiKey(publishableKey), publishableKey.slice(0, 8)]
        );

        await client.query(
          `INSERT INTO api_keys (id, project_id, key_type, key_hash, key_prefix)
           VALUES ($1, $2, 'secret', $3, $4)`,
          [secretKeyId, projectId, hashApiKey(secretKey), secretKey.slice(0, 8)]
        );

        // Create MinIO bucket
        await storageService.createProjectBucket(projectId);

        // Insert default logical buckets
        await client.query(
          `INSERT INTO buckets (id, project_id, name) VALUES ($1, $2, 'private')`,
          [randomUUID(), projectId]
        );
        await client.query(
          `INSERT INTO buckets (id, project_id, name) VALUES ($1, $2, 'uploads')`,
          [randomUUID(), projectId]
        );

        // Log the project creation
        await auditService.log({
          action: auditService.actions.PROJECT_CREATED,
          projectId,
          details: { name: data.name, description: data.description },
        });

        return { project, publishableKey, secretKey };
      });
    } catch (error) {
      // Transaction failed, cleanup DB and roles
      await platformDb.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
      await platformDb.query(`DROP ROLE IF EXISTS "${ownerRole}"`).catch(() => {});
      await platformDb.query(`DROP ROLE IF EXISTS "${appRole}"`).catch(() => {});
      throw error;
    }
  },

  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Log project deletion before removing (project_id will be null after delete)
    await auditService.log({
      action: auditService.actions.PROJECT_DELETED,
      details: { projectId: id, projectName: project.name },
    });

    const dbName = `proj_${id.replace(/-/g, '_')}`;
    const ownerRole = `${dbName}_owner`;
    const appRole = `${dbName}_app`;

    // Close any open connections to project DB
    await projectDb.closeProjectPools(id);

    // Delete from platform tables in a transaction
    await platformDb.transaction(async (client) => {
      await client.query('DELETE FROM file_metadata WHERE project_id = $1', [id]);
      await client.query('DELETE FROM buckets WHERE project_id = $1', [id]);
      await client.query('DELETE FROM api_keys WHERE project_id = $1', [id]);
      await client.query('DELETE FROM project_db_creds WHERE project_id = $1', [id]);
      await client.query('DELETE FROM audit_logs WHERE project_id = $1', [id]);
      await client.query('DELETE FROM projects WHERE id = $1', [id]);
    });

    // Cached keys, buckets and webhooks of the deleted project must stop working now.
    apiKeyService.clearKeyCache();
    storageService.clearBucketCache(id);
    webhookService.clearWebhookCache(id);

    // DROP DATABASE and DROP ROLE cannot run inside a transaction block
    await platformDb.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await platformDb.query(`DROP ROLE IF EXISTS "${ownerRole}"`);
    await platformDb.query(`DROP ROLE IF EXISTS "${appRole}"`);

    // Delete MinIO bucket
    await storageService.deleteProjectBucket(id);
  },
};
