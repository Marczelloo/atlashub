import type { ParsedFilter } from '@atlashub/shared';

// Validator function type
type IdentifierValidator = (name: string, type: 'table' | 'column') => void;

// Default no-op validator (for backwards compatibility)
let validator: IdentifierValidator = () => {};

export function setValidator(fn: IdentifierValidator): void {
  validator = fn;
}

export function buildWhereClause(
  filters: ParsedFilter[],
  startParamIndex = 1
): { clause: string; values: unknown[] } {
  if (filters.length === 0) {
    return { clause: '', values: [] };
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = startParamIndex;

  for (const filter of filters) {
    validator(filter.column, 'column');
    const quotedColumn = `"${filter.column}"`;

    switch (filter.operator) {
      case 'eq':
        conditions.push(`${quotedColumn} = $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'neq':
        conditions.push(`${quotedColumn} != $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lt':
        conditions.push(`${quotedColumn} < $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lte':
        conditions.push(`${quotedColumn} <= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gt':
        conditions.push(`${quotedColumn} > $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gte':
        conditions.push(`${quotedColumn} >= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'like':
        conditions.push(`${quotedColumn} LIKE $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'ilike':
        conditions.push(`${quotedColumn} ILIKE $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'in':
        if (Array.isArray(filter.value) && filter.value.length > 0) {
          const placeholders = filter.value.map((_, i) => `$${paramIndex + i}`).join(', ');
          conditions.push(`${quotedColumn} IN (${placeholders})`);
          values.push(...filter.value);
          paramIndex += filter.value.length;
        }
        break;
    }
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export function buildOrderClause(
  order: { column: string; direction: 'asc' | 'desc' } | undefined
): string {
  if (!order) return '';
  validator(order.column, 'column');
  return `ORDER BY "${order.column}" ${order.direction.toUpperCase()}`;
}

export function buildSelectColumns(select: string[] | '*', allowedColumns: string[]): string {
  if (select === '*') {
    return '*';
  }

  // Validate and quote column names
  const validColumns = select.filter((col) => allowedColumns.includes(col));
  if (validColumns.length === 0) {
    return '*';
  }

  // Validate all valid column names through the validator
  for (const col of validColumns) {
    validator(col, 'column');
  }

  return validColumns.map((col) => `"${col}"`).join(', ');
}
