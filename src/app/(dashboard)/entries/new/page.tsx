import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories, entries, users } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'

import { redirect } from 'next/navigation'
import { NewEntryForm } from '@/components/ui/new-entry-form'
import { LockEgg } from '@/components/ui/lock-egg'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function NewEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string; subcategoryId?: string; isPrivate?: string; isPersonal?: string; isRecurring?: string; type?: string }>
}) {
  const { categoryId, subcategoryId, isPrivate, isPersonal, isRecurring, type } = await searchParams
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const isSuperuser = session.user.role === 'superuser'

  const allCategories = await db.select().from(categories).orderBy(categories.sortOrder)
  const allSubs = await db.select().from(subcategories).orderBy(subcategories.sortOrder)
  const familyProfiles = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      dateOfBirth: users.dateOfBirth,
      phone: users.phone,
      address: users.address,
      ssn: users.ssn,
      driversLicense: users.driversLicense,
      passport: users.passport,
    })
    .from(users)
    .orderBy(users.name)

  // Credit-card entries the user can see — feeds the "Paid with" dropdown
  // on subscription entries. Same visibility rules as the rest of the app:
  // private cards are superuser-only; personal cards are owner-only.
  const ccRows = await db
    .select({ id: entries.id, title: entries.title, cardNetwork: entries.cardNetwork })
    .from(entries)
    .where(
      and(
        eq(entries.type, 'credit_card'),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, session.user.id)),
      ),
    )
  const creditCards = ccRows.map((c) => ({ id: c.id, label: c.title, network: c.cardNetwork }))

  // Subscriptions subcategory id, if it's been seeded — drives whether the
  // form shows the "Paid with" dropdown.
  const finance = allCategories.find((c) => c.slug === 'finance')
  const subsSub = finance ? allSubs.find((s) => s.categoryId === finance.id && s.name === 'Subscriptions') : null
  const subscriptionsSubcategoryId = subsSub?.id ?? null

  // If a subcategoryId came in but no categoryId, derive the parent category
  // so the form lands in the right tab automatically. Without this, the
  // "New subscription" link from /subscriptions saves entries against the
  // first category instead of Finance and they never show up in the list.
  const resolvedCategoryId = categoryId ??
    (subcategoryId ? allSubs.find((s) => s.id === subcategoryId)?.categoryId : undefined)

  const header = pickHeader({ type, isRecurring })

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <LockEgg src={header.icon} />
        <h1 className="text-2xl font-bold text-stone-100">{header.label}</h1>
        <HelpPopout
          title="New entry"
          sections={[
            {
              heading: 'Entry types',
              tips: [
                { title: 'Login', description: 'Username + password (encrypted) + URL. Browser extension auto-fills on the matching domain.' },
                { title: 'Bank account', description: 'Routing + account number + autopay flag. Recurring entries also appear on /subscriptions.' },
                { title: 'Credit card', description: 'Number + CVV + expiry + ZIP, plus reward / annual fee fields. Scan a card photo to auto-fill.' },
                { title: 'Identity doc', description: 'SSN / DL / passport + expiration. Auto-formats SSN and phone as you type.' },
                { title: 'Asset', description: 'Houses, cars, tools, jewelry. Set Current Value + Valued As Of so it counts toward Net Worth. Purchase Value + Date are kept for basis tracking. Bump the Current Value any time — each save logs a new appraisal snapshot in your history.' },
                { title: 'Plain note', description: 'Free-form text — when you don\'t fit any of the above.' },
              ],
            },
            {
              heading: 'AI helpers',
              tips: [
                { title: 'Photo scanner', description: 'Credit-card and identity-doc forms: scan a photo, Claude OCR fills the fields. Image attaches automatically.' },
                { title: 'Suggest category', description: 'Type a title, hit the suggest button — Claude picks the best category + subcategory.' },
              ],
            },
            {
              heading: 'Family + privacy',
              tips: [
                { title: 'Person picker', description: 'For Login/Identity types, pick the family member. Pre-fills email from that person\'s vault profile.' },
                { title: 'Personal toggle', description: 'Tick to make this only-you-see-it. Lands on /my-vault instead of the family pool.' },
                { title: 'Private (admin)', description: 'Hidden from non-superusers. Useful for adult-only items in a family vault.' },
              ],
            },
          ]}
        />
      </div>
      <p className="text-stone-400 text-sm mb-8">{header.desc}</p>

      <NewEntryForm
        categories={allCategories}
        subcategories={allSubs}
        creditCards={creditCards}
        familyProfiles={familyProfiles.map((p) => ({
          id: p.id,
          name: p.name ?? p.email ?? 'Family member',
          email: p.email,
          dateOfBirth: fmtProfileDate(p.dateOfBirth),
          phone: p.phone,
          address: p.address,
          ssn: p.ssn,
          driversLicense: p.driversLicense,
          passport: p.passport,
        }))}
        currentUserId={session.user.id}
        subscriptionsSubcategoryId={subscriptionsSubcategoryId}
        defaultCategoryId={resolvedCategoryId}
        defaultSubcategoryId={subcategoryId}
        defaultIsPrivate={isPrivate === 'true'}
        defaultIsPersonal={isPersonal === 'true'}
        defaultIsRecurring={isRecurring === 'true'}
        defaultType={type}
        isSuperuser={isSuperuser}
      />
    </div>
  )
}

