'use server'

// Seeds and reads the "I'm Dead, Now What?" guide — Lance's letter to
// his family plus topical notes (where the papers live, who to call,
// what to do in the first 48 hours, etc.). The whole thing rides on
// the existing notes table under a single category; that way every
// existing notes feature (edit, autosave, encryption, attachments)
// just works without a new schema.
//
// Non-function values (TOPIC_ORDER, SECTION_ORDER, types) live in
// dead-now-what-config.ts because Next.js requires "use server" files
// to export only async functions.

import { and, eq, asc } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, notes } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'
import { OWNER, MEMBERS } from '@/lib/family-config'
import {
  LETTER_TAG,
  TOPIC_ORDER,
  GUIDE_PROFILES,
  YEARLY_REVIEW_TAGS,
  YEARLY_STALE_MS,
  getGuideProfile,
  type GuideProfile,
  type GuideNoteRow,
} from '@/lib/dead-now-what-config'

interface EnsureResult {
  category: { id: string; name: string; slug: string } | null
}

/** Idempotent — creates the category if missing, and tops it up with any
 *  topics from TOPIC_ORDER whose tag isn't already present. Re-running
 *  on an existing install just adds the new topics without touching
 *  anything Lance has already edited. Non-superusers can't seed; they
 *  get the existing category back if it exists, or null if it doesn't. */
export async function ensureDeadNowWhatGuide(profile: GuideProfile = GUIDE_PROFILES[0]): Promise<EnsureResult> {
  const session = await auth()
  if (!session?.user?.id) return { category: null }

  let category = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, profile.slug))
    .then((r) => r[0])

  // Non-superusers can't create or top-up — bail with whatever exists.
  if (session.user.role !== 'superuser') {
    return category
      ? { category: { id: category.id, name: category.name, slug: category.slug } }
      : { category: null }
  }

  // Create category if missing.
  if (!category) {
    const all = await db.select({ sortOrder: categories.sortOrder }).from(categories)
    const maxSort = all.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    const [created] = await db
      .insert(categories)
      .values({
        name: profile.name,
        slug: profile.slug,
        icon: null,
        description: `Family-only guide for what to do if ${profile.ownerName} is gone.`,
        sortOrder: maxSort + 10,
        isDefault: false,
      })
      .returning()
    category = created
  }

  // Inventory existing notes by tag so we know what to skip. tags is
  // text[] in Postgres; pull it straight back.
  const existingNotes = await db
    .select({ tags: notes.tags })
    .from(notes)
    .where(eq(notes.categoryId, category.id))
  const existingTags = new Set<string>()
  for (const n of existingNotes) for (const t of n.tags ?? []) if (t) existingTags.add(t)

  // Letter — only seed if absent.
  if (!existingTags.has(LETTER_TAG)) {
    const letterContent = encrypt(LETTER_PLACEHOLDER(profile)) ?? ''
    await db.insert(notes).values({
      categoryId: category.id,
      title: `A letter from ${profile.ownerName}`,
      content: letterContent,
      tags: [LETTER_TAG],
      isPrivate: false,
      isPersonal: false,
      isFavorite: false,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
  }

  // Topic top-up — insert any missing tags.
  for (const t of TOPIC_ORDER) {
    if (existingTags.has(t.tag)) continue
    const content = encrypt(TOPIC_PLACEHOLDER(t.defaultTitle, profile)) ?? ''
    await db.insert(notes).values({
      categoryId: category.id,
      title: t.defaultTitle,
      content,
      tags: [t.tag],
      isPrivate: false,
      isPersonal: false,
      isFavorite: false,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
  }

  return { category: { id: category.id, name: category.name, slug: category.slug } }
}

/** Pulls every note in the guide category. Returns letter + topics
 *  separately, with topics ordered per TOPIC_ORDER and each one
 *  annotated with its section so the index page can group them. */
export async function loadDeadNowWhatGuide(categoryId: string): Promise<{
  letter: GuideNoteRow | null
  topics: GuideNoteRow[]
}> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      tags: notes.tags,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(eq(notes.categoryId, categoryId), eq(notes.isPersonal, false)))
    .orderBy(asc(notes.createdAt))

  const sectionByTag = new Map(TOPIC_ORDER.map((t) => [t.tag, t.section]))
  const orderIndex = new Map(TOPIC_ORDER.map((t, i) => [t.tag, i]))

  const tagged: GuideNoteRow[] = rows.map((r) => {
    const tags = (r.tags ?? []).filter(Boolean)
    const knownTag = tags.find((t) => sectionByTag.has(t))
    return {
      id: r.id,
      title: r.title,
      content: r.content,
      tags,
      updatedAt: r.updatedAt,
      section: knownTag ? sectionByTag.get(knownTag)! : 'Other',
    }
  })

  // Defensive dedup — keep one note per known topic tag (the most
  // recently updated copy wins). The seed in ensureDeadNowWhatGuide does
  // an "insert-if-missing-tag" check that's non-atomic under concurrent
  // requests, so duplicate copies of the same topic have shown up in
  // practice (same tag, same title, different IDs). When the wizard
  // iterated over both copies it would re-ask questions the user had
  // already answered on a sibling copy. Picking the latest by updatedAt
  // makes that invisible at read time; the dedupe-idnw-topics.ts script
  // cleans the underlying DB rows when desired.
  const knownTopicTags = new Set([LETTER_TAG, ...TOPIC_ORDER.map((t) => t.tag)])
  const bestByTag = new Map<string, GuideNoteRow>()
  const untagged: GuideNoteRow[] = []
  for (const n of tagged) {
    const ownTag = n.tags.find((t) => knownTopicTags.has(t))
    if (!ownTag) {
      untagged.push(n)
      continue
    }
    const incumbent = bestByTag.get(ownTag)
    if (!incumbent) {
      bestByTag.set(ownTag, n)
      continue
    }
    const incumbentMs = incumbent.updatedAt?.getTime() ?? 0
    const candidateMs = n.updatedAt?.getTime() ?? 0
    if (candidateMs > incumbentMs) bestByTag.set(ownTag, n)
  }
  const deduped = [...bestByTag.values(), ...untagged]

  const letter = deduped.find((n) => n.tags.includes(LETTER_TAG)) ?? null

  // Sort topics by configured order, falling back to creation order for
  // any note that doesn't carry a known topic tag (e.g. ones Lance adds
  // himself later — they end up in the "Other" section at the bottom).
  const topics = deduped
    .filter((n) => !n.tags.includes(LETTER_TAG))
    .sort((a, b) => {
      const ai = a.tags.map((t) => orderIndex.get(t)).find((x) => x !== undefined) ?? Number.MAX_SAFE_INTEGER
      const bi = b.tags.map((t) => orderIndex.get(t)).find((x) => x !== undefined) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })

  return { letter, topics }
}

/** Count of IDNW topics that are flagged needsYearlyReview AND whose
 *  underlying note hasn't been touched in > 12 months. Powers the
 *  dashboard nag banner ("3 answers need a yearly review"). Returns 0
 *  on any DB failure or when the IDNW category hasn't been seeded yet
 *  — better silent than a broken dashboard.
 *
 *  Scoped to the primary guide profile (LEGACY_GUIDES[0]) — sibling
 *  guides have their own owner who'd want their own dashboard for the
 *  same reason; gating each one to its keeper is a follow-up.
 *
 *  Doesn't need a user/role argument — IDNW topics are stored with
 *  isPersonal=false (family-public), so every viewer sees the same
 *  population. The dashboard call site already gates the BANNER to
 *  whoever should see it. */
export async function countStaleYearlyTopics(): Promise<number> {
  try {
    const primary = GUIDE_PROFILES[0]
    if (!primary) return 0

    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, primary.slug))
      .then((r) => r[0])
    if (!cat) return 0

    const staleSince = new Date(Date.now() - YEARLY_STALE_MS)

    // Fetch only what we need — tags for the yearly-review filter,
    // updatedAt is already implicitly bounded by the WHERE clause.
    // Content stays in the DB; we never need to decrypt for this.
    const rows = await db
      .select({ tags: notes.tags, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.categoryId, cat.id), eq(notes.isPersonal, false)))

    let count = 0
    for (const r of rows) {
      const tags = r.tags ?? []
      const isYearly = tags.some((t) => YEARLY_REVIEW_TAGS.has(t))
      if (!isYearly) continue
      // updatedAt is non-nullable on the schema but defensive-check anyway.
      if (!r.updatedAt || r.updatedAt < staleSince) count++
    }
    return count
  } catch {
    return 0
  }
}

