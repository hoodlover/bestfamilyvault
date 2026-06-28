// Creates the account-specific entries the inbox importer needs to match
// statements against. Each statement Claude classified has an institution
// + last-4 — but the vault only had generic login entries, so no match.
// This script populates the missing account entries under
// Finance → Checking & Saving Banks (or Credit Cards for cc accounts).

import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, categories, subcategories, users } from '@/lib/db/schema'
import { OWNER } from '@/lib/family-config'

interface NewEntry {
  title: string
  type: 'bank_account' | 'credit_card'
  bankName: string
  subcategoryName?: string
}

const TARGETS: NewEntry[] = [
  // Bank of America accounts
  { title: 'BofA Checking 0202',     type: 'bank_account', bankName: 'Bank of America' },
  { title: 'BofA Savings 0695',      type: 'bank_account', bankName: 'Bank of America' },
  { title: 'BofA Credit Card 2517',  type: 'credit_card',  bankName: 'Bank of America' },
  // Axos accounts
  { title: 'Axos Bank 0254',         type: 'bank_account', bankName: 'Axos Bank' },
  { title: 'Axos Bank 0262',         type: 'bank_account', bankName: 'Axos Bank' },
]

async function main() {
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, OWNER.emails[0]))
    .then((r) => r[0])
  if (!owner) throw new Error('Owner not found')

  const allCategories = await db.select().from(categories)
  const finance = allCategories.find((c) => c.slug === 'finance')
  if (!finance) throw new Error('Finance category not found')

  const allSubs = await db.select().from(subcategories)
  const checkingSub = allSubs.find(
    (s) => s.categoryId === finance.id && s.name.toLowerCase() === 'checking & saving banks',
  )

  let created = 0
  let skipped = 0

  for (const t of TARGETS) {
    // Idempotent: if an entry already exists with this exact title, skip.
    const existing = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.title, t.title), eq(entries.type, t.type)))
      .then((r) => r[0])

    if (existing) {
      console.log(`  ↺ skip — already exists: ${t.title}`)
      skipped++
      continue
    }

    await db.insert(entries).values({
      categoryId: finance.id,
      subcategoryId: t.type === 'bank_account' ? checkingSub?.id ?? null : null,
      type: t.type,
      title: t.title,
      bankName: t.bankName,
      isFavorite: false,
      isPrivate: false,
      isPersonal: false,
      isRecurring: false,
      createdBy: owner.id,
      updatedBy: owner.id,
    })
    console.log(`  + created: ${t.title} (${t.type})`)
    created++
  }

  console.log(`\nDone: ${created} new entries, ${skipped} already existed.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
