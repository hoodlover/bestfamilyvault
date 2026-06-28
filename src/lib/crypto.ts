// At-rest encryption for sensitive vault fields.
//
// Algorithm: AES-256-GCM. Key sourced from ENCRYPTION_KEY env var (base64
// 32-byte). Encrypted values are stored as `enc:v1:<base64(iv|tag|ciphertext)>`
// — the prefix lets us distinguish encrypted from legacy plaintext during the
// migration window, and lets a future v2 format coexist with v1.
//
// Threat model: protects against DB compromise, leaked DATABASE_URL, Neon
// snapshot exfiltration, and accidental backups. Does NOT protect against a
// compromised running server (which has both the DB and the key).

import crypto from 'node:crypto'

const ALG = 'aes-256-gcm'
const IV_LEN = 12 // GCM standard
const TAG_LEN = 16 // GCM auth tag
const ENC_PREFIX = 'enc:v1:'

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const b64 = process.env.ENCRYPTION_KEY
  if (!b64) {
    throw new Error(
      'ENCRYPTION_KEY env var is not set. Generate one with `node -e ' +
        '"console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"` ' +
        'and put it in .env.local AND Vercel env.'
    )
  }
  const buf = Buffer.from(b64, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes; got ${buf.length}. Regenerate it.`
    )
  }
  cachedKey = buf
  return buf
}

/** True if the value is already wrapped in our envelope. */
export function isEncrypted(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

/**
 * Encrypt a string. Returns null for null/undefined/empty input (we don't
 * write a ciphertext for empty fields — saves bytes and simplifies "is this
 * field set?" checks elsewhere).
 *
 * Idempotent: calling encrypt() on an already-encrypted value returns it
 * unchanged. This makes the migration script and the per-write call sites
 * safe to run multiple times.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null
  if (isEncrypted(plaintext)) return plaintext

  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALG, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/**
 * Decrypt a value. Returns null for null/undefined/empty. Plaintext that
 * doesn't carry our envelope prefix is returned unchanged (legacy rows that
 * haven't been migrated yet).
 *
 * Throws ONLY if a properly-prefixed envelope fails to authenticate — that's
 * a real key mismatch or tampering, and we want to fail loudly rather than
 * silently render garbage.
 */
export function decrypt(value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  if (!isEncrypted(value)) return value

  const b64 = value.slice(ENC_PREFIX.length)
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Encrypted payload too short — corrupted record?')
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)

  const decipher = crypto.createDecipheriv(ALG, getKey(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

// ─── Per-table field lists ────────────────────────────────────────────────────
//
// Centralising these here keeps the call sites short and prevents fields from
// silently going unencrypted because someone forgot to add them at one site.

export const ENTRY_ENCRYPTED_FIELDS = [
  'password',
  'noteContent',
  'accountNumber',
  'routingNumber',
  'cardNumber',
  'cvv',
  'ssn',
  'passport',
  'driversLicense',
  // Plaid access_token — long-lived secret that grants read access to
  // the user's bank data. Encrypted at rest with the same envelope as
  // the other secret fields; the API routes decrypt on read.
  'plaidAccessToken',
] as const

export type EntryEncryptedField = (typeof ENTRY_ENCRYPTED_FIELDS)[number]

/** Apply encrypt() to every encrypted field on an entry-shaped object. */
export function encryptEntryFields<T extends Partial<Record<EntryEncryptedField, string | null>>>(
  row: T
): T {
  const out: T = { ...row }
  for (const f of ENTRY_ENCRYPTED_FIELDS) {
    const v = out[f]
    if (typeof v === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(out as any)[f] = encrypt(v)
    }
  }
  return out
}

/** Apply decrypt() to every encrypted field on an entry-shaped object. */
export function decryptEntryFields<T extends Partial<Record<EntryEncryptedField, string | null>>>(
  row: T
): T {
  const out: T = { ...row }
  for (const f of ENTRY_ENCRYPTED_FIELDS) {
    const v = out[f]
    if (typeof v === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(out as any)[f] = decrypt(v)
    }
  }
  return out
}

/** Decrypt every entry in an array. Convenience for list pages. */
export function decryptEntries<
  T extends Partial<Record<EntryEncryptedField, string | null>>,
>(rows: T[]): T[] {
  return rows.map(decryptEntryFields)
}

// ─── Notes (content) ──────────────────────────────────────────────────────────
//
// notes.content is NOT NULL with default '' so we have a tiny wrapper that
// short-circuits empty strings and never returns null.

export function decryptNote<T extends { content: string }>(row: T): T {
  return { ...row, content: row.content === '' ? '' : (decrypt(row.content) ?? '') }
}

export function decryptNotes<T extends { content: string }>(rows: T[]): T[] {
  return rows.map(decryptNote)
}

// ─── Letters (body) ───────────────────────────────────────────────────────────

export function decryptLetter<T extends { body: string }>(row: T): T {
  return { ...row, body: row.body === '' ? '' : (decrypt(row.body) ?? '') }
}

export function decryptLetters<T extends { body: string }>(rows: T[]): T[] {
  return rows.map(decryptLetter)
}
