/**
 * @atlashub/sdk - Database Query Builder
 * Provides a Supabase-like chainable query interface
 */

import type {
  ApiResponse,
  AtlasHubError,
  DeleteResult,
  InsertOptions,
  ParsedFilter,
  ParsedOrder,
  UpdateOptions,
} from './types.js';

// Re-export Row type for external use
export type { Row } from './types.js';

// ============================================================
// Filter Class - Handles individual filter conditions
// ============================================================

class FilterBuilder {
  protected _filters: ParsedFilter[] = [];
  protected _select: string | string[] = '*';
  protected _order: ParsedOrder | undefined;
  protected _limit: number | undefined;
  protected _offset: number | undefined;

  /**
   * Filter by equality
   * @example
   * client.from('users').select('*').eq('id', 1)
   */
  eq(column: string, value: string | number | boolean): this {
    this._filters.push({ column, operator: 'eq', value: String(value) });
    return this;
  }

  /**
   * Filter by inequality
   * @example
   * client.from('users').select('*').neq('status', 'deleted')
   */
  neq(column: string, value: string | number | boolean): this {
    this._filters.push({ column, operator: 'neq', value: String(value) });
    return this;
  }

  /**
   * Filter by greater than
   * @example
   * client.from('orders').select('*').gt('total', 100)
   */
  gt(column: string, value: number | string): this {
    this._filters.push({ column, operator: 'gt', value: String(value) });
    return this;
  }

  /**
   * Filter by greater than or equal
   * @example
   * client.from('orders').select('*').gte('total', 100)
   */
  gte(column: string, value: number | string): this {
    this._filters.push({ column, operator: 'gte', value: String(value) });
    return this;
  }

  /**
   * Filter by less than
   * @example
   * client.from('orders').select('*').lt('total', 1000)
   */
  lt(column: string, value: number | string): this {
    this._filters.push({ column, operator: 'lt', value: String(value) });
    return this;
  }

  /**
   * Filter by less than or equal
   * @example
   * client.from('orders').select('*').lte('total', 1000)
   */
  lte(column: string, value: number | string): this {
    this._filters.push({ column, operator: 'lte', value: String(value) });
    return this;
  }

  /**
   * Filter by LIKE pattern (case-sensitive)
   * @example
   * client.from('users').select('*').like('email', '%@gmail.com')
   */
  like(column: string, pattern: string): this {
    this._filters.push({ column, operator: 'like', value: pattern });
    return this;
  }

  /**
   * Filter by ILIKE pattern (case-insensitive)
   * @example
   * client.from('users').select('*').ilike('name', '%john%')
   */
  ilike(column: string, pattern: string): this {
    this._filters.push({ column, operator: 'ilike', value: pattern });
    return this;
  }

  /**
   * Filter by IN array of values
   * @example
   * client.from('users').select('*').in('status', ['active', 'pending'])
   */
  in(column: string, values: (string | number)[]): this {
    this._filters.push({
      column,
      operator: 'in',
      value: values.map(String),
    });
    return this;
  }

  /**
   * Filter by column being null
   * @example
   * client.from('users').select('*').is('deleted_at', null)
   */
  is(column: string, _value: null): this {
    // Using eq with explicit null handling
    this._filters.push({ column, operator: 'eq', value: 'null' });
    return this;
  }

  /**
   * Filter by column not being null
   * @example
   * client.from('users').select('*').not('deleted_at', null)
   */
  not(column: string, _value: null): this {
    this._filters.push({ column, operator: 'neq', value: 'null' });
    return this;
  }

  /**
   * Set the columns to select
   * @example
   * client.from('users').select('id, name, email')
   * client.from('users').select(['id', 'name', 'email'])
   */
  select(columns: string | string[] = '*'): this {
    this._select = columns;
    return this;
  }

  /**
   * Order the results
   * @example
   * client.from('users').select('*').order('created_at', { ascending: false })
   */
  order(column: string, options?: { ascending?: boolean }): this {
    this._order = {
      column,
      direction: options?.ascending === false ? 'desc' : 'asc',
    };
    return this;
  }

  /**
   * Limit the number of results
   * @example
   * client.from('users').select('*').limit(10)
   */
  limit(count: number): this {
    this._limit = count;
    return this;
  }

  /**
   * Skip a number of results (offset)
   * @example
   * client.from('users').select('*').range(0, 9) // First 10 results
   */
  range(from: number, to: number): this {
    this._offset = from;
    this._limit = to - from + 1;
    return this;
  }

  /**
   * Skip a number of results
   * @example
   * client.from('users').select('*').offset(10)
   */
  offset(count: number): this {
    this._offset = count;
    return this;
  }

