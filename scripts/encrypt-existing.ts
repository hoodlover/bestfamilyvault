// One-time migration: encrypt all sensitive fields on existing rows.
//
// Idempotent — already-encrypted rows are skipped via the `enc:v1:` prefix
// check inside encrypt(). Running this twice is safe.
//
// Run with:
//   tsx --env-file=.env.local scripts/encrypt-existing.ts
//
// Test on a Neon dev branch first. To do that:
//   1. Create a branch in Neon (Console → Branches → New)
//   2. Copy that branch's connection string into .env.local temporarily
//   3. Run this script
//   4. Spot-check rows in Neon SQL editor: `SELECT password FROM entry LIMIT 1`
//      should show base64 ciphertext starting with `enc:v1:`.
//   5. Switch .env.local back to main, run again.

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, notes, messages, letters } from '@/lib/db/schema'
import { encrypt, isEncrypted, ENTRY_ENCRYPTED_FIELDS } from '@/lib/crypto'

async function migrateEntries() {
  const rows = await db.select().from(entries)
  let touched = 0
  for (const e of rows) {
    const updates: Partial<typeof entries.$inferInsert> = {}
    let changed = false
    for (const f of ENTRY_ENCRYPTED_FIELDS) {
      const v = e[f]
      if (typeof v === 'string' && v !== '' && !isEncrypted(v)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(updates as any)[f] = encrypt(v)
        changed = true
      }
    }
    if (changed) {
      await db.update(entries).set(updates).where(eq(entries.id, e.id))
      touched++
    }
  }
  return { total: rows.length, touched }
}

async function migrateNotes() {
  const rows = await db.select().from(notes)
  let touched = 0
  for (const n of rows) {
    if (n.content && n.content !== '' && !isEncrypted(n.content)) {
      const ct = encrypt(n.content)
      if (ct) {
        await db.update(notes).set({ content: ct }).where(eq(notes.id, n.id))
        touched++
      }
    }
  }
  return { total: rows.length, touched }
}

async function migrateMessages() {
  const rows = await db.select().from(messages)
  let touched = 0
  for (const m of rows) {
    if (m.body && !isEncrypted(m.body)) {
      const ct = encrypt(m.body)
      if (ct) {
        await db.update(messages).set({ body: ct }).where(eq(messages.id, m.id))
        touched++
      }
    }
  }
  return { total: rows.length, touched }
}

async function migrateLetters() {
  const rows = await db.select().from(letters)
  let touched = 0
  for (const l of rows) {
    if (l.body && l.body !== '' && !isEncrypted(l.body)) {
      const ct = encrypt(l.body)
      if (ct) {
        await db.update(letters).set({ body: ct }).where(eq(letters.id, l.id))
        touched++
      }
    }
  }
  return { total: rows.length, touched }
}

async function main() {
  console.log('Starting at-rest encryption migration...')
  if (!process.env.ENCRYPTION_KEY) {
    console.error('ERROR: ENCRYPTION_KEY env var is not set. Aborting.')
    process.exit(1)
  }

  const e = await migrateEntries()
  console.log(`entries:  encrypted ${e.touched} of ${e.total}`)
  const n = await migrateNotes()
  console.log(`notes:    encrypted ${n.touched} of ${n.total}`)
  const m = await migrateMessages()
  console.log(`messages: encrypted ${m.touched} of ${m.total}`)
  const l = await migrateLetters()
  console.log(`letters:  encrypted ${l.touched} of ${l.total}`)

  console.log('\nDone. Spot-check in Neon SQL editor:')
  console.log("  SELECT password FROM entry WHERE password IS NOT NULL LIMIT 1;")
  console.log("  -- should start with 'enc:v1:'")
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
