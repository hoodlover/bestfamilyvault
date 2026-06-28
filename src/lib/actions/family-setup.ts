'use server'

// Server actions that scaffold structure into the vault — Recovery Guide
// note in the Private Vault, a Legal top-level category with the standard
// estate-planning subcategories, and a Subscriptions subcategory under
// Finance. All idempotent — if the thing already exists, return its id /
// slug instead of creating a duplicate.

import { and, eq, ilike, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, notes, subcategories } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'
import { OWNER, MEMBERS } from '@/lib/family-config'
import { APP_NAME } from '@/lib/branding'

const OWNER_NAME = OWNER.name
const OWNER_NAME_UPPER = OWNER.name.toUpperCase()
const PARTNER_DISPLAY = MEMBERS[0]?.display ?? 'your partner'
const OWNER_PRIMARY_EMAIL = OWNER.emails[0] ?? 'owner@example.com'

async function requireSuperuser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'superuser') throw new Error('Forbidden')
  return session
}

// ─── Recovery Guide ───────────────────────────────────────────────────────────

const RECOVERY_TITLE = 'Vault Recovery Guide — Read This First'

const RECOVERY_TEMPLATE = `# IF YOU'RE READING THIS, ${OWNER_NAME_UPPER} IS GONE OR INCAPACITATED

This vault keeps running for about 30 days, then dies the moment the
credit card bill bounces. Take this slowly. Make a coffee. Read the
whole thing once before you do anything.

— ${OWNER_NAME}

---

## 1. WHAT THIS THING IS

The ${APP_NAME} is a custom web app I built. It runs on:

- **Vercel** — hosts the web app. Bills my credit card around $72/month.
- **Neon** — hosts the database (Postgres).
- **GitHub** — holds the source code at https://github.com/hoodlover/bestfamilyvault
- **Vercel Blob** — holds every file attachment (PDFs, photos, videos).

If any of those four go away without intervention, the vault stops working.

---

## 2. THE FIRST 24 HOURS

In order:

1. Find the **sealed envelope marked "VAULT RECOVERY"** in the safe at
   [${OWNER_NAME_UPPER}: write the safe location here — at home? safe deposit box? where?].
   It contains the credentials you need below. If you can't find it, jump
   to section 7.
2. Sign into the vault as me (or just yourself with superuser role) and
   read every note in the Private Vault. Anything important I knew is in
   there.
3. Look at the **printed PDF backup** I keep in [${OWNER_NAME_UPPER}: where? same safe?].
   That's the offline copy of every password — good for ~6 months after
   the print date.
4. Don't cancel anything yet. Wait until you've read everything.

---

## 3. CRITICAL CREDENTIALS

These are NOT written here on purpose. They live in the sealed envelope
described above. The envelope contains:

- Vercel login: ${OWNER_PRIMARY_EMAIL} — [${OWNER_NAME_UPPER}: 2FA recovery codes from
  vercel.com/account/security/2fa go here]
- Neon login: [${OWNER_NAME_UPPER}: which email? add 2FA recovery codes]
- GitHub login: ${OWNER.aliases?.[0] ?? '[your-github-username]'} — [${OWNER_NAME_UPPER}: 2FA recovery codes]
- ENCRYPTION_KEY: 32-byte base64 string. **Without this, every encrypted
  password column becomes permanently unreadable.** Treat this like the
  combination to a vault — losing it is unrecoverable.
- BLOB_READ_WRITE_TOKEN: long token. Without this, no files load.
- DATABASE_URL: postgres connection string for Neon.

---

## 4. HOW TO KEEP THE VAULT RUNNING

If the family wants to keep using this thing:

1. **Transfer Vercel billing to a family card.** vercel.com → settings →
   billing → payment method. Otherwise the next bill bounces and the
   site goes down.
2. **Add ${PARTNER_DISPLAY} (or whoever) as a Vercel team member with admin access**
   so they can deploy fixes if anything breaks.
3. **Make a backup of all env vars.** vercel.com → project → settings →
   environment variables. Copy them somewhere safe.
4. **Make a Neon backup**. neon.tech → project → backups. Trigger a
   manual one.
5. **Run the local backup script** monthly:
   \`npx tsx --env-file=.env.local scripts/backup-vault.ts\`
   (Future maintainer: this script exists in the repo. If it doesn't yet,
   ask whoever's helping to write one — instructions in scripts/.)

---

## 5. HOW TO KILL THE VAULT GRACEFULLY

If the family doesn't want to maintain it:

1. **Print everything** via \`scripts/export-passwords.ts\`. Save the PDF.
   Put it in the safe. Pass copies to whoever needs them.
2. **Download all blobs** (the actual files). Either via the script or
   manually from the Vercel dashboard. Save to an external drive.
3. **Cancel Vercel** (vercel.com → billing → cancel) — the $72/mo stops.
4. **Cancel Neon** — same idea.
5. **Archive the GitHub repo** — settings → archive — so the source
   sticks around even if no one maintains it.
6. **Delete the Vercel project** — wipes the deployment + blobs.

---

## 6. WHO TO CONTACT

Owner: fill these in. They'll need them.

- **Lawyer:** [name, phone, email, address]
- **Accountant:** [name, phone]
- **Insurance agents:** [home, auto, life, health — names + phones]
- **Financial advisor:** [name, phone, firm]
- **Doctor:** [name, practice]
- **Funeral preferences:** [funeral home, plot location, cremation vs.
  burial, what kind of service, songs at the service, no flowers please,
  etc.]
- **Pastor / spiritual:** [name, contact]
- **Employer / HR contact:** [name, phone, employer]

---

## 7. IF THE SEALED ENVELOPE IS GONE

Worst-case fallback path:

1. Email ${OWNER_NAME}'s lawyer ([lawyer email — fill in]). They have a copy of
   the recovery instructions on file as part of the will.
2. If that fails: \`${OWNER_PRIMARY_EMAIL}\` is the Vercel/Neon/GitHub
   account email. Use ${PARTNER_DISPLAY}'s identity + a notarized death certificate
   to recover those accounts via support. It's slow but possible.
3. The ENCRYPTION_KEY is the only thing that can't be recovered through
   account recovery. If that's lost, every encrypted password is
   permanently unreadable. The printed PDF backup (section 2 step 3) is
   the only fallback. **Re-print it every 6 months.**

---

## 8. WHAT TO TELL THE KIDS

[${OWNER_NAME_UPPER}: write whatever's appropriate here — about the letters they have
waiting, about the vault, about anything you want them to know about
the technical side or otherwise. The Family Letters page handles the
emotional letters; this section is for the practical "here's what to do
about all the stuff" message.]

---

## 9. THINGS I FORGOT TO MENTION

[${OWNER_NAME_UPPER}: free-form area for anything else. Subscription gotchas, the
weird thing about that one bank account, the password to the safe,
your password manager you used before this vault existed, etc.]

---

*Last updated: [${OWNER_NAME_UPPER}: write the date you last edited this so ${PARTNER_DISPLAY}
knows how stale it is]*
`

