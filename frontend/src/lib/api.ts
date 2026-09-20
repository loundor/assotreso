import type { User } from './types';

const API_BASE = '/api';
const TOKEN_KEY = 'treso_token';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function errorMessage(payload: unknown, fallback: string, status?: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error === 'string') return record.error;
  }
  if (status === 403) return 'Le téléversement a été refusé par le proxy (erreur 403). Rechargez la page puis réessayez ; si le problème persiste, vérifiez les règles d’accès ou de taille du proxy externe.';
  if (status === 413) return 'La photo est trop volumineuse pour le proxy. Elle sera optimisée automatiquement lors du prochain essai.';
  return fallback;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path.replace(/^\//, '')}`, { ...options, headers });
  } catch {
    throw new ApiError('Impossible de joindre le serveur. Vérifiez votre connexion.', 0);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = response.status === 204 ? null : isJson ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401 && path !== 'auth/login') {
      clearToken();
      window.dispatchEvent(new CustomEvent('treso:unauthorized'));
    }
    throw new ApiError(errorMessage(payload, `Erreur ${response.status}`, response.status), response.status, payload);
  }
  return payload as T;
}

async function download(path: string): Promise<Blob> {
  const headers = new Headers({ Accept: '*/*' });
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path.replace(/^\//, '')}`, { headers });
  } catch {
    throw new ApiError('Impossible de joindre le serveur. Vérifiez votre connexion.', 0);
  }
  if (!response.ok) {
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : await response.text();
    if (response.status === 401) {
      clearToken();
      window.dispatchEvent(new CustomEvent('treso:unauthorized'));
    }
    throw new ApiError(errorMessage(payload, `Erreur ${response.status}`, response.status), response.status, payload);
  }
  return response.blob();
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>('auth/login', {
    method: 'POST', body: JSON.stringify({ email, password })
  }),
  me: () => request<User>('auth/me'),
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, {
    method: 'POST', body: JSON.stringify(body)
  }),
  put: <T>(path: string, body: unknown) => request<T>(path, {
    method: 'PUT', body: JSON.stringify(body)
  }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, body: FormData) => request<T>(path, { method: 'POST', body }),
  download
};

export function listFrom<T>(payload: unknown, keys: string[] = []): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    for (const key of [...keys, 'data', 'items', 'results']) {
      if (Array.isArray(value[key])) return value[key] as T[];
    }
  }
  return [];
}