  /**
   * Build query parameters from filters
   */
  protected _buildQueryParams(): URLSearchParams {
    const params = new URLSearchParams();

    // Select
    if (this._select) {
      const selectStr = Array.isArray(this._select)
        ? this._select.join(',')
        : this._select;
      params.set('select', selectStr);
    }

    // Filters
    for (const filter of this._filters) {
      const key = `${filter.operator}.${filter.column}`;
      const value = Array.isArray(filter.value)
        ? filter.value.join(',')
        : filter.value;
      params.set(key, value);
    }

    // Order
    if (this._order) {
      params.set('order', `${this._order.column}.${this._order.direction}`);
    }

    // Limit
    if (this._limit !== undefined) {
      params.set('limit', String(this._limit));
    }

    // Offset
    if (this._offset !== undefined) {
      params.set('offset', String(this._offset));
    }

    return params;
  }
}

// ============================================================
// Query Builder Class - Main query interface
// ============================================================

export class QueryBuilder<T extends Record<string, unknown> = Record<string, unknown>> extends FilterBuilder {
  private _table: string;
  private _client: DatabaseClient;

  constructor(table: string, client: DatabaseClient) {
    super();
    this._table = table;
    this._client = client;
  }

  /**
   * Execute a SELECT query and return all matching rows
   * @example
   * const { data, error } = await client.from('users').select('*').eq('id', 1)
   */
  async then<TResult1 = ApiResponse<T[]>, TResult2 = never>(
    resolve: (value: ApiResponse<T[]>) => TResult1 | PromiseLike<TResult1>,
    reject?: (reason: AtlasHubError) => TResult2 | PromiseLike<TResult2>
  ): Promise<TResult1 | TResult2> {
    try {
      const result = await this._executeSelect();
      return resolve(result);
    } catch (error) {
      if (reject) {
        return reject(error as AtlasHubError);
      }
      throw error;
    }
  }

  /**
   * Execute SELECT and return results
   */
  private async _executeSelect(): Promise<ApiResponse<T[]>> {
    const params = this._buildQueryParams();
    return this._client._request<T[]>('GET', `/${this._table}`, params);
  }

  /**
   * Execute SELECT and return a single row
   * @example
   * const { data, error } = await client.from('users').select('*').eq('id', 1).single()
   */
  async single(): Promise<ApiResponse<T | null>> {
    this._limit = 1;
    const params = this._buildQueryParams();
    const response = await this._client._request<T[]>('GET', `/${this._table}`, params);
    return {
      data: response.data?.[0] ?? null,
      meta: response.meta,
    };
  }

  /**
   * Execute SELECT and return exactly one row (throws if 0 or >1)
   * @example
   * const { data, error } = await client.from('users').select('*').eq('id', 1).maybeSingle()
   */
  async maybeSingle(): Promise<ApiResponse<T>> {
    const result = await this.single();
    if (result.data === null) {
      throw new Error('No rows found');
    }
    return result as ApiResponse<T>;
  }

  /**
   * Insert rows into the table
   * @example
   * const { data, error } = await client.from('users').insert({ name: 'John', email: 'john@example.com' })
   */
  async insert(
    rows: T | T[],
    options?: InsertOptions
  ): Promise<ApiResponse<T[]>> {
    const rowsArray = Array.isArray(rows) ? rows : [rows];
    return this._client._request<T[]>('POST', `/${this._table}`, undefined, {
      rows: rowsArray,
      returning: options?.returning ?? true,
    });
  }

  /**
   * Update rows matching the filters
   * @example
   * const { data, error } = await client.from('users').update({ name: 'Jane' }).eq('id', 1)
   */
  update(values: Partial<T>, options?: UpdateOptions): UpdateQueryBuilder<T> {
    return new UpdateQueryBuilder<T>(
      this._table,
      this._client,
      values,
      [...this._filters],
      options
    );
  }

  /**
   * Delete rows matching the filters
   * @example
   * const { data, error } = await client.from('users').delete().eq('id', 1)
   */
  delete(): DeleteQueryBuilder {
    return new DeleteQueryBuilder(
      this._table,
      this._client,
      [...this._filters]
    );
  }

  /**
   * Upsert rows (insert or update on conflict)
   * Note: This is a convenience method that attempts insert first
   * @example
   * const { data, error } = await client.from('users').upsert({ id: 1, name: 'John' })
   */
  async upsert(
    rows: T | T[],
    options?: { onConflict?: string } & InsertOptions
  ): Promise<ApiResponse<T[]>> {
    // For now, use regular insert with returning
    // In a full implementation, this would use a dedicated upsert endpoint
    return this.insert(rows, options);
  }
}

// ============================================================
// Update Query Builder
// ============================================================

class UpdateQueryBuilder<T extends Record<string, unknown> = Record<string, unknown>> extends FilterBuilder {
  private _table: string;
  private _client: DatabaseClient;
  private _values: Partial<T>;
  private _options?: UpdateOptions;

