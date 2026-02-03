import type { ParsedFilter, ParsedOrder, TableInfo } from '@atlashub/shared';
import { projectDb } from '../db/project.js';
import { config } from '../config/env.js';
import { buildWhereClause, buildOrderClause, buildSelectColumns } from '../lib/sql-builder.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

// Cache for table info per project
const tableInfoCache = new Map<string, { tables: TableInfo[]; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

// Valid PostgreSQL data types (subset for safety)
const ALLOWED_DATA_TYPES = new Set([
  'text',
  'varchar',
  'char',
  'integer',
  'int',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'boolean',
  'bool',
  'timestamp',
  'timestamptz',
  'date',
  'time',
  'timetz',
  'uuid',
  'json',
  'jsonb',
  'numeric',
  'decimal',
  'real',
  'double precision',
  'float',
  'bytea',
]);

// Reserved table names
const RESERVED_TABLE_NAMES = new Set(['pg_catalog', 'information_schema', 'pg_toast', 'pg_temp']);

// Column definition type
interface ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  defaultValue?: string;
  references?: {
    table: string;
    column: string;
  };
}

// Validate identifier (table name, column name)
function validateIdentifier(name: string, type: 'table' | 'column'): void {
  if (!name || typeof name !== 'string') {
    throw new BadRequestError(`${type} name is required`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new BadRequestError(
      `Invalid ${type} name: ${name}. Must start with letter or underscore, contain only alphanumeric and underscores`
    );
  }
  if (name.length > 63) {
    throw new BadRequestError(`${type} name too long: max 63 characters`);
  }
  if (type === 'table' && RESERVED_TABLE_NAMES.has(name.toLowerCase())) {
    throw new BadRequestError(`${type} name is reserved: ${name}`);
  }
}

export const crudService = {
  async getTables(projectId: string): Promise<TableInfo[]> {
    const cached = tableInfoCache.get(projectId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.tables;
    }

    const result = await projectDb.queryAsApp<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      projectId,
      `SELECT
         c.table_name,
         c.column_name,
         c.data_type,
         c.is_nullable,
         c.column_default
       FROM information_schema.columns c
       JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name, c.ordinal_position`
    );

    const tablesMap = new Map<string, TableInfo>();

    for (const row of result.rows) {
      let tableInfo = tablesMap.get(row.table_name);
      if (!tableInfo) {
        tableInfo = { tableName: row.table_name, columns: [] };
        tablesMap.set(row.table_name, tableInfo);
      }
      tableInfo.columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default,
      });
    }

    const tables = Array.from(tablesMap.values());
    tableInfoCache.set(projectId, { tables, timestamp: Date.now() });

    return tables;
  },

  async select(
    projectId: string,
    table: string,
    options: {
      select?: string[] | '*';
      order?: ParsedOrder;
      limit?: number;
      offset?: number;
      filters?: ParsedFilter[];
    }
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    // Validate table exists
    const tables = await this.getTables(projectId);
    const tableInfo = tables.find((t) => t.tableName === table);
    if (!tableInfo) {
      throw new NotFoundError(`Table "${table}" not found`);
    }

    const allowedColumns = tableInfo.columns.map((c) => c.name);

    // Validate order column
    if (options.order && !allowedColumns.includes(options.order.column)) {
      throw new BadRequestError(`Invalid order column: ${options.order.column}`);
    }

    // Validate filter columns
    if (options.filters) {
      for (const filter of options.filters) {
        if (!allowedColumns.includes(filter.column)) {
          throw new BadRequestError(`Invalid filter column: ${filter.column}`);
        }
      }
    }

    const selectCols = buildSelectColumns(options.select || '*', allowedColumns);
    const { clause: whereClause, values: whereValues } = buildWhereClause(options.filters || []);
    const orderClause = buildOrderClause(options.order);

    const limit = Math.min(
      options.limit || config.query.defaultRowsLimit,
      config.query.maxRowsPerQuery
    );
    const offset = options.offset || 0;

    const sql = `
      SELECT ${selectCols}
      FROM "${table}"
      ${whereClause}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await projectDb.queryAsApp<Record<string, unknown>>(projectId, sql, whereValues);

    return { rows: result.rows, rowCount: result.rowCount || 0 };
  },

  async insert(
    projectId: string,
    table: string,
    rows: Record<string, unknown>[],
    returning = false
  ): Promise<Record<string, unknown>[]> {
    // Validate table exists
    const tables = await this.getTables(projectId);
    const tableInfo = tables.find((t) => t.tableName === table);
    if (!tableInfo) {
      throw new NotFoundError(`Table "${table}" not found`);
    }

    const allowedColumns = tableInfo.columns.map((c) => c.name);
    const results: Record<string, unknown>[] = [];

    for (const row of rows) {
      const columns: string[] = [];
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const [col, val] of Object.entries(row)) {
        if (!allowedColumns.includes(col)) {
          throw new BadRequestError(`Invalid column: ${col}`);
        }
        columns.push(`"${col}"`);
        values.push(val);
        placeholders.push(`$${paramIndex}`);
        paramIndex++;
      }

      const sql = `
        INSERT INTO "${table}" (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        ${returning ? 'RETURNING *' : ''}
      `;

      const result = await projectDb.queryAsApp<Record<string, unknown>>(projectId, sql, values);
      if (returning && result.rows.length > 0) {
        results.push(result.rows[0]);
      }
    }

    return results;
  },

  async update(
    projectId: string,
    table: string,
    values: Record<string, unknown>,
    filters: ParsedFilter[],
    returning = false
  ): Promise<Record<string, unknown>[]> {
    // Validate table exists
    const tables = await this.getTables(projectId);
    const tableInfo = tables.find((t) => t.tableName === table);
    if (!tableInfo) {
      throw new NotFoundError(`Table "${table}" not found`);
    }

    const allowedColumns = tableInfo.columns.map((c) => c.name);

    // Validate filter columns
    for (const filter of filters) {
      if (!allowedColumns.includes(filter.column)) {
        throw new BadRequestError(`Invalid filter column: ${filter.column}`);
      }
    }

    const setClauses: string[] = [];
    const updateValues: unknown[] = [];
    let paramIndex = 1;

    for (const [col, val] of Object.entries(values)) {
      if (!allowedColumns.includes(col)) {
        throw new BadRequestError(`Invalid column: ${col}`);
      }
      setClauses.push(`"${col}" = $${paramIndex}`);
      updateValues.push(val);
      paramIndex++;
    }

    const { clause: whereClause, values: whereValues } = buildWhereClause(filters, paramIndex);
    const allValues = [...updateValues, ...whereValues];

    const sql = `
      UPDATE "${table}"
      SET ${setClauses.join(', ')}
      ${whereClause}
      ${returning ? 'RETURNING *' : ''}
    `;

    const result = await projectDb.queryAsApp<Record<string, unknown>>(projectId, sql, allValues);
    return returning ? result.rows : [];
  },

  async delete(
    projectId: string,
    table: string,
    filters: ParsedFilter[]
  ): Promise<{ rowCount: number }> {
    // Validate table exists
    const tables = await this.getTables(projectId);
    const tableInfo = tables.find((t) => t.tableName === table);
    if (!tableInfo) {
      throw new NotFoundError(`Table "${table}" not found`);
    }

    const allowedColumns = tableInfo.columns.map((c) => c.name);

    // Validate filter columns
    for (const filter of filters) {
      if (!allowedColumns.includes(filter.column)) {
        throw new BadRequestError(`Invalid filter column: ${filter.column}`);
      }
    }

    const { clause: whereClause, values } = buildWhereClause(filters);

    const sql = `DELETE FROM "${table}" ${whereClause}`;

    const result = await projectDb.queryAsApp(projectId, sql, values);
    return { rowCount: result.rowCount || 0 };
  },

  clearCache(projectId?: string): void {
    if (projectId) {
      tableInfoCache.delete(projectId);
    } else {
      tableInfoCache.clear();
    }
  },

  // ============================================================
  // DDL Operations (Schema management) - Requires secret key
  // ============================================================

  async createTable(
    projectId: string,
    tableName: string,
    columns: ColumnDefinition[],
    ifNotExists = false
  ): Promise<{ success: true; tableName: string }> {
    validateIdentifier(tableName, 'table');

    if (!columns || columns.length === 0) {
      throw new BadRequestError('At least one column is required');
    }

    if (columns.length > 100) {
      throw new BadRequestError('Too many columns: max 100');
    }

    const columnDefs: string[] = [];
    const primaryKeys: string[] = [];
    const uniqueConstraints: string[] = [];
    const foreignKeys: string[] = [];

    for (const col of columns) {
      validateIdentifier(col.name, 'column');

      // Validate and normalize type
      const baseType = col.type.toLowerCase().split('(')[0].trim();
      if (!ALLOWED_DATA_TYPES.has(baseType)) {
        throw new BadRequestError(
          `Invalid data type: ${col.type}. Allowed: ${[...ALLOWED_DATA_TYPES].join(', ')}`
        );
      }

      let def = `"${col.name}" ${col.type}`;

      if (col.nullable === false) {
        def += ' NOT NULL';
      }

      if (col.defaultValue !== undefined) {
        // Only allow simple default values (no SQL injection)
        const defaultVal = col.defaultValue;
        if (
          defaultVal === 'now()' ||
          defaultVal === 'CURRENT_TIMESTAMP' ||
          defaultVal === 'gen_random_uuid()' ||
          defaultVal === 'true' ||
          defaultVal === 'false' ||
          /^-?\d+(\.\d+)?$/.test(defaultVal) ||
          /^'[^']*'$/.test(defaultVal)
        ) {
          def += ` DEFAULT ${defaultVal}`;
        } else {
          throw new BadRequestError(`Invalid default value: ${defaultVal}`);
        }
      }

      columnDefs.push(def);

      if (col.primaryKey) {
        primaryKeys.push(`"${col.name}"`);
      }

      if (col.unique) {
        uniqueConstraints.push(`UNIQUE ("${col.name}")`);
      }

      if (col.references) {
        validateIdentifier(col.references.table, 'table');
        validateIdentifier(col.references.column, 'column');
        foreignKeys.push(
          `FOREIGN KEY ("${col.name}") REFERENCES "${col.references.table}" ("${col.references.column}")`
        );
      }
    }

    // Add primary key constraint
    if (primaryKeys.length > 0) {
      columnDefs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);
    }

    // Add unique constraints
    columnDefs.push(...uniqueConstraints);

    // Add foreign key constraints
    columnDefs.push(...foreignKeys);

    const ifNotExistsClause = ifNotExists ? 'IF NOT EXISTS ' : '';
    const sql = `CREATE TABLE ${ifNotExistsClause}"${tableName}" (\n  ${columnDefs.join(',\n  ')}\n)`;

    await projectDb.queryAsOwner(projectId, sql);
    this.clearCache(projectId);

    return { success: true, tableName };
  },

  async dropTable(
    projectId: string,
    tableName: string,
    ifExists = false,
    cascade = false
  ): Promise<{ success: true; tableName: string }> {
    validateIdentifier(tableName, 'table');

    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    const cascadeClause = cascade ? ' CASCADE' : '';
    const sql = `DROP TABLE ${ifExistsClause}"${tableName}"${cascadeClause}`;

    await projectDb.queryAsOwner(projectId, sql);
    this.clearCache(projectId);

    return { success: true, tableName };
  },

  async addColumn(
    projectId: string,
    tableName: string,
    column: ColumnDefinition
  ): Promise<{ success: true; tableName: string; columnName: string }> {
    validateIdentifier(tableName, 'table');
    validateIdentifier(column.name, 'column');

    const baseType = column.type.toLowerCase().split('(')[0].trim();
    if (!ALLOWED_DATA_TYPES.has(baseType)) {
      throw new BadRequestError(`Invalid data type: ${column.type}`);
    }

    let def = `"${column.name}" ${column.type}`;

    if (column.nullable === false) {
      def += ' NOT NULL';
    }

    if (column.defaultValue !== undefined) {
      const defaultVal = column.defaultValue;
      if (
        defaultVal === 'now()' ||
        defaultVal === 'CURRENT_TIMESTAMP' ||
        defaultVal === 'gen_random_uuid()' ||
        defaultVal === 'true' ||
        defaultVal === 'false' ||
        /^-?\d+(\.\d+)?$/.test(defaultVal) ||
        /^'[^']*'$/.test(defaultVal)
      ) {
        def += ` DEFAULT ${defaultVal}`;
      } else {
        throw new BadRequestError(`Invalid default value: ${defaultVal}`);
      }
    }

    if (column.unique) {
      def += ' UNIQUE';
    }

    const sql = `ALTER TABLE "${tableName}" ADD COLUMN ${def}`;

    await projectDb.queryAsOwner(projectId, sql);
    this.clearCache(projectId);

    return { success: true, tableName, columnName: column.name };
  },

  async dropColumn(
    projectId: string,
    tableName: string,
    columnName: string,
    ifExists = false,
    cascade = false
  ): Promise<{ success: true; tableName: string; columnName: string }> {
    validateIdentifier(tableName, 'table');
    validateIdentifier(columnName, 'column');

    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    const cascadeClause = cascade ? ' CASCADE' : '';
    const sql = `ALTER TABLE "${tableName}" DROP COLUMN ${ifExistsClause}"${columnName}"${cascadeClause}`;

    await projectDb.queryAsOwner(projectId, sql);
    this.clearCache(projectId);

    return { success: true, tableName, columnName };
  },

  async renameTable(
    projectId: string,
    oldName: string,
    newName: string
  ): Promise<{ success: true; oldName: string; newName: string }> {
    validateIdentifier(oldName, 'table');
    validateIdentifier(newName, 'table');

    const sql = `ALTER TABLE "${oldName}" RENAME TO "${newName}"`;

    await projectDb.queryAsOwner(projectId, sql);
    this.clearCache(projectId);

    return { success: true, oldName, newName };
  },

  async renameColumn(
    projectId: string,
    tableName: string,
    oldName: string,
    newName: string
  ): Promise<{ success: true; tableName: string; oldName: string; newName: string }> {
    validateIdentifier(tableName, 'table');
    validateIdentifier(oldName, 'column');
    validateIdentifier(newName, 'column');

    const sql = `ALTER TABLE "${tableName}" RENAME COLUMN "${oldName}" TO "${newName}"`;

    await projectDb.queryAsOwner(projectId, sql);
    this.clearCache(projectId);

    return { success: true, tableName, oldName, newName };
  },
};
