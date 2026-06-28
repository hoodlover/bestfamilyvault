// Wipes the demo database and seeds it with a fake family + sample data.
//
// SAFETY: this script is destructive — it truncates every entry, note, file,
// invite, category, and user. It REFUSES to run unless DEMO_MODE=true is set
// in the environment. Run with a .env.demo file pointed at your demo Neon DB,
// NEVER your real one.
//
//   npx tsx --env-file=.env.demo scripts/seed-demo.ts

import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import {
  entries,
  notes,
  files,
  invites,
  categories,
  subcategories,
  users,
  accounts,
  sessions,
  verificationTokens,
} from '../src/lib/db/schema'
import { DEMO_PASSWORD, DEMO_USERS, CATEGORIES, ENTRIES, NOTES } from '../src/lib/demo-data'

if (process.env.DEMO_MODE !== 'true') {
  console.error(
    '\n[ABORT] DEMO_MODE is not set to "true". This script wipes the database.\n' +
      'If this is your demo DB, set DEMO_MODE=true in your .env.demo file and re-run with:\n' +
      '  npx tsx --env-file=.env.demo scripts/seed-demo.ts\n'
  )
  process.exit(1)
}

// ─── Wipe + seed ──────────────────────────────────────────────────────────────

async function main() {
  console.log('Wiping demo DB...')

  // Order matters due to FK constraints. Truncate everything in one shot.
  await db.execute(sql`TRUNCATE TABLE
    "entry",
    "note",
    "file",
    "invite",
    "subcategory",
    "category",
    "session",
    "account",
    "verificationToken",
    "user"
    RESTART IDENTITY CASCADE`)

  console.log('Seeding users...')
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  const insertedUsers = await db
    .insert(users)
    .values(
      DEMO_USERS.map((u) => ({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
      }))
    )
    .returning({ id: users.id, email: users.email })

  const userByEmail = Object.fromEntries(insertedUsers.map((u) => [u.email!, u.id]))
  const ownerId = userByEmail['demo@bestfamilyvault.app']

  console.log(`Seeded ${insertedUsers.length} users (login: any of them with password "${DEMO_PASSWORD}").`)

  console.log('Seeding categories...')
  const insertedCategories = await db
    .insert(categories)
    .values(
      CATEGORIES.map((c) => ({
        name: c.name,
        slug: c.slug,
        icon: c.icon,
        sortOrder: c.sortOrder,
        isDefault: true,
      }))
    )
    .returning({ id: categories.id, slug: categories.slug })

  const categoryBySlug = Object.fromEntries(insertedCategories.map((c) => [c.slug, c.id]))

  console.log('Seeding entries...')
  // First insert: each row gets an id back. Track by mergeKey so we can wire
  // up parentEntryId in a follow-up update for grouped credentials.
  const inserted: Array<{ id: string; mergeKey?: string }> = []
  for (const e of ENTRIES) {
    const [row] = await db
      .insert(entries)
      .values({
        categoryId: categoryBySlug[e.category],
        type: e.type,
        title: e.title,
        username: e.username ?? null,
        password: e.password ?? null,
        url: e.url ?? null,
        noteContent: e.noteContent ?? null,
        bankName: e.bankName ?? null,
        accountType: e.accountType ?? null,
        accountNumber: e.accountNumber ?? null,
        routingNumber: e.routingNumber ?? null,
        cardholderName: e.cardholderName ?? null,
        cardNumber: e.cardNumber ?? null,
        expiryDate: e.expiryDate ?? null,
        cvv: e.cvv ?? null,
        cardNetwork: e.cardNetwork ?? null,
        firstName: e.firstName ?? null,
        lastName: e.lastName ?? null,
        dateOfBirth: e.dateOfBirth ?? null,
        ssn: e.ssn ?? null,
        isFavorite: e.isFavorite ?? false,
        isPrivate: false,
        isPersonal: false,
        createdBy: ownerId,
        updatedBy: ownerId,
      })
      .returning({ id: entries.id })
    inserted.push({ id: row.id, mergeKey: e.mergeKey })
  }

  // Wire merge groups: for each unique mergeKey, the first entry becomes the
  // master and the rest get parentEntryId set to it.
  const mergeKeys = new Set(inserted.map((i) => i.mergeKey).filter(Boolean) as string[])
  for (const key of mergeKeys) {
    const group = inserted.filter((i) => i.mergeKey === key)
    if (group.length < 2) continue
    const [master, ...children] = group
    for (const child of children) {
      await db.execute(
        sql`UPDATE entry SET parent_entry_id = ${master.id} WHERE id = ${child.id}`
      )
    }
  }

  console.log(`Seeded ${inserted.length} entries (${mergeKeys.size} merged groups).`)

  console.log('Seeding notes...')
  await db.insert(notes).values(
    NOTES.map((n) => ({
      categoryId: categoryBySlug[n.category],
      title: n.title,
      content: n.content,
      isFavorite: n.isFavorite ?? false,
      isPrivate: false,
      isPersonal: false,
      createdBy: ownerId,
      updatedBy: ownerId,
    }))
  )

  console.log('\nDone.')
  console.log('Demo logins:')
  for (const u of DEMO_USERS) {
    console.log(`  ${u.email}  /  ${DEMO_PASSWORD}  (${u.role})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
