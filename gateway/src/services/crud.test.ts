import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  config: {
    isProduction: false,
    query: { defaultRowsLimit: 100, maxRowsPerQuery: 1000 },
  },
}));

const queryAsApp = vi.fn();
const clientQuery = vi.fn();
const transactionAsApp = vi.fn();

vi.mock('../db/project.js', () => ({
  projectDb: {
    queryAsApp: (...args: unknown[]) => queryAsApp(...args),
    transactionAsApp: (...args: unknown[]) => transactionAsApp(...args),
  },
}));

import { crudService, buildInsertStatements } from './crud.js';

const PROJECT = 'p1';

beforeEach(() => {
  crudService.clearCache();
  queryAsApp.mockReset();
  clientQuery.mockReset();
  transactionAsApp.mockReset().mockImplementation(
    async (_projectId: string, fn: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
      fn({ query: clientQuery })
  );

  // First call of each test reads table metadata.
  queryAsApp.mockImplementation(async (_projectId: string, sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: ['id', 'user_id', 'status', 'note'].map((column_name) => ({
          table_name: 'jobs',
          column_name,
          data_type: 'text',
          is_nullable: 'YES',
          column_default: null,
        })),
      };
    }
    if (sql.includes('COUNT(*)')) return { rows: [{ count: '42' }], rowCount: 1 };
    if (sql.trim().startsWith('INSERT')) return { rows: [{ id: 'r1' }, { id: 'r2' }], rowCount: 2 };
    return { rows: [{ id: 'a' }], rowCount: 1 };
  });
});

function dataQueries(): string[] {
  return queryAsApp.mock.calls
    .map((call) => String(call[1]))
    .filter((sql) => !sql.includes('information_schema'));
}

describe('crudService.select', () => {
  it('does not count unless asked, keeping the response shape unchanged', async () => {
    const result = await crudService.select(PROJECT, 'jobs', { filters: [] });
    expect(result).toEqual({ rows: [{ id: 'a' }], rowCount: 1 });
    expect(dataQueries().some((sql) => sql.includes('COUNT'))).toBe(false);
  });

  it('counts rows matching the filters, ignoring limit and offset', async () => {
    const result = await crudService.select(PROJECT, 'jobs', {
      filters: [{ column: 'user_id', operator: 'eq', value: 'u1' }],
      limit: 5,
      offset: 10,
      count: true,
    });

    expect(result.count).toBe(42);
    expect(result.rows).toEqual([{ id: 'a' }]);
    const countCall = queryAsApp.mock.calls.find((call) => String(call[1]).includes('COUNT(*)'))!;
    expect(countCall[1]).toMatch(/WHERE "user_id" = \$1/);
    expect(countCall[1]).not.toMatch(/LIMIT|OFFSET/);
    expect(countCall[2]).toEqual(['u1']);
  });

  it('with countOnly fetches no rows', async () => {
    const result = await crudService.select(PROJECT, 'jobs', { count: true, countOnly: true });
    expect(result).toEqual({ rows: [], rowCount: 0, count: 42 });
    expect(dataQueries()).toHaveLength(1);
  });

  it('still validates filter columns before counting', async () => {
    await expect(
      crudService.select(PROJECT, 'jobs', {
        filters: [{ column: 'secret', operator: 'eq', value: 'x' }],
        count: true,
      })
    ).rejects.toThrow('Invalid filter column');
    expect(dataQueries()).toHaveLength(0);
  });
});

describe('crudService.insert', () => {
  it('inserts all rows with one statement', async () => {
    const result = await crudService.insert(
      PROJECT,
      'jobs',
      [
        { user_id: 'u1', status: 'pending' },
        { user_id: 'u2', status: 'pending' },
      ],
      true
    );

    expect(result).toEqual([{ id: 'r1' }, { id: 'r2' }]);
    const inserts = dataQueries();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain('VALUES ($1, $2), ($3, $4) RETURNING *');
    expect(transactionAsApp).not.toHaveBeenCalled();
  });

  it('returns no rows without returning', async () => {
    expect(await crudService.insert(PROJECT, 'jobs', [{ user_id: 'u1' }], false)).toEqual([]);
  });

  it('validates every row before writing anything', async () => {
    await expect(
      crudService.insert(PROJECT, 'jobs', [{ user_id: 'u1' }, { user_id: 'u2', hacked: true }], true)
    ).rejects.toThrow('Invalid column: hacked');
    expect(dataQueries()).toHaveLength(0);
    expect(transactionAsApp).not.toHaveBeenCalled();
  });

  it('runs several chunks in one transaction', async () => {
    clientQuery.mockResolvedValue({ rows: [{ id: 'x' }] });
    const rows = Array.from({ length: 30_001 }, (_, i) => ({ user_id: `u${i}` }));

    const result = await crudService.insert(PROJECT, 'jobs', rows, true);

    expect(transactionAsApp).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
});

describe('buildInsertStatements', () => {
  it('uses DEFAULT for columns missing from a row', () => {
    const [statement] = buildInsertStatements(
      'jobs',
      [{ user_id: 'u1', status: 'pending' }, { user_id: 'u2' }],
      ['user_id', 'status'],
      false
    );
    expect(statement.sql).toBe('INSERT INTO "jobs" ("user_id", "status") VALUES ($1, $2), ($3, DEFAULT)');
    expect(statement.values).toEqual(['u1', 'pending', 'u2']);
  });

  it('keeps explicit nulls as values', () => {
    const [statement] = buildInsertStatements('jobs', [{ note: null }], ['note'], false);
    expect(statement.sql).toContain('VALUES ($1)');
    expect(statement.values).toEqual([null]);
  });

  it('splits rows so no statement exceeds the parameter budget', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: i, b: i }));
    const statements = buildInsertStatements('t', rows, ['a', 'b'], true, 4);

    expect(statements).toHaveLength(3);
    expect(statements.every((s) => s.values.length <= 4)).toBe(true);
    expect(statements.flatMap((s) => s.values)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    // Placeholders restart in every statement.
    expect(statements[1].sql).toContain('VALUES ($1, $2), ($3, $4) RETURNING *');
  });

  it('writes rows without columns as DEFAULT VALUES', () => {
    expect(buildInsertStatements('t', [{}, {}], [], false)).toEqual([
      { sql: 'INSERT INTO "t" DEFAULT VALUES', values: [] },
      { sql: 'INSERT INTO "t" DEFAULT VALUES', values: [] },
    ]);
  });
});