// ─── Placeholder copy ─────────────────────────────────────────────────────────

function LETTER_PLACEHOLDER(profile: GuideProfile): string {
  const signature = profile.familyRole || profile.ownerName
  // The audience is everyone in the family except the guide owner.
  // For sibling guides (not the primary), the OWNER is in the audience too.
  const audience: string[] = []
  if (profile.key !== GUIDE_PROFILES[0]?.key) audience.push(OWNER.name)
  for (const m of MEMBERS) {
    if (m.slug === profile.key) continue
    audience.push(m.display)
  }
  const greeting = audience.join(', ')

  return `${greeting} —

If you're reading this, I'm gone. I love you. I'm sorry I'm not there
to walk you through this in person, so I built this place to do it
for me.

Take a breath. You don't have to do everything today. The "First 48
hours" card below covers the only things that actually have to happen
right away — everyone else can wait.

Everything important is in this vault. Logins, credit cards, deeds,
where to find the physical papers. The cards below break it up by
topic. Tap any card and read it. If something's missing, go look in
the matching category in the vault — search works.

I love you. I'm proud of you.

— ${signature}`
}

function TOPIC_PLACEHOLDER(topic: string, profile: GuideProfile): string {
  // Each topic starts as a stub Lance fills in. Vault routes (/categories/...,
  // /entries/..., /subscriptions, etc.) auto-link via LinkifiedText, so
  // listing them inline gives the family a tappable shortcut into the
  // live data without copy-paste gymnastics.
  const t = TOPIC_PLACEHOLDERS[topic]
  if (t) return personalizeGuideText(t, profile)
  return `${topic}\n\n__________\n`
}

function personalizeGuideText(content: string, profile: GuideProfile): string {
  // Primary guide's text is already written from the OWNER's perspective —
  // no substitutions needed. Sibling guides get OWNER name / role tokens
  // swapped out so the placeholder copy reads as if the sibling wrote it.
  if (profile.key === GUIDE_PROFILES[0]?.key) return content
  return content
    .replace(new RegExp(`\\b${OWNER.name}\\b`, 'g'), profile.ownerName)
    .replace(/\bDad\b/g, profile.familyRole)
    .replace(/\bmy Apple ID\b/g, `${profile.ownerName}'s Apple ID`)
    .replace(/\blance\.climb@gmail\.com\b/g, '__________')
}

