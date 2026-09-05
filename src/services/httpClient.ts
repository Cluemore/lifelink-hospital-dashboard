import { runtimeConfig } from '../config/runtime';
import type { ApiErrorPayload } from '../types';
import { tokenStore } from './tokenStore';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(message: string, options: { code?: string; status?: number; details?: Record<string, unknown>; requestId?: string } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.code = options.code ?? 'UNEXPECTED_ERROR';
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ApiErrorPayload>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return response.text();
  try { return await response.json(); } catch { return undefined; }
}

export const httpClient = {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = tokenStore.get();
    let response: Response;
    try {
      response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new ApiClientError('Unable to connect to the LifeLink backend.', { code: 'NETWORK_ERROR' });
    }

    const body = await responseBody(response);
    if (!response.ok) {
      if (response.status === 401) tokenStore.clear();
      if (isApiErrorPayload(body)) {
        throw new ApiClientError(body.message, { code: body.code, status: response.status, details: body.details, requestId: body.request_id });
      }
      throw new ApiClientError(response.status === 401 ? 'Your hospital session has expired.' : 'The LifeLink backend could not complete this request.', {
        code: response.status === 401 ? 'UNAUTHORIZED' : 'API_REQUEST_FAILED',
        status: response.status,
      });
    }
    return body as T;
  },
  get<T>(path: string) { return this.request<T>(path); },
  post<T>(path: string, body?: unknown) { return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }); },
  patch<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); },
};
