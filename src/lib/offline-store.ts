// Browser-side offline cache for vault credentials. Encrypted at rest with a
// PIN the user sets locally — that PIN never leaves the device. The server
// action returns plaintext over HTTPS; we encrypt before persisting.
//
// Algorithm: PBKDF2-SHA256 (250k iterations) → AES-256-GCM. One snapshot is
// kept per origin (overwrites on refresh).

const DB_NAME = 'bestfamilyvault-offline'
const DB_VERSION = 1
const STORE = 'snapshot'
const KEY = 'current'

const PBKDF2_ITERS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12

interface StoredSnapshot {
  saltB64: string
  ivB64: string
  ciphertextB64: string
  snapshotAt: string
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(): Promise<StoredSnapshot | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result as StoredSnapshot | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(value: StoredSnapshot): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function b64Encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SnapshotMeta {
  snapshotAt: string
  ageDays: number
}

export async function hasSnapshot(): Promise<boolean> {
  try {
    return !!(await idbGet())
  } catch {
    return false
  }
}

export async function getSnapshotMeta(): Promise<SnapshotMeta | null> {
  const s = await idbGet()
  if (!s) return null
  const ageDays = (Date.now() - new Date(s.snapshotAt).getTime()) / 86_400_000
  return { snapshotAt: s.snapshotAt, ageDays }
}

export async function saveSnapshot(pin: string, payload: unknown): Promise<void> {
  if (pin.length < 6) throw new Error('PIN must be at least 6 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(pin, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource
  )
  await idbSet({
    saltB64: b64Encode(salt),
    ivB64: b64Encode(iv),
    ciphertextB64: b64Encode(new Uint8Array(ciphertext)),
    snapshotAt: new Date().toISOString(),
  })
}

export async function loadSnapshot<T = unknown>(
  pin: string
): Promise<{ data: T; snapshotAt: string }> {
  const s = await idbGet()
  if (!s) throw new Error('No offline snapshot exists on this device.')
  const salt = b64Decode(s.saltB64)
  const iv = b64Decode(s.ivB64)
  const ciphertext = b64Decode(s.ciphertextB64)
  const key = await deriveKey(pin, salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    )
  } catch {
    throw new Error('Wrong PIN.')
  }
  const json = new TextDecoder().decode(plaintext)
  return { data: JSON.parse(json) as T, snapshotAt: s.snapshotAt }
}

export async function clearSnapshot(): Promise<void> {
  await idbDelete()
}