export async function generateRecoveryGuide(): Promise<{ noteId: string; existed: boolean } | { error: string }> {
  const session = await requireSuperuser()

  // Check for an existing recovery guide before creating a new one. Match
  // by exact title in the Private Vault.
  const existing = await db
    .select()
    .from(notes)
    .where(and(eq(notes.title, RECOVERY_TITLE), eq(notes.isPrivate, true)))
    .then((r) => r[0])
  if (existing) {
    return { noteId: existing.id, existed: true }
  }

  const encrypted = encrypt(RECOVERY_TEMPLATE) ?? ''
  const [created] = await db.insert(notes).values({
    title: RECOVERY_TITLE,
    content: encrypted,
    isPrivate: true,
    isPersonal: false,
    isFavorite: true,  // pin to top of /vault
    createdBy: session.user.id,
    updatedBy: session.user.id,
  }).returning()

  revalidatePath('/vault')
  return { noteId: created.id, existed: false }
}

// ─── Legal category seed ──────────────────────────────────────────────────────

const LEGAL_SLUG = 'legal'
const LEGAL_NAME = 'Legal'
const LEGAL_SUBCATEGORIES: { name: string; slug: string }[] = [
  { name: 'Wills',                slug: 'legal-wills' },
  { name: 'Healthcare Directives', slug: 'legal-healthcare' },
  { name: 'Powers of Attorney',   slug: 'legal-poa' },
  { name: 'Beneficiary Forms',    slug: 'legal-beneficiary' },
  { name: 'Trusts',               slug: 'legal-trusts' },
  { name: 'Estate Planning',      slug: 'legal-estate' },
  { name: 'Other Legal',          slug: 'legal-other' },
]

export async function seedLegalCategory(): Promise<{ created: number; existed: number; categorySlug: string } | { error: string }> {
  await requireSuperuser()

  // Find or create the top-level Legal category.
  let cat = await db.select().from(categories).where(eq(categories.slug, LEGAL_SLUG)).then((r) => r[0])
  if (!cat) {
    const all = await db.select({ sortOrder: categories.sortOrder }).from(categories)
    const maxSort = all.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    const [created] = await db.insert(categories).values({
      name: LEGAL_NAME,
      slug: LEGAL_SLUG,
      icon: '/icons/cobb/icons/legal.png',
      description:
        'Wills, healthcare directives, powers of attorney, and other estate-planning ' +
        'documents. Always include a "signed on" date in the entry notes — stale ' +
        'wills cause real legal misery.',
      sortOrder: maxSort + 10,
    }).returning()
    cat = created
  }

  // Find or create each subcategory.
  const existingSubs = await db.select().from(subcategories).where(eq(subcategories.categoryId, cat.id))
  const existingSlugs = new Set(existingSubs.map((s) => s.slug))

  let created = 0
  let existed = 0
  for (let i = 0; i < LEGAL_SUBCATEGORIES.length; i++) {
    const def = LEGAL_SUBCATEGORIES[i]
    if (existingSlugs.has(def.slug)) { existed++; continue }
    await db.insert(subcategories).values({
      categoryId: cat.id,
      name: def.name,
      slug: def.slug,
      sortOrder: i * 10,
    })
    created++
  }

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { created, existed, categorySlug: cat.slug }
}

