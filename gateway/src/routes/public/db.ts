import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { tableNameSchema, insertBodySchema, updateBodySchema } from '@atlashub/shared';
import type { ProjectContext } from '@atlashub/shared';
import { z } from 'zod';
import { crudService } from '../../services/crud.js';
import { BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { parseFilters, parseOrder, parseSelect } from '../../lib/query-parser.js';

declare module 'fastify' {
  interface FastifyRequest {
    projectContext: ProjectContext;
  }
}

// Schema for column definition
const columnDefinitionSchema = z.object({
  name: z.string().min(1).max(63),
  type: z.string().min(1).max(100),
  nullable: z.boolean().optional().default(true),
  primaryKey: z.boolean().optional().default(false),
  unique: z.boolean().optional().default(false),
  defaultValue: z.string().optional(),
  references: z
    .object({
      table: z.string().min(1).max(63),
      column: z.string().min(1).max(63),
    })
    .optional(),
});

// Schema for creating a table
const createTableSchema = z.object({
  name: z.string().min(1).max(63),
  columns: z.array(columnDefinitionSchema).min(1).max(100),
  ifNotExists: z.boolean().optional().default(false),
});

// Schema for dropping a table
const dropTableSchema = z.object({
  ifExists: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});

// Schema for adding a column
const addColumnSchema = columnDefinitionSchema;

// Schema for dropping a column
const dropColumnSchema = z.object({
  ifExists: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});

// Schema for renaming
const renameTableSchema = z.object({
  newName: z.string().min(1).max(63),
});

const renameColumnSchema = z.object({
  oldName: z.string().min(1).max(63),
  newName: z.string().min(1).max(63),
});

// Helper to check if request has secret key permissions
function requireSecretKey(request: FastifyRequest): void {
  if (request.projectContext.keyType !== 'secret') {
    throw new ForbiddenError('This operation requires a secret API key');
  }
}

export const dbRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Get available tables
  fastify.get('/tables', async (request: FastifyRequest, reply) => {
    const tables = await crudService.getTables(request.projectContext.projectId);
    return reply.send({ data: tables });
  });

  // SELECT rows from a table
  fastify.get<{ Params: { table: string }; Querystring: Record<string, string> }>(
    '/:table',
    async (request, reply) => {
      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const { projectContext } = request;
      const { table } = request.params;
      const query = request.query;

      const select = parseSelect(query.select);
      const order = parseOrder(query.order);
      const limit = query.limit ? parseInt(query.limit, 10) : undefined;
      const offset = query.offset ? parseInt(query.offset, 10) : undefined;
      const filters = parseFilters(query);

      const result = await crudService.select(projectContext.projectId, table, {
        select,
        order,
        limit,
        offset,
        filters,
      });

      return reply.send({ data: result.rows, meta: { rowCount: result.rowCount } });
    }
  );

  // INSERT rows
  fastify.post<{ Params: { table: string } }>('/:table', async (request, reply) => {
    const tableResult = tableNameSchema.safeParse(request.params.table);
    if (!tableResult.success) {
      throw new BadRequestError('Invalid table name');
    }

    const bodyResult = insertBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new BadRequestError('Invalid request body', bodyResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { table } = request.params;
    const { rows, returning } = bodyResult.data;

    const result = await crudService.insert(projectContext.projectId, table, rows, returning);
    return reply.status(201).send({ data: result });
  });

  // UPDATE rows
  fastify.patch<{ Params: { table: string }; Querystring: Record<string, string> }>(
    '/:table',
    async (request, reply) => {
      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const bodyResult = updateBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        throw new BadRequestError('Invalid request body', bodyResult.error.flatten().fieldErrors);
      }

      const { projectContext } = request;
      const { table } = request.params;
      const { values, returning } = bodyResult.data;
      const filters = parseFilters(request.query);

      if (filters.length === 0) {
        throw new BadRequestError('At least one filter is required for UPDATE');
      }

      const result = await crudService.update(
        projectContext.projectId,
        table,
        values,
        filters,
        returning
      );
      return reply.send({ data: result });
    }
  );

  // DELETE rows
  fastify.delete<{ Params: { table: string }; Querystring: Record<string, string> }>(
    '/:table',
    async (request, reply) => {
      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const { projectContext } = request;
      const { table } = request.params;
      const filters = parseFilters(request.query);

      if (filters.length === 0) {
        throw new BadRequestError('At least one filter is required for DELETE');
      }

      const result = await crudService.delete(projectContext.projectId, table, filters);
      return reply.send({ data: { deletedCount: result.rowCount } });
    }
  );

  // ============================================================
  // DDL (Schema) Operations - Require SECRET key
  // ============================================================

  // Create a new table
  fastify.post('/schema/tables', async (request, reply) => {
    requireSecretKey(request);

    const parsed = createTableSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const { name, columns, ifNotExists } = parsed.data;
    const result = await crudService.createTable(
      request.projectContext.projectId,
      name,
      columns,
      ifNotExists
    );

    return reply.status(201).send({ data: result });
  });

  // Drop a table
  fastify.delete<{ Params: { table: string } }>('/schema/tables/:table', async (request, reply) => {
    requireSecretKey(request);

    const tableResult = tableNameSchema.safeParse(request.params.table);
    if (!tableResult.success) {
      throw new BadRequestError('Invalid table name');
    }

    const parsed = dropTableSchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await crudService.dropTable(
      request.projectContext.projectId,
      request.params.table,
      parsed.data.ifExists,
      parsed.data.cascade
    );

    return reply.send({ data: result });
  });

  // Rename a table
  fastify.patch<{ Params: { table: string } }>(
    '/schema/tables/:table/rename',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = renameTableSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.renameTable(
        request.projectContext.projectId,
        request.params.table,
        parsed.data.newName
      );

      return reply.send({ data: result });
    }
  );

  // Add a column to a table
  fastify.post<{ Params: { table: string } }>(
    '/schema/tables/:table/columns',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = addColumnSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.addColumn(
        request.projectContext.projectId,
        request.params.table,
        parsed.data
      );

      return reply.status(201).send({ data: result });
    }
  );

  // Drop a column from a table
  fastify.delete<{ Params: { table: string; column: string } }>(
    '/schema/tables/:table/columns/:column',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const columnResult = tableNameSchema.safeParse(request.params.column);
      if (!columnResult.success) {
        throw new BadRequestError('Invalid column name');
      }

      const parsed = dropColumnSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.dropColumn(
        request.projectContext.projectId,
        request.params.table,
        request.params.column,
        parsed.data.ifExists,
        parsed.data.cascade
      );

      return reply.send({ data: result });
    }
  );

  // Rename a column
  fastify.patch<{ Params: { table: string } }>(
    '/schema/tables/:table/columns/rename',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = renameColumnSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.renameColumn(
        request.projectContext.projectId,
        request.params.table,
        parsed.data.oldName,
        parsed.data.newName
      );

      return reply.send({ data: result });
    }
  );
};
