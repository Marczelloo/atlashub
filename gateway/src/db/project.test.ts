import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  config: {
    postgres: {
      idleTimeoutMs: 1000,
      connectionTimeoutMs: 1000,
      projectAppPoolSize: 7,
      projectOwnerPoolSize: 2,
    },
  },
}));

const getCredentials = vi.fn();
vi.mock('../services/project-db-creds.js', () => ({
  projectDbCredsService: { getCredentials: (...args: unknown[]) => getCredentials(...args) },
}));

const { createdPools, clientQuery, release, FakePool } = vi.hoisted(() => {
  const createdPools: { options: { connectionString: string; max: number } }[] = [];
  const clientQuery = vi.fn();
  const release = vi.fn();

  class FakePool {
    options: { connectionString: string; max: number };
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
    end = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    constructor(options: { connectionString: string; max: number }) {
      this.options = options;
      createdPools.push(this);
    }
  }

  return { createdPools, clientQuery, release, FakePool };
});

vi.mock('pg', () => ({ Pool: FakePool }));

import { projectDb } from './project.js';

beforeEach(async () => {
  await projectDb.closeAllPools();
  createdPools.length = 0;
  clientQuery.mockReset().mockResolvedValue({ rows: [] });
  release.mockReset();
  getCredentials.mockReset().mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { owner: 'postgres://owner', app: 'postgres://app' };
  });
});

describe('project database pools', () => {
  it('parallel first requests create the pools once', async () => {
    await Promise.all(Array.from({ length: 6 }, () => projectDb.queryAsApp('p1', 'SELECT 1')));

    expect(getCredentials).toHaveBeenCalledTimes(1);
    expect(createdPools).toHaveLength(2);
  });

  it('sizes pools from configuration', async () => {
    await projectDb.queryAsApp('p1', 'SELECT 1');
    const sizes = Object.fromEntries(createdPools.map((pool) => [pool.options.connectionString, pool.options.max]));
    expect(sizes).toEqual({ 'postgres://owner': 2, 'postgres://app': 7 });
  });

  it('a failed pool creation is retried by the next request', async () => {
    getCredentials.mockRejectedValueOnce(new Error('creds unavailable'));
    await expect(projectDb.queryAsApp('p1', 'SELECT 1')).rejects.toThrow('creds unavailable');
    await expect(projectDb.queryAsApp('p1', 'SELECT 1')).resolves.toBeDefined();
  });
});

describe('projectDb.transactionAsApp', () => {
  it('commits and releases the client', async () => {
    const result = await projectDb.transactionAsApp('p1', async (client) => {
      await client.query('INSERT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(clientQuery.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back on failure and releases the client', async () => {
    await expect(
      projectDb.transactionAsApp('p1', async (client) => {
        await client.query('INSERT 1');
        throw new Error('chunk failed');
      })
    ).rejects.toThrow('chunk failed');

    expect(clientQuery.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'INSERT 1', 'ROLLBACK']);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