const TOPIC_PLACEHOLDERS: Record<string, string> = {
  // ─── Start here ──────────────────────────────────────────────────────
  'First 48 hours': [
    "You don't have to do everything at once. Read the whole list first, then work top to bottom. Most of this can wait a few days.",
    '',
    'TODAY',
    '',
    '1. Confirm the death has been pronounced. If at home, call 911 or hospice; if at a hospital, the staff handles this. You\'ll get a pronouncement of death — keep the paperwork.',
    '',
    '2. Decide on a funeral home. They do most of the heavy lifting from here — they pick up the body, file the death certificate with the state, and order copies for you.',
    '',
    '3. Pick a burial vs. cremation choice if it isn\'t already documented. (My preference is on the Burial or cremation card.)',
    '',
    '4. Tell the immediate family. The people I want notified personally are on the People to call card.',
    '',
    '5. Care for the pets. Feeding / meds for the next few days are on the Pets card.',
    '',
    'WITHIN A WEEK',
    '',
    '6. Order 10–15 certified death certificates through the funeral home or vital records office. You\'ll need them for banks, insurance, the SSA, the DMV, and so on. Originals only — most agencies refuse copies.',
    '',
    '7. Locate the will. Original signed copy is more valuable than scans. See the Last will & testament card for where it lives.',
    '',
    '8. Call the executor named in the will (also listed on People to call). They formally step into the role from there.',
    '',
    '9. Notify Social Security at 1-800-772-1213. The funeral home usually does this but confirm. Stop benefits, ask about survivor benefits.',
    '',
    '10. Notify my employer\'s HR. They\'ll handle final paycheck, any group life insurance, COBRA / health-insurance continuation, and 401(k) routing. HR contact is on People to call.',
    '',
    '11. Notify life-insurance companies. Each policy is on the Life insurance card; have the death certificate ready.',
    '',
    '12. Place credit freezes with all three bureaus (Equifax, Experian, TransUnion) and one with ChexSystems. Stops fraudsters who scrape obituaries.',
    '',
    'WITHIN A FEW WEEKS',
    '',
    '13. Don\'t cancel subscriptions yet. Review /subscriptions and decide deliberately — some are essential (home security, life-insurance auto-pay, kids\' things) and some renew annually so a hasty cancellation costs more than it saves.',
    '',
    '14. Notify banks and brokerages. They\'ll re-title joint accounts and freeze solo ones until the executor presents letters of testamentary. See the Bank accounts and Brokerage cards.',
    '',
    '15. Contact the IRS / accountant about a final tax return. See the Taxes card for the accountant.',
    '',
    '16. Update beneficiaries on accounts that pass to you (your own life insurance, retirement accounts) — life events trigger reviews.',
    '',
    "You're going to make mistakes and forget things. That's fine. The vault has all the live data; the cards on this page tell you where to look. I love you.",
  ].join('\n'),

  'People to call': [
    'CATEGORIES YOU\'LL NEED TO REACH:',
    '',
    'Lawyer / estate attorney: __________',
    '   — they handle probate and the will',
    '',
    'Executor of the will: __________',
    '   — named in the will; only they have legal authority to act on the estate',
    '',
    'Accountant / CPA: __________',
    '   — for the final tax return and any business returns',
    '',
    'Financial advisor: __________',
    '   — for investment accounts, retirement, beneficiary updates',
    '',
    'Insurance agent (life + property): __________',
    '   — start the life-insurance claim, transfer property policies',
    '',
    'Primary doctor: __________',
    'Specialists: __________',
    '   — they cancel scheduled appointments and close out the medical chart',
    '',
    'Pastor / clergy / officiant: __________',
    '   — for the service',
    '',
    'My employer\'s HR contact: __________',
    '   — final paycheck, group life, 401(k), COBRA',
    '',
    'BANK / BROKERAGE / CREDIT-CARD CONTACTS:',
    '   — entries in /categories/finance have account-level numbers',
    '',
    'PEOPLE I\'D WANT TO KNOW PERSONALLY (as opposed to via Facebook / mass email):',
    '- __________',
  ].join('\n'),

  // ─── Personal / life story ───────────────────────────────────────────
  'Local agencies & services': [
    'Use this as a starting map, not an endorsement. Confirm hours, pricing, and requirements before making decisions.',
    '',
    'BASED ON:',
    '   - Home city: Cumming, Georgia',
    '   - County: Forsyth County',
    '   - If death happens somewhere else, use the county/state where the death occurred for vital records.',
    '',
    'FUNERAL HOMES / MORTUARY OPTIONS NEAR CUMMING:',
    '   - Ingram Funeral Home & Crematory',
    '     210 Ingram Ave, Cumming, GA 30040',
    '     Immediate assistance: (770) 887-2388',
    '     Website: https://www.ingramfuneralhome.com/',
    '',
    '   - McDonald & Son Funeral Home & Crematory',
    '     150 Sawnee Dr, Cumming, GA 30040',
    '     Phone: (770) 886-9899',
    '     Website: https://mcdonaldandson.com/',
    '',
    '   - South Forsyth Memorial Chapel',
    '     3545 Peachtree Parkway, Suwanee, GA 30024',
    '     Phone: (470) 375-1192',
    '     Website: https://www.dignitymemorial.com/funeral-homes/georgia/suwanee/south-forsyth-memorial-chapel/3486',
    '',
    'DEATH CERTIFICATES - FORSYTH COUNTY / GEORGIA:',
    '   - Funeral home usually files the death certificate and can order certified copies.',
    '   - Ask for 10-15 certified copies unless the estate is very simple.',
    '   - Forsyth County Probate Court / Vital Records Office (county where the death occurred)',
    '     100 West Courthouse Square, Suite 008, Cumming, GA 30040',
    '     Vital Records Customer Service: (770) 781-2140',
    '     Hours (Forsyth County site): Monday-Friday, 8:30 a.m.-4:30 p.m. (verify holidays).',
    '     Fax (Forsyth County site): (770) 886-2839',
    '     Email (Forsyth County Probate Court site): probatehearing@forsythco.com',
    '     Email (Forsyth County Birth/Death Certificates page): probatevital@forsythco.com (request forms / questions)',
    '     Website (Forsyth County): https://www.forsythco.com/Departments-Offices/Probate-Court/Birth-Death-Certificates',
    '     Website (GA DPH location listing): https://dph.georgia.gov/locations/forsyth-county-probate-court',
    '   - Georgia State Office of Vital Records (GA DPH / Georgia.gov): official state pages currently list online, mail, and in-person options, but the walk-in guidance conflicts by page.',
    '     Address: 1680 Phoenix Boulevard, Suite 100, Atlanta, GA 30349',
    '     Phone (Georgia Dept. of Vital Records / Call Center): (404) 679-4702',
    '     Georgia.gov says State Office walk-in hours are 8:00 AM-4:00 PM, Monday-Friday, with same-day service.',
    '     DPH "Request Vital Records" lists State Office lobby hours as 9:00 AM-4:00 PM, Monday-Friday.',
    '     DPH "Request a Vital Record?" says State Office hours are 8:00 AM-4:30 PM, Monday-Friday, but also says walk-in services are currently suspended until further notice.',
    '     State mail-processing estimates also differ by page: DPH "Request a Vital Record?" says 4-6 weeks, while Georgia.gov and the DPH Death Records page say 8-10 weeks.',
    '     Because the official pages conflict, verify walk-in availability and turnaround before traveling or mailing a time-sensitive request.',
    '     Request form (mail / in-person, as applicable): DPH Form 3912 (Request for Search of Death Record; revised 02/2024).',
    '       PDF: https://dph.georgia.gov/media/90036/download',
    '     Fees (statewide): $25 for a death certificate (includes 1 certified copy) + $5 for each additional copy ordered at the same time.',
    '     Online ordering: see Georgia.gov "Request Vital Records" (ROVER / third-party vendors may charge surcharges).',
    '       https://georgia.gov/request-vital-records',
    '     DPH vital-records landing page: https://dph.georgia.gov/ways-request-vital-record',
    '     DPH "Request a Vital Record?" page: https://dph.georgia.gov/how-do-i-request-vital-record',
    '',
    'IRS / FINAL TAX RETURN:',
    '   - Final individual return is usually Form 1040 or 1040-SR for income through date of death.',
    '   - IRS Topic 356 (Decedents) and IRS Publication 559 are the main references.',
    '     - Topic 356: https://www.irs.gov/taxtopics/tc356',
    '     - Pub 559: https://www.irs.gov/publications/p559',
    '     - IRS deceased person guidance: https://www.irs.gov/individuals/file-the-final-income-tax-returns-of-a-deceased-person',
    '   - If a refund is due, Form 1310 may be required unless you are a surviving spouse filing a joint return or you are court-appointed (see IRS guidance).',
    '     - Form 1310 (IRS): https://www.irs.gov/forms-pubs/about-form-1310',
    '   - On paper-filed returns, current IRS Topic 356 says to check the "Deceased" box and enter the date of death above the name line; some older IRS tips still describe writing it across the top.',
    '   - For e-filed returns, follow the tax-software instructions for deceased taxpayers.',
    '   - Also see IRS Topic 356 for how to mark the return as deceased and when Form 1310 is (or isn’t) required.',
    '   - IRS says they generally do NOT need a death certificate or other proof of death to file the final return.',
    '     - IRS Tax Tip: https://www.irs.gov/newsroom/how-to-file-a-final-tax-return-for-someone-who-has-passed-away',
    '   - If you are court-appointed, attach the court document showing the appointment to the final return.',
    '   - Form 56 (Notice Concerning Fiduciary Relationship) may be needed to notify the IRS of a fiduciary relationship.',
    '     - Form 56 (IRS): https://www.irs.gov/forms-pubs/about-form-56',
    '   - IRS individual taxpayer line: 1-800-829-1040.',
    '   - IRS Taxpayer Assistance Center appointment line: 1-844-545-5640.',
    '',
    'LOCAL CHOICES TO FILL IN:',
    'Preferred funeral home: __________',
    'Backup funeral home: __________',
    'Preferred person to make the first call: __________',
    'County where death occurred: __________',
    'Who should order extra death certificates: __________',
    'Accountant handling final return: __________',
  ].join('\n'),

  'Biographical information': [
    'Full legal name: __________',
    'Date of birth: __________',
    'Place of birth: __________',
    'Social Security #: see Identification card',
    'Legal residence: __________',
    'Religious affiliation: __________',
    'Citizenship: __________',
    '',
    'IMMEDIATE FAMILY:',
    '   — Spouse / partner: __________ (DOB __________)',
    '   — Child / dependent: __________ (DOB __________)',
    '   — Child / dependent: __________ (DOB __________)',
    '   — Child / dependent: __________ (DOB __________)',
    '   — Child / dependent: __________ (DOB __________)',
    '',
    'PARENTS:',
    '   — Father: __________',
    '   — Mother: __________',
    '',
    'SIBLINGS:',
    '   — __________',
  ].join('\n'),

  Education: [
    'High school: __________ (graduation year __________)',
    'College: __________ (degree __________, year __________)',
    'Other certs / training: __________',
    'Transcripts / diplomas: __________ (physical location)',
  ].join('\n'),

  'Employment history': [
    'Current employer: __________',
    'HR contact: __________',
    "Benefits / 401k portal: __________ — vault entry under /categories/finance",
    '',
    'Past employers (year, role):',
    '- __________',
  ].join('\n'),

  'Marriage, separation, divorce': [
    'Marriage / partnership date __________, location __________',
    'Marriage license original: __________ (physical)',
    'Scan/copy: see /categories/legal',
    'Prior marriages / divorces: __________',
  ].join('\n'),

  // ─── Identity & legal ────────────────────────────────────────────────
  'Identification (SSN, DL, passport)': [
    "You'll need these (especially the SSN and a death certificate) to close accounts, claim benefits, and stop fraud. Most agencies want originals; some accept the certified-copy death certificate plus a photocopy of ID.",
    '',
    'Social Security #: see /categories/legal (Identity entry)',
    "Driver's license # + state: see vault",
    'Passport # + expiration: see vault',
    'Birth certificate (original): __________ (physical location)',
    'Birth certificate (scan): /categories/legal',
    'Marriage license: see Marriage card',
    'Citizenship / naturalization papers if applicable: __________',
    '',
    'AFTER DEATH:',
    '   — Return the driver\'s license to the DMV (or shred). Most states automatically cancel it once the death certificate is filed.',
    '   — Cancel the passport via the State Department (Form DS-4083) so it can\'t be used for fraud.',
    '   — Notify SSA at 1-800-772-1213. Funeral home usually does this; confirm anyway.',
  ].join('\n'),

  'Last will & testament': [
    'A will tells the courts and the family who gets what. The ORIGINAL signed paper copy is what matters legally — scans and copies are for reference only.',
    '',
    'Original signed will: __________ (fireproof safe / lawyer\'s office / safe-deposit box)',
    'Scan in vault: /categories/legal',
    'Date the will was last updated: __________',
    'Lawyer who drafted it: __________',
    'Executor named: __________ (also on People to call)',
    'Witnesses if any: __________',
    '',
    'WHAT THE EXECUTOR DOES:',
    '   1. Files the will with the probate court in the county where I lived.',
    '   2. Gets letters of testamentary — the document that tells banks they have authority.',
    '   3. Inventories assets, pays debts and final taxes, distributes the rest per the will.',
    '   4. Closes the estate. Usually 6–12 months for a simple estate.',
    '',
    'If there\'s a living trust, most assets bypass probate. Check the lawyer for a trust document.',
  ].join('\n'),

  'Power of attorney — finances': [
    "A financial POA only matters BEFORE death — it lets the named agent pay bills, access accounts, and make financial decisions for me if I'm incapacitated. AT death the POA expires automatically and the executor of the will takes over.",
    '',
    'Original document: __________ (physical)',
    'Scan: /categories/legal',
    'Named agent: __________',
    'Lawyer of record: __________',
    'Date executed: __________',
    '',
    'A "durable" POA stays in effect through incapacity. A "springing" POA only kicks in once a doctor confirms incapacity. If you\'re not sure which one this is, the lawyer who drafted it can tell you in two minutes.',
  ].join('\n'),

  'Healthcare directives & living will': [
    "Two related documents that govern medical care if I can't speak for myself. Like the financial POA, these only apply BEFORE death — once I'm gone the will and executor take over.",
    '',
    'LIVING WILL:',
    '   — Says what treatments I want or don\'t want at end of life',
    '     (ventilator, feeding tube, CPR, etc.).',
    '   Original: __________ (physical)',
    '   Scan: /categories/legal',
    '',
    'HEALTHCARE POWER OF ATTORNEY (a.k.a. healthcare proxy / agent):',
    '   — Names the person who decides for me when I can\'t.',
    '   Proxy: __________',
    '   Backup proxy: __________',
    '   Original: __________ (physical)',
    '',
    'DNR / POLST / MOLST: __________',
    '   — Bedside / wallet card stating do-not-resuscitate or specific orders.',
    '',
    'Primary doctor on file: __________',
    'Hospital / system of choice: __________',
    '',
    "Hospitals will ask for these on admission — keep copies on the fridge, in the glove box, and at the lawyer's office.",
  ].join('\n'),

  // ─── Money ───────────────────────────────────────────────────────────
  'Summary of accounts': [
    'Quick map of what exists — drill into each card for details.',
    '',
    '- Banks → see Bank accounts card and /categories/finance',
    '- Brokerage → see Brokerage card',
    '- Credit cards → see Credit cards card',
    '- Retirement → see Retirement card',
    '- Recurring charges → /subscriptions',
  ].join('\n'),

  'Bank accounts': [
    'Live data: /categories/finance (filter to Banks)',
    'Each entry has the bank, account type, account #, and routing #.',
    '',
    'WHAT TO KNOW:',
    '   — Joint accounts pass automatically to the surviving owner. No probate; just bring the death certificate to retitle.',
    '   — Solo accounts get frozen until the executor presents Letters of Testamentary from the probate court.',
    '   — Accounts with a "Pay on Death" (POD) beneficiary skip probate too — the bank just pays the named person.',
    '',
    'WHERE TO LOOK FIRST:',
    '   — Direct-deposit account (paychecks, Social Security): __________',
    '   — Primary bill-pay account: __________',
    '   — Savings / emergency fund: __________',
    '',
    'Notes about access (joint vs. mine alone, paperwork on file): __________',
  ].join('\n'),

  'Brokerage & bonds': [
    'Live data: /categories/finance',
    '',
    'Brokerages and account types:',
    '   — Taxable: __________',
    '   — Roth IRA: __________',
    '   — Traditional IRA: __________',
    '',
    'WHAT MATTERS:',
    '   — Most brokerage accounts have a "Transfer on Death" (TOD) beneficiary. If they do, the assets bypass probate and go to the named person directly.',
    '   — Cost basis "steps up" to the date-of-death value on inherited taxable assets — important for taxes if you sell. Don\'t sell anything until the accountant gives you the all-clear.',
    '   — Don\'t roll an inherited IRA into your own — there are special inherited-IRA rules. Talk to the brokerage and the accountant.',
    '',
    'Bond certificates (physical paper bonds, US Savings Bonds, etc.): __________',
    'Beneficiaries on file: __________',
  ].join('\n'),

  'Credit cards & debts': [
    'Live data: /categories/finance (filter to Credit cards)',
    'Recurring auto-pays: /subscriptions',
    '',
    'WHAT TO DO:',
    '   1. Notify each card issuer using the death certificate. They close the account, stop interest accrual, and may waive recent late fees.',
    '   2. Don\'t pay anything personally. Credit-card debt is a debt of the estate. The estate pays from its assets; family members are NOT personally liable (unless they were a joint account holder, NOT just an authorized user).',
    '   3. If a card has a balance and the estate is small, the issuer may write it off rather than fight for it.',
    '   4. Cancel autopay setups by closing the card — that automatically halts the merchant charges (see the Memberships & subscriptions card for what to do next).',
    '',
    'OTHER DEBTS:',
    '   — Mortgages: see each house card. Most mortgages are "due on death" but in practice lenders work with the heirs.',
    '   — Personal loans / signature loans: __________',
    '   — Medical debt: see Healthcare card — also a debt of the estate.',
    '   — Student loans (federal): discharged at death. Private: depends on the lender; ask.',
  ].join('\n'),

  'Retirement, IRA, gov benefits': [
    'Provider, account, and beneficiary info — pulls from /categories/finance.',
    '',
    "401(k) / 403(b): __________ (provider, account #)",
    "Roth IRA: __________",
    "Traditional IRA: __________",
    "Pension(s): __________",
    "Social Security: file claim at ssa.gov or 1-800-772-1213",
    "VA / military benefits (if applicable): __________",
    "",
    'BENEFICIARIES MATTER MORE THAN THE WILL:',
    '   The named beneficiary on each retirement account inherits, regardless of what the will says. If a beneficiary isn\'t named (or is "estate"), it goes through probate.',
    '   Make sure beneficiaries are current — especially after a marriage, divorce, or major life event.',
    '',
    'INHERITED-IRA RULES:',
    '   — Spouses can roll into their own IRA or take it as an inherited IRA. Different RMD rules.',
    '   — Non-spouse heirs (kids) generally must drain it within 10 years of the original owner\'s death (post-SECURE Act).',
    '   — Talk to the accountant before withdrawing anything. Bad timing = bad taxes.',
    '',
    'GOVERNMENT BENEFITS:',
    '   — Social Security one-time death payment: $255 (yes, really). Surviving spouse / minor child can claim.',
    '   — Survivor benefits for spouse and children: depends on age and earnings record. Worth calling.',
    '   — VA: burial allowance, flag, headstone if eligible.',
  ].join('\n'),

  'Life insurance': [
    'Live data: /categories/finance — search for "life insurance"',
    '',
    'Policies (carrier, policy #, death benefit):',
    '- __________',
    '',
    'Where the policy documents live (physical): __________',
    'Scans: /categories/legal',
    'Agent / broker: __________',
    '',
    'HOW TO CLAIM:',
    '   1. Call the insurer or agent. Tell them I died.',
    '   2. They mail the beneficiary a claim form. Fill it out.',
    '   3. Send back the form + a certified death certificate.',
    '   4. Most pay within 2-4 weeks. Death-benefit money is generally tax-free.',
    '',
    'DON\'T MISS:',
    '   — Group life from my employer (HR contact on People to call).',
    '   — Mortgage / loan life-insurance riders (some loans bundle this — check each loan).',
    '   — Credit-card "death benefit" addons that can pay the card balance.',
    '   — Old policies I might have forgotten — check unclaimed.org and the state\'s unclaimed-property database after 12 months.',
  ].join('\n'),

  'Memberships & subscriptions': [
    'Live list — everything that auto-pays: /subscriptions',
    '',
    "DON'T CANCEL ANYTHING YET. Some are essential and dropping them would cost more than they're worth:",
    '   — Life insurance, long-term-care insurance: surrender = lose the death benefit',
    '   — Home security, ADT-style services: protect the empty house',
    '   — Annual subscriptions billed monthly: cancelling mid-year may forfeit the unused portion',
    '   — Kids\' subscriptions / school services: keep through the school year',
    '',
    "Walk through /subscriptions once with the executor. Cancel only the obvious ones (streaming, gym, services I clearly won't use). Leave the rest for 30 days while you sort out money.",
    '',
    'When you DO cancel, the easiest path is usually to cancel the credit card it bills (see Credit cards & debts card) — that triggers the merchant to reach out to settle, and you handle each one deliberately.',
  ].join('\n'),

  Taxes: [
    'A final tax return covers Jan 1 → date of death. The estate may owe taxes too. The accountant handles both — your job is to give them access to the records.',
    '',
    'Accountant: __________',
    'Most recent return: __________ (physical) and /categories/finance scans',
    'Past returns: __________ (recommend keeping the last 7 years)',
    'Estimated-tax payment records: __________',
    'EIN (if I had a business): __________',
    'State tax info: __________',
    '',
    'Documents the accountant will ask for:',
    '   — Last 2-3 returns',
    '   — W-2s, 1099s, K-1s for the year of death',
    '   — Brokerage and bank statements (cost-basis matters)',
    '   — Charitable donation receipts',
    '   — Real-estate sales / refinance docs',
    '',
    "If there's a refund coming, it goes to the estate, not directly to family.",
  ].join('\n'),

  // ─── Property ────────────────────────────────────────────────────────
  // House cards share a template — written below.
  'Forest house': HOUSE_TEMPLATE('Forest house'),
  'Continental house': HOUSE_TEMPLATE('Continental house'),
  'Weeks Creek house': HOUSE_TEMPLATE('Weeks Creek house'),

  'Previous residences': [
    'Useful for tax / SSA / insurance paperwork that asks about address history.',
    '',
    '- __________ (years)',
    '- __________ (years)',
  ].join('\n'),

  Vehicles: [
    'Current vehicles (year, make, model, VIN):',
    '- __________',
    '',
    'Titles (physical): __________',
    'Insurance company + agent: __________',
    'Loans / leases (lender + account #): __________',
    'Past vehicles still showing on credit / DMV: __________',
    '',
    'WHAT TO DO:',
    '   — Solely-owned vehicle goes through probate unless there\'s a TOD on the title (some states allow it).',
    '   — Jointly-titled vehicles transfer to the surviving owner; bring the title and death certificate to the DMV.',
    '   — Cancel the auto insurance once a vehicle is sold or retitled — most insurers will pro-rate the refund.',
    '   — Cancel the registration with the DMV when the vehicle leaves family hands.',
  ].join('\n'),

  'Home inventory & valuables': [
    'Useful for insurance claims if the house burns, floods, or is robbed, and for the estate inventory the executor has to assemble.',
    '',
    'Photo / video walkthrough of each house: __________',
    "   — Open every drawer, closet, and cabinet. Narrate what's where.",
    'Insurance rider items (jewelry, art, electronics, instruments, firearms): __________',
    'Appraisals on file: __________',
    'Receipts for high-value items: __________',
    '',
    'NOT IN INVENTORY but worth flagging:',
    '   — Items being held for someone else (loaned, on consignment): __________',
    '   — Items that are mine but stored elsewhere (storage unit, family member): __________',
  ].join('\n'),

  Firearms: [
    'List (make, model, serial — kept in vault for privacy):',
    '- See vault entries (typically /categories/end-of-the-world)',
    '',
    "WHERE THEY'RE STORED:",
    '   — Forest house: __________',
    '   — Continental house: __________',
    '   — Weeks Creek house: __________',
    '',
    'Safe combinations / key locations: __________ (write here only if you trust everyone with vault access)',
    '',
    'NFA / trust paperwork (suppressors, SBRs, machine guns): __________',
    '   — These have STRICT inheritance rules; transfer requires Form 5 + ATF approval. The trust holds them differently than personal ownership.',
    '',
    'STATE TRANSFER RULES:',
    '   — In most states, immediate-family inheritance of regular firearms is exempt from background-check requirements, but interstate transfer may require an FFL.',
    '   — Some states (CA, NY, etc.) require registration of inherited firearms.',
    '',
    'PLAN — who gets which: __________',
    '',
    'IF NO ONE WANTS THEM:',
    '   — Sell to an FFL dealer or consign at a gun shop. Don\'t list on Craigslist or Facebook (illegal in most states without a background check).',
  ].join('\n'),

  // ─── Health & end of life ────────────────────────────────────────────
  'Healthcare & insurance': [
    'AFTER DEATH:',
    '   — Health insurance ends as of the date of death (or end-of-month, depending on the policy).',
    '   — Family on my plan can continue under COBRA for up to 36 months. HR walks you through it.',
    '   — Outstanding medical bills become a debt of the estate — don\'t pay them out of pocket.',
    '',
    'BEFORE / DURING:',
    'Health insurance carrier + policy #: see /categories/health',
    'Group plan via employer? __________',
    'Medicare / Medicaid status: __________',
    'Primary doctor: __________',
    'Specialists: __________',
    'Pharmacy: __________',
    'Current prescriptions: see /categories/health',
    'Allergies / chronic conditions: __________',
    '',
    'HSA / FSA accounts: __________ (these have specific rules at death — ask the accountant)',
  ].join('\n'),

  'Organ / body donation': [
    'Organ donation has to be authorized BEFORE death (or by family in the first few hours after, which is a hard moment to make a decision). If I registered as a donor, the funeral home will be told.',
    '',
    'My wishes: __________ (donor / no donation / brain donation for research / whole-body donation)',
    'Registered with: __________ (state DMV organ registry, OneLegacy, etc.)',
    'Brain donation registry (if applicable, e.g. NIH NeuroBioBank): __________',
    'Documentation: __________',
    '',
    'COMMON CHOICES:',
    '   — Organ + tissue donation: standard pathway through state registry. Doesn\'t prevent funeral or open-casket.',
    '   — Brain donation for research: requires advance arrangement with a specific brain bank.',
    '   — Whole-body donation to a medical school: zero-cost option (the school handles cremation), but they have specific protocols and exclusions.',
    '   — Decline all: also a valid choice. The will / family decides.',
  ].join('\n'),

  'End of life wishes': [
    'The miscellaneous "what would I want" list. Some of this overlaps the Funeral, Burial, and Obituary cards — call those out specifically there.',
    '',
    'Spiritual / religious traditions: __________',
    'Specific scripture / readings / prayers: __________',
    'Music: __________',
    'People I want there in person: __________',
    'People to keep AWAY (it\'s OK to have a list): __________',
    '',
    'Things I DO want:',
    '   — __________',
    '',
    'Things I do NOT want:',
    '   — open casket / closed casket: __________',
    '   — flowers vs. donations to ____ in lieu',
    '   — speeches vs. quiet ceremony',
    '',
    'Anything I want said out loud: __________',
  ].join('\n'),

  'Burial or cremation': [
    'PREFERENCE: __________',
    '',
    'IF BURIAL:',
    '   — Plot already owned? __________ (cemetery, plot #, deed location)',
    '   — Casket preference: __________',
    '   — Headstone wording: __________',
    '   — Vault / liner required: most cemeteries require one',
    '',
    'IF CREMATION:',
    '   — Cremation provider: __________',
    '   — Where ashes should go: __________',
    '     (kept by family / scattered at __________ / interred / divided)',
    '   — Urn preference: __________',
    '',
    'IF OTHER (green burial, body donation, etc.): __________',
    '',
    'Pre-paid arrangements? __________ (provider, contract location)',
    "If pre-paid: family doesn't pay; the contract covers it. Bring the contract.",
  ].join('\n'),

  'Funeral & memorial': [
    'STYLE I WANT:',
    '   — Traditional funeral / memorial service / celebration of life / private only / nothing: __________',
    '   — Religious / secular / mixed: __________',
    '',
    'LOGISTICS:',
    '   — Funeral home of choice: __________',
    '   — Pre-paid arrangements? __________ (provider, contract location)',
    '   — Officiant / pastor: __________',
    '   — Venue (church, funeral home, outdoor, restaurant): __________',
    '   — Approximate budget I\'d be OK with: __________',
    '',
    'PEOPLE:',
    '   — Eulogist(s): __________',
    '   — Pallbearers (if applicable): __________',
    '   — Reading / music performers: __________',
    '',
    'TONE:',
    '   — Solemn / casual / a roast / open mic: __________',
    '',
    'Reception / wake afterward? __________ (where, who pays, food)',
    '',
    'Live-stream the service for far-away family? __________',
  ].join('\n'),

  Obituary: [
    'A short obituary covers: full name, age, place of death, life summary, family members surviving, service info, donations in lieu of flowers if any. Most papers charge by the line so be deliberate about length.',
    '',
    'WHERE TO SUBMIT:',
    '   — Local paper(s): __________',
    '   — Funeral home website (usually included)',
    '   — Hometown paper if different: __________',
    '   — Industry / profession publications: __________',
    '',
    'THINGS TO INCLUDE:',
    '   — Full legal name + nicknames',
    '   — Birth + death dates and places',
    '   — Survived by (and pre-deceased by)',
    '   — Education, military service, career highlights',
    '   — Hobbies, passions, what made me me',
    '   — Service info (date, time, location) — link to a guestbook page',
    '   — "In lieu of flowers, donations to ____"',
    '',
    'THINGS TO LEAVE OUT (security):',
    '   — Mother\'s maiden name, exact date of birth, home address — these get used for identity theft',
    '',
    'A draft I started — feel free to rewrite. This is just the bones.',
    '',
    '__________',
  ].join('\n'),

  // ─── Pets ────────────────────────────────────────────────────────────
  'Pets & livestock': [
    "Pets first — animals don't understand what happened.",
    '',
    'CURRENT ANIMALS:',
    '   — Name / breed / age: __________',
    '',
    'CARE BASICS:',
    '   — Food brand and amount: __________',
    '   — Feeding schedule: __________',
    '   — Medications + dosing: __________',
    '   — Quirks (afraid of thunderstorms, separation anxiety, etc.): __________',
    '',
    'CONTACTS:',
    '   — Vet (clinic, phone, after-hours line): __________',
    '   — Microchip registry + chip #: __________',
    '   — Pet insurance (carrier, policy #): __________',
    '   — Boarder / pet sitter: __________',
    '',
    'WHO I\'D WANT TO TAKE THEM:',
    '   — First choice: __________',
    '   — Backup: __________',
    "   — Note in the will if it's substantial (some states recognize pet trusts)",
  ].join('\n'),

  // ─── Digital ─────────────────────────────────────────────────────────
  'Digital life': [
    'The accounts that unlock everything else. Each one tends to gate access to several others (e.g. losing the primary email means losing every "reset password" flow that emails to it).',
    '',
    'PRIMARY EMAIL:',
    `   Address: ${OWNER.emails[0] ?? '__________'}`,
    '   Recovery email + phone: __________',
    '   2FA method: __________ (and where backup codes live)',
    '',
    'APPLE ID:',
    '   Address: __________',
    '   Legacy contact already configured? __________ (Settings → Apple ID → Sign-In & Security → Legacy Contact — if yes, the named person can request access via apple.com/legacy)',
    '',
    'GOOGLE ACCOUNT:',
    '   Inactive Account Manager configured? __________ (myaccount.google.com/inactive — auto-shares data with named person after X months of inactivity)',
    '',
    'THIS VAULT:',
    '   See Vault & secured passwords card.',
    '',
    'PASSWORD MANAGER (if not this): __________',
    '',
    'SOCIAL ACCOUNTS:',
    "   — Facebook, Instagram, etc. can be memorialized or deleted with a death certificate.",
    "   — LinkedIn: removal requires the URL + relationship + death cert.",
  ].join('\n'),

  'Vault & secured passwords': [
    "You're reading this inside the vault — the live data is one tap away.",
    '',
    'WHAT\'S IN HERE:',
    '   — All my logins (every site, app, account): /categories/finance, /categories/home, /categories/health, /categories/legal, and so on. Use /search if you don\'t see what you need at a glance.',
    '   — Credit cards, bank accounts, identity numbers',
    '   — Scans of important documents',
    '',
    'HOW TO ACCESS IF I\'M GONE:',
    '   — Anyone in the family can already log in (your accounts pre-exist).',
    '   — To promote yourself to admin / superuser: ask another admin via the Admin Panel\'s upgrade-request flow. The system queues it.',
    '   — Off-vault backup of everything in here: __________ (encrypted file location)',
    '',
    'IF YOU\'RE LOCKED OUT OF YOUR OWN ACCOUNT:',
    '   /forgot-password — works as long as your email still works.',
    '',
    'RECOVERY CODES (admin / superuser specific):',
    "   __________",
  ].join('\n'),

  'Personal property & digital assets': [
    "Things that aren't in the standard estate inventory but have value:",
    '',
    'CRYPTOCURRENCY:',
    '   — Wallets (Coinbase, Ledger, Trezor, software wallet): __________',
    '   — Seed phrases: __________ (DO NOT type into the vault — write down where they\'re physically stored)',
    '   — Without the seed phrase, the coins are gone forever. Find them.',
    '',
    'DIGITAL PROPERTY:',
    '   — Domain names I own: __________ (registrar, transfer codes)',
    '   — Cloud storage with personal stuff: __________ (provider, account)',
    '   — Photo libraries (Apple Photos, Google Photos, Lightroom, etc.): __________',
    '   — Music / movies bought (iTunes, Amazon): generally NOT transferable, but family can keep using',
    '   — Loyalty points / airline miles: __________ (some carriers transfer to spouse with paperwork; most don\'t)',
    '',
    'PHYSICAL PROPERTY OF VALUE NOT YET LISTED:',
    '   — Collections (coins, stamps, watches, etc.): __________',
    '   — Tools / equipment: __________',
    '   — Anything sentimental I\'d want passed to a specific person: __________',
  ].join('\n'),

  // ─── Misc ────────────────────────────────────────────────────────────
  'Home network specs': [
    "Per-house specifics live on each house card. This is the network-wide stuff that's easy to forget but hard to recover.",
    '',
    'ISP (provider, plan, account #): see /categories/home',
    'Network admin password: see vault',
    'Static IPs / port forwards / DDNS: __________',
    'NAS / home server (model, IP, login): __________',
    'Smart-home hub (Home Assistant, SmartThings, HomeKit): __________',
    "VPN / remote-access setup: __________",
    'DNS provider (if running pi-hole, NextDNS, etc.): __________',
    '',
    'IF THE INTERNET BREAKS:',
    '   — ISP support phone: __________',
    '   — Router admin URL: __________ (default usually 192.168.1.1)',
    '   — Modem make/model + reset procedure: __________',
  ].join('\n'),

  'Alexa commands': [
    'Custom routines / scenes you might hear me say. The device list and all routines also live in the Alexa app under my Apple ID.',
    '',
    'COMMON COMMANDS:',
    '   — "Alexa, __________" → __________',
    '',
    'ROUTINES:',
    '   — __________',
    '',
    'IF SOMETHING DOESN\'T WORK:',
    '   1. Check the Alexa app: my Apple ID account.',
    '   2. Reboot the Echo (unplug 30 seconds).',
    '   3. To remove the account entirely: alexa.amazon.com → Settings → Account → Deregister.',
  ].join('\n'),

  'Service providers & utilities': [
    "Household-wide services that aren't tied to one specific house. Per-house utilities (power, water, gas) live on each house card.",
    '',
    'Cell carrier (account holder, line numbers, account #): __________',
    'Streaming services: see /subscriptions',
    'Email / web hosting: __________',
    'Cloud backup service: __________',
    'Lawn / pool / pest service: __________',
    '',
    'Anything else billed monthly that I\'d want continued: __________',
    'Anything I\'d want canceled fast: __________',
  ].join('\n'),
}

function HOUSE_TEMPLATE(name: string): string {
  return [
    `Everything you need for ${name}.`,
    '',
    'Address: __________',
    'Mortgage holder + account #: __________',
    'Where the deed lives (physical): __________',
    'Deed scan: /categories/home',
    '',
    'Utilities (account numbers in the vault — /categories/home):',
    '- Power: __________',
    '- Water: __________',
    '- Gas: __________',
    '- Internet: __________',
    '- Trash: __________',
    '',
    'Insurance carrier + policy #: __________',
    'HOA / property manager: __________',
    'Anything weird about the house: __________',
  ].join('\n')
}
