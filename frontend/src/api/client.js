/**
 * Tiny fetch wrapper for the WanderWise API.
 *
 * - Always sends the session cookie (credentials: "include").
 * - Sends/parses JSON.
 * - Throws ApiError with a human-friendly message on non-2xx responses.
 *
 * Usage:
 *   import { api } from '../api/client';
 *   const user = await api.get('/auth/me');
 *   await api.post('/trips', { destination: 'Lisbon' });
 */

const BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // HTTP status (0 = network error)
    this.details = details; // raw error body from the server, if any
  }
}

/** Turn FastAPI's error body into one readable sentence. */
function messageFromBody(body, status) {
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  // Pydantic validation errors: [{ loc: [...], msg: '...' }, ...]
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d) => (d.msg || '').replace(/^Value error, /, ''))
      .filter(Boolean)
      .join('. ');
  }
  if (status >= 500) return 'Something went wrong on our end. Please try again.';
  return 'Request failed. Please try again.';
}

export async function request(path, { method = 'GET', body, headers, ...rest } = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...rest,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  // 204 No Content (e.g. logout)
  if (response.status === 204) return null;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(messageFromBody(data, response.status), response.status, data);
  }
  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