// One source of truth for the per-type page header. The form has no
// type-picker buttons — the URL is the only way to land in a given mode —
// so the icon + label here is what tells the user what they're creating.
// Keep the icons in sync with `new-entry-form.tsx`'s `resolveType` mapping
// (e.g. `?type=upload` is a header-only alias for `document`).
function pickHeader({ type, isRecurring }: { type?: string; isRecurring?: string }) {
  if (isRecurring === 'true') {
    return {
      icon: '/icons/cobb/icons/system/recurring.png',
      label: 'Subscriptions',
      desc: 'Pre-flagged as recurring — fill in amount and renewal below the options checkboxes.',
    }
  }
  switch (type) {
    case 'login':
      return {
        icon: '/icons/cobb/icons/system/greenlock.png',
        label: 'Passwords',
        desc: 'Add a login to the vault.',
      }
    case 'app_login':
      return {
        icon: '/icons/cobb/icons/system/addapp.png',
        label: 'App Login',
        desc: 'Username + password for a mobile or desktop app. Same fields as a web login — the App tag lets it list separately on /apps and show with the App icon.',
      }
    case 'document':
      return {
        icon: '/icons/cobb/icons/family/family_docs.png',
        label: 'Family Docs',
        desc: 'Save the document card first, then attach the file on the next screen.',
      }
    case 'upload':
      return {
        icon: '/icons/cobb/icons/system/upload.png',
        label: 'Upload',
        desc: 'Save the card first, then attach the file on the next screen.',
      }
    case 'credit_card':
      return {
        icon: '/icons/cobb/icons/system/creditcard.png',
        label: 'Credit Cards',
        desc: 'Add a credit or debit card to the vault.',
      }
    case 'bank_account':
      return {
        icon: '/icons/cobb/icons/Finances/banks.png',
        label: 'Bank Account',
        desc: 'Add a checking or savings account.',
      }
    case 'identity':
      return {
        icon: '/icons/cobb/icons/family/dl.png',
        label: 'ID Cards',
        desc: "Driver's license, passport, ID — fields pull in from each family profile.",
      }
    case 'asset':
      return {
        icon: '/icons/cobb/icons/properties/docs-003.png',
        label: 'Cobb Family Assets',
        desc: 'Houses, cars, tools, jewelry — anything the family owns by hand. Bump the value any time and a new appraisal snapshot is logged for your net-worth history.',
      }
    case 'note':
      return {
        icon: '/icons/cobb/icons/system/notes2.png',
        label: 'Notes',
        desc: 'A free-form note for the vault.',
      }
    default:
      return {
        icon: '/icons/cobb/icons/system/misc2.png',
        label: 'Miscellaneous',
        desc: 'Anything that doesn’t fit the other types — title + content + notes.',
      }
  }
}

function fmtProfileDate(date: Date | null) {
  if (!date) return null
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${date.getUTCFullYear()}`
}
