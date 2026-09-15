import type { SqlResult } from '@atlashub/shared';
import { projectDb } from '../db/project.js';
import { runtimeSettings } from './runtime-settings.js';
import { BadRequestError } from '../lib/errors.js';

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /\bCOPY\b.*\bPROGRAM\b/i,
  /\bDO\s*\$\$/i,
  /\bpg_sleep\s*\(/i,
  /\bCREATE\s+EXTENSION\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+ROLE\b/i,
  /\bALTER\s+SYSTEM\b/i,
];

function validateSql(sql: string): void {
  const trimmed = sql.trim();

  // Check for multiple statements (simple check - count semicolons that are not in strings)
  const statementCount = trimmed.split(';').filter((s) => s.trim().length > 0).length;
  if (statementCount > 1) {
    throw new BadRequestError('Only single statements are allowed');
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new BadRequestError('Query contains disallowed operations');
    }
  }
}

function isSelectQuery(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  return trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');
}

export const sqlService = {
  async executeAdminQuery(projectId: string, sql: string): Promise<SqlResult> {
    validateSql(sql);

    const startTime = Date.now();

    try {
      // If it's a SELECT query, add LIMIT if not present
      let finalSql = sql;
      if (isSelectQuery(sql)) {
        const hasLimit = /\bLIMIT\b/i.test(sql);
        if (!hasLimit) {
          // Remove trailing semicolon if present
          finalSql = sql.replace(/;\s*$/, '');
          // Integer from settings (safe because it's a number)
          finalSql = `${finalSql} LIMIT ${Math.floor(runtimeSettings.getSqlMaxRows())}`;
        }
      }

      // The timeout and the query must share one connection, and the timeout
      // must not outlive the query. `SET statement_timeout = $1` did neither:
      // Postgres does not accept bind parameters in SET, and a plain SET on a
      // pooled connection applies to whichever query uses it next.
      const timeoutMs = Math.max(1, Math.floor(runtimeSettings.getSqlStatementTimeoutMs()));
      const result = await projectDb.withOwnerClient(projectId, async (client) => {
        await client.query(`SET statement_timeout = ${timeoutMs}`);
        try {
          return await client.query<Record<string, unknown>>(finalSql);
        } finally {
          // The connection goes back to the pool used by DDL, imports and
          // backups, which must not inherit the editor's timeout.
          await client.query('RESET statement_timeout').catch(() => undefined);
        }
      });

      const executionTimeMs = Date.now() - startTime;

      return {
        columns: result.fields ? result.fields.map((f) => f.name) : [],
        rows: result.rows,
        rowCount: result.rowCount || 0,
        executionTimeMs,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestError(`SQL error: ${error.message}`);
      }
      throw error;
    }
  },
};
