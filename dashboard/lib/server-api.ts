const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3001';

interface ServerFetchOptions extends RequestInit {
  requireAuth?: boolean;
}

/**
 * Server-side API helper for Next.js Server Components and API routes.
 * Uses DEV_ADMIN_TOKEN (not exposed to client) for development convenience.
 */
export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Add dev admin token ONLY on server side (never exposed to browser)
  // This token is NOT prefixed with NEXT_PUBLIC_ so it's only available in Node.js
  const devToken = process.env.DEV_ADMIN_TOKEN;
  if (devToken) {
    headers['x-dev-admin-token'] = devToken;
  }

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Export typed API methods for server components
export const serverApi = {
  async getProject(id: string) {
    return serverFetch<{ data: { id: string; name: string; description: string | null } }>(
      `/admin/projects/${id}`
    );
  },

  async listProjects() {
    return serverFetch<{ data: Array<{ id: string; name: string }> }>('/admin/projects');
  },
};