// ─── Subscriptions subcategory seed ──────────────────────────────────────────

const SUBSCRIPTIONS_SLUG = 'subscriptions'
const SUBSCRIPTIONS_NAME = 'Subscriptions'
const FINANCE_SLUG = 'finance'

export async function ensureSubscriptionsSubcategory(): Promise<{ subId: string; financeId: string } | { error: string }> {
  // No superuser-only check here — any authenticated user can land on
  // /subscriptions and trigger this. Creating a subcategory is admin-y but
  // a one-time seed and harmless.
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }

  const finance = await db.select().from(categories).where(eq(categories.slug, FINANCE_SLUG)).then((r) => r[0])
  if (!finance) return { error: 'Finance category not found.' }

  const existing = await db.select().from(subcategories)
    .where(and(eq(subcategories.categoryId, finance.id), eq(subcategories.slug, SUBSCRIPTIONS_SLUG)))
    .then((r) => r[0])
  if (existing) return { subId: existing.id, financeId: finance.id }

  // Only superusers create new subcategories. Members get the read-only
  // /subscriptions view that filters on the existing subcategory if one
  // already exists, or shows an empty state if not.
  if (session.user.role !== 'superuser') return { error: 'Subcategory not yet seeded.' }

  const allSubs = await db.select({ sortOrder: subcategories.sortOrder })
    .from(subcategories).where(eq(subcategories.categoryId, finance.id))
  const maxSort = allSubs.reduce((m, s) => Math.max(m, s.sortOrder), 0)

  const [created] = await db.insert(subcategories).values({
    categoryId: finance.id,
    name: SUBSCRIPTIONS_NAME,
    slug: SUBSCRIPTIONS_SLUG,
    description:
      'Recurring auto-pay charges. When a card gets compromised, this is the list ' +
      'of "what is going to fail." Add the renewal date and cancellation URL in ' +
      'the entry notes.',
    sortOrder: maxSort + 10,
  }).returning()

  revalidatePath('/admin')
  return { subId: created.id, financeId: finance.id }
}

// ─── Cobb Family receipts subcategory ────────────────────────────────────────
// Personal/household receipts need a home that isn't one of the LLC buckets
// (PTC, PoG, H&L Havens, CFS LLC). The script add-cobb-family-receipts.ts
// creates this subcategory, but it only runs when Lance fires it manually
// with --apply. This action does the same insert idempotently every time
// the /receipts/new page loads — Lance reported that the option wasn't
// showing up in the upload classifier, which means the script never made
// it to prod. Auto-seeding closes that gap permanently.

const RECEIPTS_SLUG = 'receipts'
const COBB_FAMILY_SUB_SLUG = 'cobb-family'
const COBB_FAMILY_SUB_NAME = 'Cobb Family'

export async function ensureCobbFamilyReceiptsSub(): Promise<{ subId: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }

  const receipts = await db.select({ id: categories.id })
    .from(categories).where(eq(categories.slug, RECEIPTS_SLUG)).then((r) => r[0])
  if (!receipts) return { error: 'Receipts category not seeded yet — run seed-receipts-llcs.ts.' }

  const existing = await db.select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, receipts.id), eq(subcategories.slug, COBB_FAMILY_SUB_SLUG)))
    .then((r) => r[0])
  if (existing) return { subId: existing.id }

  // Only superusers create new subcategories — same gate as the
  // subscriptions sub above so a curious family member browsing
  // /receipts/new doesn't seed half-baked data.
  if (session.user.role !== 'superuser') return { error: 'Subcategory not yet seeded.' }

  const allSubs = await db.select({ sortOrder: subcategories.sortOrder })
    .from(subcategories).where(eq(subcategories.categoryId, receipts.id))
  const maxSort = allSubs.reduce((m, s) => Math.max(m, s.sortOrder), 0)

  const [created] = await db.insert(subcategories).values({
    categoryId: receipts.id,
    name: COBB_FAMILY_SUB_NAME,
    slug: COBB_FAMILY_SUB_SLUG,
    description: 'Personal / household receipts — not a business expense.',
    sortOrder: maxSort + 10,
  }).returning({ id: subcategories.id })

  revalidatePath('/receipts/new')
  revalidatePath('/receipts')
  return { subId: created.id }
}
