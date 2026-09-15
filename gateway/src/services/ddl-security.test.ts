import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  config: { isProduction: false, query: { defaultRowsLimit: 100, maxRowsPerQuery: 1000 } },
}));

const queryAsOwner = vi.fn();
const clientQuery = vi.fn();
vi.mock('../db/project.js', () => ({
  projectDb: {
    queryAsOwner: (...args: unknown[]) => queryAsOwner(...args),
    queryAsApp: vi.fn(),
    withOwnerClient: async (_projectId: string, fn: (client: { query: typeof clientQuery }) => unknown) =>
      fn({ query: clientQuery }),
  },
}));

import { crudService, normalizeColumnType } from './crud.js';
import { sqlService } from './sql.js';
import { runtimeSettings } from './runtime-settings.js';

beforeEach(() => {
  queryAsOwner.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  clientQuery.mockReset().mockResolvedValue({ rows: [{ one: 1 }], rowCount: 1, fields: [{ name: 'one' }] });
});

describe('normalizeColumnType', () => {
  it('accepts allowed types with an optional length or precision', () => {
    expect(normalizeColumnType('text')).toBe('text');
    expect(normalizeColumnType('VARCHAR(255)')).toBe('varchar(255)');
    expect(normalizeColumnType('numeric( 10 , 2 )')).toBe('numeric(10, 2)');
    expect(normalizeColumnType('double precision')).toBe('double precision');
  });

  it.each([
    'varchar(1)); DROP TABLE users; --',
    'text; DELETE FROM items',
    'varchar(1)) , evil text',
    'integer DEFAULT 1',
    'money',
    'text[]',
  ])('rejects %s', (type) => {
    expect(() => normalizeColumnType(type)).toThrow('Invalid data type');
  });
});

describe('DDL through the public API', () => {
  it('createTable does not run SQL smuggled in a column type', async () => {
    await expect(
      crudService.createTable('p1', 'notes', [
        { name: 'id', type: 'uuid', primaryKey: true },
        { name: 'body', type: 'varchar(1)); DROP TABLE users; CREATE TABLE x (a int' },
      ])
    ).rejects.toThrow('Invalid data type');
    expect(queryAsOwner).not.toHaveBeenCalled();
  });

  it('createTable writes the normalized type', async () => {
    await crudService.createTable('p1', 'notes', [{ name: 'title', type: 'VARCHAR(80)' }]);
    expect(queryAsOwner.mock.calls[0][1]).toContain('"title" varchar(80)');
  });

  it('addColumn rejects a smuggled type', async () => {
    await expect(
      crudService.addColumn('p1', 'notes', { name: 'x', type: 'text); DROP TABLE users; --' })
    ).rejects.toThrow('Invalid data type');
    expect(queryAsOwner).not.toHaveBeenCalled();
  });

  it('alterColumn rejects a smuggled type and comments in USING', async () => {
    await expect(
      crudService.alterColumn('p1', 'notes', 'x', { type: 'int); DROP TABLE users; --' })
    ).rejects.toThrow('Invalid data type');
    await expect(
      crudService.alterColumn('p1', 'notes', 'x', { type: 'integer', using: 'x::integer -- hidden' })
    ).rejects.toThrow('Invalid USING clause');
    expect(queryAsOwner).not.toHaveBeenCalled();
  });
});

describe('admin SQL editor timeout', () => {
  it('sets the timeout on the same connection as the query and resets it afterwards', async () => {
    runtimeSettings.updateDbLimits(1000, 7000);

    const result = await sqlService.executeAdminQuery('p1', 'SELECT 1 AS one');

    const statements = clientQuery.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['SET statement_timeout = 7000', 'SELECT 1 AS one LIMIT 1000', 'RESET statement_timeout']);
    // No bind parameters: Postgres rejects them in SET.
    expect(clientQuery.mock.calls[0]).toHaveLength(1);
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  it('resets the timeout even when the query fails', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) throw new Error('boom');
      return { rows: [] };
    });

    await expect(sqlService.executeAdminQuery('p1', 'SELECT broken')).rejects.toThrow('SQL error: boom');
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('RESET statement_timeout');
  });
});
