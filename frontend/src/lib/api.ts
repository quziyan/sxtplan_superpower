const BASE = '/api'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: 'PARSE', message: 'parse failed' } })) as { error?: { code?: string; message?: string } }
    throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? 'unknown')
  }
  return res.json() as Promise<T>
}
