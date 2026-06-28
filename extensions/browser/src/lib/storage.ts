// Tiny typed wrappers around chrome.storage. Extensions normally pluck
// keys ad-hoc; this gives us a single import for the common ops and
// keeps key names consistent.

import { DEFAULT_VAULT_BASE_URL, STORAGE_KEYS } from './config'

// chrome.storage.sync persists across browser instances signed into
// the same Google profile. Tokens go here so signing into Chrome on
// another machine carries the pairing over.
export async function getSync<T = unknown>(key: string): Promise<T | undefined> {
  const obj = await chrome.storage.sync.get(key)
  return obj[key] as T | undefined
}

export async function setSync(key: string, value: unknown): Promise<void> {
  await chrome.storage.sync.set({ [key]: value })
}

export async function removeSync(key: string): Promise<void> {
  await chrome.storage.sync.remove(key)
}

// chrome.storage.session is tab-bound — cleared when all browser
// windows close. Used for credential caches so a phished page can't
// pull yesterday's auth state.
export async function getSession<T = unknown>(key: string): Promise<T | undefined> {
  const obj = await chrome.storage.session.get(key)
  return obj[key] as T | undefined
}

export async function setSession(key: string, value: unknown): Promise<void> {
  await chrome.storage.session.set({ [key]: value })
}

// Convenience helpers for the most-used keys.
export async function getVaultBaseUrl(): Promise<string> {
  const v = await getSync<string>(STORAGE_KEYS.vaultBaseUrl)
  return (v && v.trim()) || DEFAULT_VAULT_BASE_URL
}

export async function getToken(): Promise<string | null> {
  return (await getSync<string>(STORAGE_KEYS.bearerToken)) ?? null
}

export async function setPairing(opts: { token: string; sessionId: string; userName: string | null }): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.bearerToken]: opts.token,
    [STORAGE_KEYS.sessionId]: opts.sessionId,
    [STORAGE_KEYS.userName]: opts.userName,
  })
}

export async function clearPairing(): Promise<void> {
  await chrome.storage.sync.remove([
    STORAGE_KEYS.bearerToken,
    STORAGE_KEYS.sessionId,
    STORAGE_KEYS.userName,
  ])
}