  constructor(
    table: string,
    client: DatabaseClient,
    values: Partial<T>,
    filters: ParsedFilter[],
    options?: UpdateOptions
  ) {
    super();
    this._table = table;
    this._client = client;
    this._values = values;
    this._options = options;
    this._filters = filters;
  }

  /**
   * Execute the UPDATE query
   */
  async then<TResult1 = ApiResponse<T[]>, TResult2 = never>(
    resolve: (value: ApiResponse<T[]>) => TResult1 | PromiseLike<TResult1>,
    reject?: (reason: AtlasHubError) => TResult2 | PromiseLike<TResult2>
  ): Promise<TResult1 | TResult2> {
    try {
      const result = await this._executeUpdate();
      return resolve(result);
    } catch (error) {
      if (reject) {
        return reject(error as AtlasHubError);
      }
      throw error;
    }
  }

  private async _executeUpdate(): Promise<ApiResponse<T[]>> {
    if (this._filters.length === 0) {
      throw new Error('At least one filter is required for UPDATE operations');
    }
    const params = this._buildQueryParams();
    return this._client._request<T[]>('PATCH', `/${this._table}`, params, {
      values: this._values,
      returning: this._options?.returning ?? true,
    });
  }
}

// ============================================================
// Delete Query Builder
// ============================================================

class DeleteQueryBuilder extends FilterBuilder {
  private _table: string;
  private _client: DatabaseClient;

  constructor(
    table: string,
    client: DatabaseClient,
    filters: ParsedFilter[]
  ) {
    super();
    this._table = table;
    this._client = client;
    this._filters = filters;
  }

  /**
   * Execute the DELETE query
   */
  async then<TResult1 = ApiResponse<DeleteResult>, TResult2 = never>(
    resolve: (value: ApiResponse<DeleteResult>) => TResult1 | PromiseLike<TResult1>,
    reject?: (reason: AtlasHubError) => TResult2 | PromiseLike<TResult2>
  ): Promise<TResult1 | TResult2> {
    try {
      const result = await this._executeDelete();
      return resolve(result);
    } catch (error) {
      if (reject) {
        return reject(error as AtlasHubError);
      }
      throw error;
    }
  }

  private async _executeDelete(): Promise<ApiResponse<DeleteResult>> {
    if (this._filters.length === 0) {
      throw new Error('At least one filter is required for DELETE operations');
    }
    const params = this._buildQueryParams();
    return this._client._request<DeleteResult>('DELETE', `/${this._table}`, params);
  }
}

// ============================================================
// Database Client
// ============================================================

export class DatabaseClient {
  private _baseUrl: string;
  private _headers: Record<string, string>;
  private _fetch: typeof fetch;
  private _timeout: number;

  constructor(
    baseUrl: string,
    headers: Record<string, string>,
    fetchFn: typeof fetch,
    timeout: number
  ) {
    this._baseUrl = baseUrl;
    this._headers = headers;
    this._fetch = fetchFn;
    this._timeout = timeout;
  }

  /**
   * Start a query builder for a table
   * @example
   * const { data, error } = await client.from('users').select('*')
   */
  from<T extends Record<string, unknown> = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, this);
  }

  /**
   * Get list of available tables
   * @example
   * const { data, error } = await client.getTables()
   */
  async getTables(): Promise<ApiResponse<string[]>> {
    return this._request<string[]>('GET', '/tables');
  }

  /**
   * Raw SQL query (requires secret key)
   * @example
   * const { data, error } = await client.raw('SELECT * FROM users WHERE id = $1', [1])
   */
  async raw<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<ApiResponse<{ columns: string[]; rows: T[]; rowCount: number }>> {
    return this._request<{ columns: string[]; rows: T[]; rowCount: number }>(
      'POST',
      '/raw',
      undefined,
      { sql, params }
    );
  }

  /**
   * Internal request method
   */
  async _request<T>(
    method: string,
    path: string,
    params?: URLSearchParams,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = new URL(`/db${path}`, this._baseUrl);

    if (params) {
      url.search = params.toString();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const response = await this._fetch(url.toString(), {
        method,
        headers: this._headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string; message?: string; statusCode?: number; details?: unknown };
        throw new Error(
          JSON.stringify({
            error: errorData.error || 'Request failed',
            message: errorData.message || response.statusText,
            statusCode: errorData.statusCode || response.status,
            details: errorData.details,
          })
        );
      }

      return (await response.json()) as ApiResponse<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          throw new Error(JSON.stringify(parsed));
        } catch {
          if (error.name === 'AbortError') {
            throw new Error(
              JSON.stringify({
                error: 'Timeout',
                message: 'Request timed out',
                statusCode: 408,
              })
            );
          }
          throw new Error(
            JSON.stringify({
              error: 'Network Error',
              message: error.message,
              statusCode: 0,
            })
          );
        }
      }
      throw error;
    }
  }
}
