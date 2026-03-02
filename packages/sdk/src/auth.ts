/**
 * @atlashub/sdk - Auth Client
 * Authentication and user management
 */

import type {
  ApiResponse,
  Session,
  SignInCredentials,
  SignUpCredentials,
  User,
} from './types.js';

// ============================================================
// Auth Client
// ============================================================

export class AuthClient {
  private _baseUrl: string;
  private _headers: Record<string, string>;
  private _fetch: typeof fetch;
  private _timeout: number;
  private _session: Session | null = null;
  private _onAuthStateChangeListeners: Array<(event: AuthChangeEvent, session: Session | null) => void> = [];

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

    // Try to restore session from storage (browser only)
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      this._restoreSession();
    }
  }

  /**
   * Sign in with email and password
   * @example
   * const { data, error } = await client.auth.signIn({
   *   email: 'user@example.com',
   *   password: 'password123'
   * })
   */
  async signIn(credentials: SignInCredentials): Promise<ApiResponse<Session>> {
    try {
      const response = await this._request<{ token: string; user: User }>(
        'POST',
        '/auth/login',
        {
          email: credentials.email,
          password: credentials.password,
        }
      );

      if (response.data) {
        this._session = {
          accessToken: response.data.token,
          user: response.data.user,
        };

        this._persistSession();
        this._notifyListeners('SIGNED_IN', this._session);

        return { data: this._session };
      }

      return response as unknown as ApiResponse<Session>;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Sign up a new user
   * @example
   * const { data, error } = await client.auth.signUp({
   *   email: 'newuser@example.com',
   *   password: 'password123'
   * })
   */
  async signUp(credentials: SignUpCredentials): Promise<ApiResponse<Session>> {
    try {
      const response = await this._request<{ token: string; user: User }>(
        'POST',
        '/auth/register',
        {
          email: credentials.email,
          password: credentials.password,
          inviteKey: credentials.inviteKey,
        }
      );

      if (response.data) {
        this._session = {
          accessToken: response.data.token,
          user: response.data.user,
        };

        this._persistSession();
        this._notifyListeners('SIGNED_IN', this._session);

        return { data: this._session };
      }

      return response as unknown as ApiResponse<Session>;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Sign out the current user
   * @example
   * const { error } = await client.auth.signOut()
   */
  async signOut(): Promise<ApiResponse<void>> {
    try {
      // Call logout endpoint if available
      await this._request<void>('POST', '/auth/logout');

      // Clear local session
      this._session = null;
      this._clearSession();
      this._notifyListeners('SIGNED_OUT', null);

      return { data: undefined };
    } catch {
      // Clear session even if request fails
      this._session = null;
      this._clearSession();
      this._notifyListeners('SIGNED_OUT', null);

      return { data: undefined };
    }
  }

  /**
   * Get the current session
   * @example
   * const session = await client.auth.getSession()
   * if (session) {
   *   console.log('User:', session.user.email)
   * }
   */
  async getSession(): Promise<Session | null> {
    // If we have a cached session, verify it's still valid
    if (this._session) {
      try {
        await this.getUser();
        return this._session;
      } catch {
        this._session = null;
        this._clearSession();
        return null;
      }
    }
    return null;
  }

  /**
   * Get the current user
   * @example
   * const { data: user, error } = await client.auth.getUser()
   */
  async getUser(): Promise<ApiResponse<User>> {
    return this._request<User>('GET', '/auth/me');
  }

  /**
   * Update user profile
   * @example
   * const { data, error } = await client.auth.updateUser({
   *   email: 'newemail@example.com'
   * })
   */
  async updateUser(attributes: { email?: string; password?: string }): Promise<ApiResponse<User>> {
    const response = await this._request<User>('PATCH', '/auth/me', attributes);

    if (response.data && this._session) {
      this._session = {
        ...this._session,
        user: response.data,
      };
      this._persistSession();
      this._notifyListeners('USER_UPDATED', this._session);
    }

    return response;
  }

  /**
   * Check if there is a logged in user
   * @example
   * if (client.auth.isAuthenticated()) {
   *   // User is logged in
   * }
   */
  isAuthenticated(): boolean {
    return this._session !== null;
  }

  /**
   * Get the current access token
   * @example
   * const token = client.auth.getAccessToken()
   */
  getAccessToken(): string | null {
    return this._session?.accessToken ?? null;
  }

  /**
   * Subscribe to auth state changes
   * @example
   * client.auth.onAuthStateChange((event, session) => {
   *   if (event === 'SIGNED_IN') {
   *     console.log('User signed in:', session?.user.email)
   *   }
   * })
   */
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void
  ): { unsubscribe: () => void } {
    this._onAuthStateChangeListeners.push(callback);

    return {
      unsubscribe: () => {
        const index = this._onAuthStateChangeListeners.indexOf(callback);
        if (index > -1) {
          this._onAuthStateChangeListeners.splice(index, 1);
        }
      },
    };
  }

  /**
   * Reset password for email
   * @example
   * const { error } = await client.auth.resetPassword('user@example.com')
   */
  async resetPassword(email: string): Promise<ApiResponse<void>> {
    return this._request<void>('POST', '/auth/reset-password', { email });
  }

  /**
   * Verify email with token
   * @example
   * const { error } = await client.auth.verifyEmail('token123')
   */
  async verifyEmail(token: string): Promise<ApiResponse<User>> {
    return this._request<User>('POST', '/auth/verify-email', { token });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private _notifyListeners(event: AuthChangeEvent, session: Session | null): void {
    for (const listener of this._onAuthStateChangeListeners) {
      try {
        listener(event, session);
      } catch {
        // Ignore listener errors
      }
    }
  }

  private _persistSession(): void {
    if (typeof localStorage !== 'undefined' && this._session) {
      localStorage.setItem('atlashub_session', JSON.stringify(this._session));
    }
  }

  private _restoreSession(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('atlashub_session');
        if (stored) {
          this._session = JSON.parse(stored);
        }
      } catch {
        // Ignore restore errors
      }
    }
  }

  private _clearSession(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('atlashub_session');
    }
  }

  private async _request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this._baseUrl);

    const headers: Record<string, string> = {
      ...this._headers,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    // Add auth token if available
    if (this._session?.accessToken) {
      headers['Authorization'] = `Bearer ${this._session.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const response = await this._fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 204 No Content
      if (response.status === 204) {
        return { data: undefined as T };
      }

      if (!response.ok) {
        const errorData = (await response.json()) as {
          error?: string;
          message?: string;
          statusCode?: number;
          details?: unknown;
        };
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

// ============================================================
// Types
// ============================================================

export type AuthChangeEvent =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERED'
  | 'TOKEN_REFRESHED';
