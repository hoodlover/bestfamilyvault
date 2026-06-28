// Wraps fetch() to call the vault's /api/clients/* endpoints with
// the stored bearer token. Throws ApiError on non-2xx so callers
// can react (e.g. clear local pairing on 401).

import { getToken, getVaultBaseUrl } from './storage'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const base = await getVaultBaseUrl()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (init?.auth !== false) {
    const token = await getToken()
    if (!token) throw new ApiError(401, 'Not paired to vault.')
    headers.set('Authorization', `Bearer ${token}`)
  }
  // Hard timeout so a hung server / blocked CORS preflight surfaces as
  // an error instead of leaving the UI in "Saving…" forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  let res: globalThis.Response
  try {
    res = await fetch(base + path, {
      ...init,
      headers,
      // Bearer auth, no cookies — keeps CORS simple.
      credentials: 'omit',
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out after 12s.')
    }
    throw err
  }
  clearTimeout(timer)
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.error === 'string') message = body.error
    } catch { /* not JSON */ }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export interface PairCompleteResponse {
  token: string
  sessionId: string
  userName: string | null
}

export async function pairComplete(opts: { code: string; name: string }): Promise<PairCompleteResponse> {
  return request<PairCompleteResponse>('/api/clients/pair/complete', {
    method: 'POST',
    body: JSON.stringify({ code: opts.code, name: opts.name, platform: 'extension' }),
    auth: false,
  })
}

export interface MeResponse {
  userId: string
  userName: string | null
  userEmail: string | null
  sessionId: string
  sessionName: string
  platform: string
}

export async function getMe(): Promise<MeResponse> {
  return request<MeResponse>('/api/clients/me')
}

export interface Credential {
  id: string
  title: string
  username: string | null
  password: string | null
  url: string | null
  // Per-entry opt-in: when true AND this is the ONLY match for the
  // page's registrable domain, the content script fills on page load
  // without the user clicking the green pill. Defaults false on older
  // vault builds that don't return this field.
  autofillOnLoad?: boolean
}

export async function getCredentials(domain: string): Promise<Credential[]> {
  const url = `/api/clients/credentials?domain=${encodeURIComponent(domain)}`
  const data = await request<{ credentials: Credential[] }>(url)
  return data.credentials ?? []
}

export async function searchCredentials(q: string): Promise<Credential[]> {
  const url = `/api/clients/credentials?q=${encodeURIComponent(q)}`
  const data = await request<{ credentials: Credential[] }>(url)
  return data.credentials ?? []
}

export interface SaveCredentialBody {
  title: string
  username: string | null
  password: string
  url: string | null
}

export async function saveCredential(body: SaveCredentialBody): Promise<{ ok: true; id: string }> {
  return request<{ ok: true; id: string }>('/api/clients/credentials', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Used when the user types a new password into a site that already has a
// matching credential by domain+username. Updates just the password +
// passwordUpdatedAt — title/url/notes stay put.
export async function updateCredentialPassword(
  id: string,
  password: string,
): Promise<{ ok: true; id: string; unchanged?: boolean }> {
  return request<{ ok: true; id: string; unchanged?: boolean }>(
    `/api/clients/credentials/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    },
  )
}

export async function logUsage(opts: { entryId: string; domain: string; action: 'fill' | 'view' }): Promise<void> {
  try {
    await request('/api/clients/credentials/usage', {
      method: 'POST',
      body: JSON.stringify(opts),
    })
  } catch {
    // Best-effort. Audit logging shouldn't break the autofill flow.
  }
}
