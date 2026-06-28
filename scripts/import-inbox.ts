// Vault File Drop importer.
//
// Drop any PDF / image into C:\Users\lance\Documents\Vault File Drop\ and run
// this script. For each file it:
//   1. Sends to Claude (uses Anthropic native PDF support — no separate
//      PDF parser needed)
//   2. Asks Claude to identify the institution, account, last-4, date
//   3. Searches the vault for a matching entry by title fuzzy-match on
//      institution + account name + last-4
//   4. On unambiguous match: uploads to Blob, attaches as a file on that
//      entry, renames + moves the original to Vault File Drop\Imported\<year>\
//   5. On no/ambiguous match: leaves the file in the inbox and logs to
//      Vault File Drop\REVIEW.txt
//
// Folder routing (behavior + model selection):
//   - <root>         → Sonnet 4.6, ATTACH-ONLY (~$0.05/doc). Matches each
//                      doc to an existing vault entry; logs to REVIEW.txt
//                      and leaves the file when no match exists. Use for
//                      tax forms, insurance, brokerage statements.
//   - <root>\banks\  → Haiku 4.5, ATTACH-ONLY (~$0.02/doc, 3× cheaper).
//                      Use for routine bank + credit-card statements you
//                      already have entries for.
//   - <root>\new\    → Sonnet 4.6, CREATE NEW ENTRIES from each doc. Title
//                      derived from Claude's institution + accountTitle +
//                      last4, or the filename when Claude can't ID the
//                      issuer. Use for accounts you haven't set up yet.
//   - <root>\receipts\<llc>\ → Sonnet 4.6, CREATE new receipt entries.
//
// Run on demand:
//   npx tsx --env-file=.env.local scripts/import-inbox.ts
//
// Run on a schedule (Windows Task Scheduler):
//   See scripts/import-inbox-runner.ps1 — a wrapper batch can call that.
//
// Requires DATABASE_URL, ANTHROPIC_API_KEY, BLOB_READ_WRITE_TOKEN.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { put } from '@vercel/blob'
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  entries,
  files as filesTable,
  users,
  categories as categoriesTable,
  subcategories as subcategoriesTable,
  balanceHistory,
  statementLineItems,
  type RecentActivity,
} from '@/lib/db/schema'
import { OWNER } from '@/lib/family-config'
import { normalizeMerchant } from '@/lib/recurring-detect'
import { decryptEntries } from '@/lib/crypto'

const INBOX = String.raw`C:\Users\lance\Documents\Vault File Drop`
const IMPORTED = path.join(INBOX, 'Imported')
const DUPLICATES = path.join(INBOX, 'Duplicates')
const REVIEW_LOG = path.join(INBOX, 'REVIEW.txt')

// Per-document Claude model picker.
//   - Root inbox files → Sonnet 4.6 (broad accuracy across statement types,
//     tax forms, insurance docs, brokerage; ~$0.05 typical / $0.13 worst).
//   - banks/ subfolder  → Haiku 4.5 (~3× cheaper at ~$0.02 typical). Bank +
//     credit-card statements are simple enough that Haiku's accuracy is
//     comparable; tax-form layouts are where the gap shows.
// Bump either to a different model here without touching call sites.
const MODEL_SONNET = 'claude-sonnet-4-6'
const MODEL_HAIKU = 'claude-haiku-4-5'

const SUPPORTED_EXTS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']

interface ClassifyResult {
  institution: string | null
  accountTitle: string | null
  last4: string | null
  documentDate: string | null
  type: 'credit_card' | 'bank_account' | 'brokerage' | 'tax' | 'bill' | 'insurance' | 'other'
  confidence: 'high' | 'medium' | 'low'
  summary: string
  // Phase 2: financial intel. null when not extractable (taxes, bills,
  // insurance, etc. typically don't have a "balance").
  balanceDollars: number | null   // signed; positive=asset, negative=debt
  recentActivity: RecentActivity[] | null
  // Phase 4b: full ledger. Every transaction on the statement, not just
  // the 5 sampled into recentActivity. Drives recurring-charge detection
  // via statement_line_items. amountDollars instead of amountCents to
  // make Claude's job easier (models handle dollar.cents more reliably
  // than signed integer cents).
  allTransactions: Array<{
    postedDate: string       // YYYY-MM-DD
    description: string
    amountDollars: number    // signed; negative for debits
  }> | null
}

// Semantic prompt — describes WHAT to extract. The shape is enforced
// server-side by CLASSIFY_SCHEMA below via output_config.format, so we
// no longer need to repeat the field-by-field JSON skeleton in the
// prompt and the model can't emit malformed JSON (every comma + bracket
// is enforced by the API's constrained decoder).
const PROMPT = `Identify this financial document and return the structured fields requested.

Field semantics:
- institution: exact name of the bank/company that issued this (e.g. "American Express", "Bank of America", "Chase"). Null when not clearly a financial doc.
- accountTitle: specific account/product name (e.g. "Blue Cash Everyday", "Advantage Checking"). Null when not clear.
- last4: last 4 digits of the account number. Null when not visible.
- documentDate: ISO YYYY-MM-DD — statement period end or document date. Null when not visible.
- type: pick one of credit_card | bank_account | brokerage | tax | bill | insurance | other.
- confidence: high | medium | low — how sure you are about the institution + account match.
- summary: one short phrase describing the document.
- balanceDollars: current/closing balance as a SIGNED number in dollars (positive for assets, negative for amounts owed). Null when no clear balance exists (taxes, bills, insurance).
- recentActivity: up to 5 of the largest or most recent transactions, each {date, description, amountCents (signed integer cents)}. Null when no transactions appear.
- allTransactions: EVERY transaction line on this statement (debits and credits), each {postedDate, description (verbatim merchant/payee), amountDollars (signed, negative=debit)}. Empty array [] when no transaction list (tax forms, insurance docs). Do NOT truncate — include every row even if there are 100+.`

// JSON Schema for structured outputs. Anthropic's constrained decoder
// enforces this shape token-by-token during generation, so the model
// physically cannot emit malformed JSON — even on a 200-transaction BofA
// statement where unconstrained generation routinely drops a comma
// around the 100th array element. additionalProperties: false on every
// object is mandatory per Anthropic's structured-outputs requirements.
const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    institution:    { type: ['string', 'null'] },
    accountTitle:   { type: ['string', 'null'] },
    last4:          { type: ['string', 'null'] },
    documentDate:   { type: ['string', 'null'] },
    type:           { type: 'string', enum: ['credit_card', 'bank_account', 'brokerage', 'tax', 'bill', 'insurance', 'other'] },
    confidence:     { type: 'string', enum: ['high', 'medium', 'low'] },
    summary:        { type: 'string' },
    balanceDollars: { type: ['number', 'null'] },
    recentActivity: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date:        { type: 'string' },
          description: { type: 'string' },
          amountCents: { type: 'integer' },
        },
        required: ['date', 'description', 'amountCents'],
      },
    },
    allTransactions: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          postedDate:    { type: 'string' },
          description:   { type: 'string' },
          amountDollars: { type: 'number' },
        },
        required: ['postedDate', 'description', 'amountDollars'],
      },
    },
  },
  required: [
    'institution', 'accountTitle', 'last4', 'documentDate',
    'type', 'confidence', 'summary', 'balanceDollars',
    'recentActivity', 'allTransactions',
  ],
} as const

async function classify(filepath: string, anthropic: Anthropic, model: string = MODEL_SONNET): Promise<ClassifyResult | null> {
  const ext = path.extname(filepath).toLowerCase()
  const buffer = fs.readFileSync(filepath)
  const sizeMB = buffer.length / 1024 / 1024
  if (sizeMB > 30) {
    console.log(`   ⚠ ${path.basename(filepath)} is ${sizeMB.toFixed(1)} MB — exceeds Anthropic's 30 MB doc limit; skipping`)
    return null
  }

  const isPdf = ext === '.pdf'
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
  if (!isPdf && !isImage) return null

  const data = buffer.toString('base64')
  const mediaType = isPdf
    ? 'application/pdf'
    : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'

  const sourceBlock = isPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data },
      }
    : {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data },
      }

  try {
    // .stream() instead of .create() — the SDK refuses non-streaming
    // requests when max_tokens is high enough that the HTTP socket
    // could time out (~10 min budget at typical token rates). 32K
    // max_tokens triggers that guard, and we need that headroom for
    // dense multi-year statements. finalMessage() awaits the complete
    // response — we don't process events incrementally here, just wait
    // for the JSON to land.
    const stream = anthropic.messages.stream({
      // Caller picks the model — Sonnet by default, Haiku on the banks/
      // subtree (see main() routing). Sonnet runs at ~$0.05 typical /
      // ~$0.13 worst on a dense statement; Haiku at ~$0.02 / ~$0.05.
      // Tax/insurance docs stay on Sonnet because line-item layouts
      // there are denser and accuracy matters more than cost.
      model,
      // 32K accommodates statements with 200+ transactions. The 16-page
      // BofA Aug 2024 doc that triggered this rewrite has ~150 txns and
      // ran to ~9300 output tokens before failing on malformed JSON
      // (which the schema below now prevents). Sonnet 4.6 and Haiku 4.5
      // both support 64K max output, so 32K is well within range.
      max_tokens: 32000,
      messages: [
        {
          role: 'user',
          content: [sourceBlock, { type: 'text', text: PROMPT }],
        },
      ],
      // Structured outputs: the API's constrained decoder enforces
      // CLASSIFY_SCHEMA token-by-token during generation, so the JSON
      // is guaranteed valid + parseable regardless of how many txns
      // are in allTransactions. This is the real fix for the
      // "BofA Checking August 2024.pdf" failure — unconstrained
      // generation kept dropping a comma around row ~100 of the array.
      output_config: {
        format: { type: 'json_schema', schema: CLASSIFY_SCHEMA },
      },
    })
    const r = await stream.finalMessage()
    const text = r.content.find((b) => b.type === 'text')
    const raw = text && 'text' in text ? text.text : ''
    if (!raw.trim()) {
      console.log(`   ⚠ Claude returned empty response`)
      return null
    }
    // With structured outputs, the response IS the JSON object — no
    // need to slice between { and }. JSON.parse is guaranteed to
    // succeed; if it doesn't, something is fundamentally wrong with
    // the API response and we fall through to the catch.
    return JSON.parse(raw) as ClassifyResult
  } catch (err) {
    console.log(`   ⚠ classify error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

// Strip common corporate suffixes so "IONOS Inc." matches an entry
// titled "IONOS MyWebsite Now Starter". Claude is instructed to return
// the formal name, which often includes Inc./N.A./LLC etc. that no
// human ever types into an entry title.
//
// Example transformations:
//   "IONOS Inc."           → "IONOS"
//   "Bank of America, N.A." → "Bank of America"
//   "Comcast Corporation"   → "Comcast"
//   "ADP, LLC"              → "ADP"
function normalizeInstitution(name: string): string {
  let s = name
  // Strip from the end, repeatedly — handles "Foo, Inc."
  for (let pass = 0; pass < 3; pass++) {
    const before = s
    s = s
      .replace(/,?\s*(inc\.?|incorporated)\s*$/i, '')
      .replace(/,?\s*(llc|l\.l\.c\.?)\s*$/i, '')
      .replace(/,?\s*n\.?\s*a\.?\s*$/i, '')
      .replace(/,?\s*(corp\.?|corporation)\s*$/i, '')
      .replace(/,?\s*(co\.?|company)\s*$/i, '')
      .replace(/,?\s*(ltd\.?|limited)\s*$/i, '')
      .replace(/[,.\s]+$/, '')
    if (before === s) break
  }
  return s.trim()
}

type MatchOutcome =
  | { kind: 'matched'; entry: { id: string; title: string; type: string } }
  | { kind: 'no-candidates' }
  | { kind: 'ambiguous'; topCandidates: Array<{ title: string; score: number }> }

async function findMatchingEntry(c: ClassifyResult): Promise<MatchOutcome> {
  if (!c.institution) return { kind: 'no-candidates' }
  // Normalize first so a substring search actually has a shot at matching
  // entries whose titles use the company's brand name without the legal
  // suffix.
  const normalized = normalizeInstitution(c.institution)

  // Title-based filters — same logic as before, work for entries that
  // carry the identifier in their TITLE ("BofA Checking 0202" etc.).
  const titleFilters: ReturnType<typeof ilike>[] = [
    ilike(entries.title, `%${normalized}%`),
  ]
  if (c.last4) titleFilters.push(ilike(entries.title, `%${c.last4}%`))
  if (c.accountTitle) titleFilters.push(ilike(entries.title, `%${c.accountTitle}%`))

  // Card-number / account-number filters are NO LONGER SQL filters —
  // those columns are encrypted at rest (see ENTRY_ENCRYPTED_FIELDS in
  // src/lib/crypto.ts; the schema comment claiming plaintext is stale).
  // Raw SQL ilike against ciphertext like "enc:v1:rietjvYhMRG9..." can
  // never match a plaintext last-4, so we instead pull every entry of
  // the COMPATIBLE TYPE into the candidate pool, decrypt them, and let
  // the scoring loop filter by the decrypted suffix in JS. The vault is
  // small enough (hundreds of entries, not millions) that "all
  // bank/credit entries" is a cheap candidate set.
  const compatibleTypes: Array<'bank_account' | 'credit_card'> =
    c.type === 'credit_card' ? ['credit_card']
    : c.type === 'bank_account' || c.type === 'brokerage' ? ['bank_account']
    : ['bank_account', 'credit_card']

  const candidatesRaw = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      cardNumber: entries.cardNumber,
      accountNumber: entries.accountNumber,
    })
    .from(entries)
    .where(
      or(
        ...titleFilters,
        inArray(entries.type, compatibleTypes),
      ),
    )

  // Decrypt the structured-number fields so the score loop below can
  // compare the plaintext last-4 against the entry's real card/account
  // number. decryptEntries handles legacy/invalid ciphertext gracefully
  // (returns null on parse failure, which the score loop treats as
  // "no signal" — same as a never-set column).
  const candidates = decryptEntries(candidatesRaw)

  if (candidates.length === 0) return { kind: 'no-candidates' }

  // Score signals by specificity:
  //   - last-4 in title OR in card_number / account_number = 10
  //     (uniquely identifies an account either way — the structured
  //     fields are just as good a signal as a title substring, and
  //     they're what the new entry-creation flow populates so the
  //     vault stays matchable as you add more entries)
  //   - institution name in title = 3 (many entries can share an institution)
  //   - account product name in title = 5 (strong disambiguator when
  //     multiple entries share an institution)
  //   - same-type bonus = 2 (a bank_account statement should match a
  //     bank_account entry over a login entry of the same name)
  //
  // Earlier weighting had institution > last4, which tied on Lance's
  // 5 duplicate "Bank of America" login entries and gave up.
  const instLower = normalized.toLowerCase()
  const scored = candidates.map((e) => {
    const t = e.title.toLowerCase()
    let score = 0
    if (c.last4 && t.includes(c.last4)) score += 10
    // Structured-field matches — same weight as a title hit. endsWith
    // mirrors the SQL filter above (the user's "BofA Credit Card"
    // entry stores the full 16-digit PAN; the statement only carries
    // the last 4, so we anchor the match to the end of the column).
    if (c.last4 && e.cardNumber?.endsWith(c.last4)) score += 10
    if (c.last4 && e.accountNumber?.endsWith(c.last4)) score += 10
    if (t.includes(instLower)) score += 3
    // accountTitle (the "product" name like "Email Marketing Plus") is
    // a strong disambiguator when multiple entries share an institution.
    // Bumped to 5 so it can break ties between e.g. four IONOS entries.
    if (c.accountTitle && t.includes(c.accountTitle.toLowerCase())) score += 5
    if ((c.type === 'bank_account' && e.type === 'bank_account') ||
        (c.type === 'credit_card' && e.type === 'credit_card') ||
        (c.type === 'brokerage' && e.type === 'bank_account')) {
      score += 2
    }
    return { ...e, score }
  })
  scored.sort((a, b) => b.score - a.score)

  if (scored.length === 1) return { kind: 'matched', entry: scored[0] }
  // Require unambiguous best (top score strictly greater than second).
  if (scored[0].score > scored[1].score) return { kind: 'matched', entry: scored[0] }
  // Ambiguous — return the top few so the REVIEW log can show what was
  // almost matched. Lance can attach manually, or improve the entry
  // titles to make next run unambiguous.
  return {
    kind: 'ambiguous',
    topCandidates: scored.slice(0, 4).map((s) => ({ title: s.title, score: s.score })),
  }
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function buildOutputName(c: ClassifyResult, originalName: string): string {
  const date = c.documentDate ?? new Date().toISOString().slice(0, 10)
  const inst = c.institution ?? 'Unknown'
  const acctSuffix = c.accountTitle ?? c.last4 ?? ''
  const base = acctSuffix ? `${date} - ${inst} ${acctSuffix}` : `${date} - ${inst}`
  return sanitize(base) + path.extname(originalName)
}

function logReview(filename: string, reason: string) {
  fs.mkdirSync(INBOX, { recursive: true })
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')
  fs.appendFileSync(REVIEW_LOG, `${ts}  ${filename}  — ${reason}\n`)
}

interface DupContext {
  originalFilename: string
  attachedTo: string | null
  attachedOn: string  // YYYY-MM-DD
}

// Route a confirmed duplicate to Vault File Drop\Duplicates\<year>\
// instead of touching the vault. A sibling .txt marker records what the
// dup matched so Lance can see at a glance why it was rejected.
function moveToDuplicates(filepath: string, filename: string, ctx: DupContext) {
  const year = String(new Date().getFullYear())
  const targetDir = path.join(DUPLICATES, year)
  fs.mkdirSync(targetDir, { recursive: true })

  // Avoid clobber if a same-named dup landed earlier.
  let dest = path.join(targetDir, filename)
  let n = 1
  while (fs.existsSync(dest)) {
    const parsed = path.parse(path.join(targetDir, filename))
    dest = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  fs.renameSync(filepath, dest)

  // Sibling marker — same basename + .duplicate.txt suffix.
  const markerPath = `${dest}.duplicate.txt`
  const lines = [
    `Duplicate detected: ${new Date().toISOString()}`,
    `Original filename in vault: ${ctx.originalFilename}`,
    `Attached to entry: ${ctx.attachedTo ?? '(unknown)'}`,
    `Originally imported: ${ctx.attachedOn}`,
    ``,
    `This file was NOT added to the vault. Delete it from this folder once you've reviewed it.`,
  ]
  fs.writeFileSync(markerPath, lines.join('\n'))

  console.log(`   ✓ moved → Duplicates/${year}/${path.basename(dest)} (+ marker)`)
}

async function processFile(
  filepath: string,
  ownerId: string,
  anthropic: Anthropic,
  // Lets the main() router pick Haiku for the banks/ subtree and Sonnet
  // for everything else without per-call branching downstream. Default
  // preserves the original behavior for any non-routed call sites.
  model: string = MODEL_SONNET,
): Promise<'matched' | 'review' | 'error' | 'duplicate'> {
  const filename = path.basename(filepath)
  console.log(`\n📄 ${filename}`)

  // Dup check FIRST — cheap (SHA-256 + one DB query) and saves a Claude
  // call when this is just the same statement re-dropped. Existing
  // `files` rows from before content_hash existed have NULL hash so
  // they can't match — first time those collide, the new copy gets
  // hashed + stored; the next time it'll be caught.
  const earlyBuffer = fs.readFileSync(filepath)
  const earlyHash = crypto.createHash('sha256').update(earlyBuffer).digest('hex')
  const dupMatches = await db
    .select({
      id: filesTable.id,
      entryId: filesTable.entryId,
      filename: filesTable.filename,
      createdAt: filesTable.createdAt,
    })
    .from(filesTable)
    .where(
      and(
        eq(filesTable.uploadedBy, ownerId),
        eq(filesTable.contentHash, earlyHash),
      ),
    )
    .limit(1)
  if (dupMatches.length > 0) {
    const dup = dupMatches[0]
    // Look up the entry title for the marker file.
    const dupEntry = dup.entryId
      ? await db
          .select({ title: entries.title })
          .from(entries)
          .where(eq(entries.id, dup.entryId))
          .then((r) => r[0])
      : null
    console.log(`   ⚠ duplicate of "${dup.filename}" (already attached to "${dupEntry?.title ?? 'unknown entry'}" on ${dup.createdAt.toISOString().slice(0, 10)})`)
    moveToDuplicates(filepath, filename, {
      originalFilename: dup.filename,
      attachedTo: dupEntry?.title ?? null,
      attachedOn: dup.createdAt.toISOString().slice(0, 10),
    })
    return 'duplicate'
  }

  const c = await classify(filepath, anthropic, model)
  if (!c) {
    logReview(filename, 'classification failed')
    return 'error'
  }
  const conf = c.confidence === 'high' ? '✓' : c.confidence === 'medium' ? '~' : '?'
  console.log(`   ${conf} ${c.institution ?? '(unknown)'} · ${c.last4 ? '*' + c.last4 : 'no acct#'} · ${c.documentDate ?? 'no date'} · ${c.type}`)

  if (c.confidence === 'low') {
    logReview(filename, `low confidence — Claude says: ${c.summary}`)
    return 'review'
  }

  const outcome = await findMatchingEntry(c)
  if (outcome.kind !== 'matched') {
    console.log(`   ⚠ no matching vault entry — left in inbox`)
    // Better diagnostic in REVIEW.txt so Lance knows whether the issue
    // is "no candidates at all" (need to create the entry) vs.
    // "matched several, can't pick" (need to disambiguate). The latter
    // case shows the top candidates' titles + scores so it's obvious
    // why the matcher gave up.
    if (outcome.kind === 'ambiguous') {
      const list = outcome.topCandidates
        .map((c) => `${c.title} (score ${c.score})`)
        .join(' | ')
      logReview(
        filename,
        `ambiguous — Claude saw "${c.institution}" → matched ${outcome.topCandidates.length} entries, tied on score. Top: ${list}. ` +
          `Add a more specific accountTitle hint or rename entries to disambiguate.`,
      )
    } else {
      // List every field the matcher actually queried — title, plus
      // (when Claude found a last-4) card_number / account_number / a
      // last-4 substring in the title, plus accountTitle when set. That
      // way "no match" tells the user concretely WHAT was tried, so
      // they know whether to populate the structured field, rename the
      // entry, or accept that Claude misread the PDF.
      const normalizedInst = normalizeInstitution(c.institution ?? '')
      const searched = [`title contains "${normalizedInst}"`]
      if (c.last4) {
        searched.push(`title contains "${c.last4}"`)
        searched.push(`card_number ends with "${c.last4}"`)
        searched.push(`account_number ends with "${c.last4}"`)
      }
      if (c.accountTitle) searched.push(`title contains "${c.accountTitle}"`)
      logReview(
        filename,
        `no match — Claude saw "${c.institution}${c.last4 ? ' *' + c.last4 : ''}" (type: ${c.type}). ` +
          `Matcher searched: ${searched.join(' OR ')}. Zero candidates. ` +
          `Fixes: (a) rename an existing entry to include the last-4 in the title, ` +
          `(b) populate the entry's Account Number / Card Number field with the digits Claude found, ` +
          `(c) move to new/ to create a fresh entry, ` +
          `(d) if Claude misread the digits, open the PDF and verify the actual last-4.`,
      )
    }
    return 'review'
  }
  const match = outcome.entry
  console.log(`   → matched: ${match.title}`)

  // Reuse the buffer already read for the dup check.
  const buffer = earlyBuffer
  const ext = path.extname(filename).toLowerCase()
  const contentType = ext === '.pdf'
    ? 'application/pdf'
    : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'

  const ts = Date.now()
  const blobPath = `vault/${ownerId}/${ts}-${Math.floor(Math.random() * 1e6)}-${sanitize(filename)}`
  const blob = await put(blobPath, buffer, { access: 'private', contentType })
  const [fileRow] = await db.insert(filesTable).values({
    entryId: match.id,
    filename,
    blobUrl: blob.url,
    contentType,
    size: buffer.length,
    contentHash: earlyHash,
    isPrivate: false,
    uploadedBy: ownerId,
  }).returning()
  console.log(`   ✓ uploaded + attached (${(buffer.length / 1024).toFixed(0)} KB)`)

  // Phase 4b: write every parsed transaction to statement_line_items.
  // Only meaningful for bank/credit-card statements; tax/insurance/bill
  // imports return [] for allTransactions and this is a no-op. Dedup'd
  // at the DB layer via the unique (account, postedDate, amount,
  // merchant) index — re-importing the same statement is safe.
  if (c.allTransactions && c.allTransactions.length > 0
      && (match.type === 'bank_account' || match.type === 'credit_card')) {
    const rows = c.allTransactions
      .filter((t) => t.postedDate && t.description && Number.isFinite(t.amountDollars))
      .map((t) => ({
        userId: ownerId,
        accountEntryId: match.id,
        sourceFileId: fileRow?.id ?? null,
        statementDate: c.documentDate ?? null,
        postedDate: t.postedDate,
        rawDescription: t.description,
        normalizedMerchant: normalizeMerchant(t.description),
        amountCents: Math.round(t.amountDollars * 100),
        currency: 'USD',
      }))
    if (rows.length > 0) {
      // onConflictDoNothing keys to the dedup unique index. Re-imports
      // skip without raising, so this loop is idempotent.
      await db.insert(statementLineItems).values(rows).onConflictDoNothing()
      console.log(`   ✓ ${rows.length} transactions recorded`)
    }
  }

  // Phase 2: write extracted balance to the entry + balance_history.
  if (c.balanceDollars != null && c.documentDate) {
    const cents = Math.round(c.balanceDollars * 100)
    const periodEnd = new Date(c.documentDate)
    if (!Number.isNaN(periodEnd.getTime())) {
      // Only update entry if this statement is newer than the current
      // balance-as-of (don't let an old back-dated import clobber a
      // fresher balance).
      const existing = await db.select({ balanceAsOf: entries.balanceAsOf })
        .from(entries)
        .where(eq(entries.id, match.id))
        .then((r) => r[0])
      const isNewer = !existing?.balanceAsOf || existing.balanceAsOf < periodEnd
      if (isNewer) {
        await db.update(entries).set({
          currentBalance: cents,
          balanceAsOf: periodEnd,
          recentActivity: c.recentActivity ?? null,
        }).where(eq(entries.id, match.id))
        console.log(`   ✓ balance updated: $${c.balanceDollars.toFixed(2)} as of ${c.documentDate}`)
      }
      // Always log to balance_history (even back-dated imports — they
      // fill in the timeline).
      await db.insert(balanceHistory).values({
        entryId: match.id,
        balanceCents: cents,
        periodEnd,
        sourceFileId: fileRow?.id ?? null,
      })
    }
  }

  const year = (c.documentDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4)
  const targetDir = path.join(IMPORTED, year)
  fs.mkdirSync(targetDir, { recursive: true })
  const outName = buildOutputName(c, filename)
  const targetPath = path.join(targetDir, outName)
  // Avoid clobber: if a file with the same target name exists, suffix a counter
  let final = targetPath
  let n = 1
  while (fs.existsSync(final)) {
    const parsed = path.parse(targetPath)
    final = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  fs.renameSync(filepath, final)
  console.log(`   ✓ moved → Imported/${year}/${path.basename(final)}`)
  return 'matched'
}

// ─── New-entry subtree ────────────────────────────────────────────────────
//
// Vault File Drop\new\*.{jpg,pdf,…} — same identification flow as the
// root inbox, but instead of LOOKING UP an existing entry to attach to,
// each file CREATES a new entry whose title is derived from the doc
// (Claude's institution + accountTitle + last4) with a filename fallback
// when Claude can't ID the issuer (kids' account screenshots, etc.).
//
// Use this when you've got docs for accounts / billers you haven't set
// up in the vault yet. The root inbox stays attach-only so we don't auto-
// generate duplicate entries for things you already have.

// Map Claude's classified document type to the closest entry type the
// schema supports. Bank/credit-card stay as-is; brokerage rides on the
// bank_account shape (closest match); tax/bill/insurance/other become
// generic `document` entries.
function entryTypeForDoc(docType: ClassifyResult['type']): 'bank_account' | 'credit_card' | 'document' {
  if (docType === 'bank_account' || docType === 'brokerage') return 'bank_account'
  if (docType === 'credit_card') return 'credit_card'
  return 'document'
}

// Build the title for a freshly-created entry. Claude's institution +
// accountTitle + last4 win when present; otherwise the filename stem
// becomes the title (camera-roll gibberish prefixes stripped). Examples:
//   "Axos Bank" + "Rewards Checking" + "0254" → "Axos Bank Rewards Checking *0254"
//   institution null + "Dads Rewards Checking Account Info.jpg"
//     → "Dads Rewards Checking Account Info"
function deriveNewEntryTitle(c: ClassifyResult, originalFilename: string): string {
  if (c.institution) {
    const parts = [c.institution.trim()]
    if (c.accountTitle?.trim()) parts.push(c.accountTitle.trim())
    if (c.last4) parts.push(`*${c.last4}`)
    return parts.join(' ').slice(0, 200)
  }
  // Filename fallback — strip extension + leading IMG/DSC/SCAN noise.
  const stem = originalFilename.replace(/\.[^.]+$/, '').trim()
  const cleaned = stem
    .replace(/^(img|dsc|dcim|mvimg|vid|pxl|scan)[_\-\s]+/i, '')
    .replace(/^(screenshot[_\-\s]+)/i, '')
    .trim()
  return (cleaned || stem || 'Untitled document').slice(0, 200)
}

async function processNewEntryFile(
  filepath: string,
  ownerId: string,
  anthropic: Anthropic,
  defaultCategoryId: string,
  model: string = MODEL_SONNET,
): Promise<'matched' | 'review' | 'error' | 'duplicate'> {
  const filename = path.basename(filepath)
  console.log(`\n🆕 ${filename}`)

  // SHA-256 dedup against existing files — re-dropping a screenshot you
  // already created an entry for shouldn't spawn a second entry.
  const buffer = fs.readFileSync(filepath)
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex')
  const dup = await db
    .select({ id: filesTable.id, entryId: filesTable.entryId, filename: filesTable.filename, createdAt: filesTable.createdAt })
    .from(filesTable)
    .where(and(eq(filesTable.uploadedBy, ownerId), eq(filesTable.contentHash, fileHash)))
    .limit(1)
    .then((r) => r[0])
  if (dup) {
    const dupEntry = dup.entryId
      ? await db.select({ title: entries.title }).from(entries).where(eq(entries.id, dup.entryId)).then((r) => r[0])
      : null
    console.log(`   ⚠ duplicate of "${dup.filename}" (already attached to "${dupEntry?.title ?? 'unknown entry'}" on ${dup.createdAt.toISOString().slice(0, 10)})`)
    moveToDuplicates(filepath, filename, {
      originalFilename: dup.filename,
      attachedTo: dupEntry?.title ?? null,
      attachedOn: dup.createdAt.toISOString().slice(0, 10),
    })
    return 'duplicate'
  }

  const c = await classify(filepath, anthropic, model)
  if (!c) {
    console.log(`   ⚠ classify failed`)
    logReview(`new/${filename}`, 'classify failed — Claude returned no usable JSON')
    return 'error'
  }

  // Pre-pull the file's extension + content type before we touch the DB,
  // so a blob/upload failure doesn't leave an orphan entries row behind.
  const ext = path.extname(filename).toLowerCase()
  const contentType = ext === '.pdf'
    ? 'application/pdf'
    : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'

  // Try to match an existing entry FIRST — handles two cases cleanly:
  //   (a) The user pre-created a card in the vault and just wants the
  //       statement attached (e.g. they entered the card manually
  //       between drops).
  //   (b) Multiple statements for the same account land in one batch
  //       (e.g. April 2020 + April 2021 for *0079) — the FIRST one
  //       creates the entry, subsequent ones match against it and
  //       attach instead of generating duplicates.
  // Only the first per-account file pays the "create" path; everything
  // after that takes the cheap match-and-attach path.
  const outcome = await findMatchingEntry(c)
  let entryId: string
  let entryTypeActual: string

  if (outcome.kind === 'matched') {
    entryId = outcome.entry.id
    entryTypeActual = outcome.entry.type
    console.log(`   → matched existing: "${outcome.entry.title}" — attaching`)
  } else {
    const title = deriveNewEntryTitle(c, filename)
    const entryType = entryTypeForDoc(c.type)
    console.log(`   → creating ${entryType}: "${title}"`)
    // categoryId defaults to Finance; user can re-file from the UI.
    const [newEntry] = await db
      .insert(entries)
      .values({
        categoryId: defaultCategoryId,
        type: entryType,
        title,
        // Populate the structured fields Claude gave us so the entry
        // shows up complete on first view — saves a follow-up edit.
        bankName: entryType === 'bank_account' ? (c.institution ?? null) : null,
        accountType: entryType === 'bank_account' ? (c.accountTitle ?? null) : null,
        accountNumber: c.last4 ?? null,
        isPrivate: false,
        isPersonal: false,
        createdBy: ownerId,
      })
      .returning({ id: entries.id, type: entries.type, title: entries.title })
    entryId = newEntry.id
    entryTypeActual = newEntry.type
    console.log(`   ✓ entry created (id=${newEntry.id.slice(0, 8)}…)`)
  }

  // 2. Upload the file + attach to the resolved entry (created or matched).
  const ts = Date.now()
  const blobPath = `vault/${ownerId}/${ts}-${Math.floor(Math.random() * 1e6)}-${sanitize(filename)}`
  const blob = await put(blobPath, buffer, { access: 'private', contentType })
  const [fileRow] = await db.insert(filesTable).values({
    entryId,
    filename,
    blobUrl: blob.url,
    contentType,
    size: buffer.length,
    contentHash: fileHash,
    isPrivate: false,
    uploadedBy: ownerId,
  }).returning()
  console.log(`   ✓ uploaded + attached (${(buffer.length / 1024).toFixed(0)} KB)`)

  // 3. If this is a bank/credit-card statement with line items, capture
  //    them now so the entry's ledger reflects the new statement.
  if (c.allTransactions && c.allTransactions.length > 0
      && (entryTypeActual === 'bank_account' || entryTypeActual === 'credit_card')) {
    const rows = c.allTransactions
      .filter((t) => t.postedDate && t.description && Number.isFinite(t.amountDollars))
      .map((t) => ({
        userId: ownerId,
        accountEntryId: entryId,
        sourceFileId: fileRow?.id ?? null,
        statementDate: c.documentDate ?? null,
        postedDate: t.postedDate,
        rawDescription: t.description,
        normalizedMerchant: normalizeMerchant(t.description),
        amountCents: Math.round(t.amountDollars * 100),
        currency: 'USD',
      }))
    if (rows.length > 0) {
      await db.insert(statementLineItems).values(rows).onConflictDoNothing()
      console.log(`   ✓ ${rows.length} transactions recorded`)
    }
  }

  // 4. Balance snapshot for bank/credit accounts. Only updates the
  //    entry's currentBalance/balanceAsOf when the statement is NEWER
  //    than the recorded one — same anti-clobber check processFile
  //    uses for the attach path, so a back-dated import (e.g. April
  //    2020 after April 2025 already landed) fills the timeline
  //    without overwriting the fresher figure.
  if (c.balanceDollars != null && c.documentDate
      && (entryTypeActual === 'bank_account' || entryTypeActual === 'credit_card')) {
    const cents = Math.round(c.balanceDollars * 100)
    const periodEnd = new Date(c.documentDate)
    if (!Number.isNaN(periodEnd.getTime())) {
      const existing = await db.select({ balanceAsOf: entries.balanceAsOf })
        .from(entries)
        .where(eq(entries.id, entryId))
        .then((r) => r[0])
      const isNewer = !existing?.balanceAsOf || existing.balanceAsOf < periodEnd
      if (isNewer) {
        await db.update(entries).set({
          currentBalance: cents,
          balanceAsOf: periodEnd,
          recentActivity: c.recentActivity ?? null,
        }).where(eq(entries.id, entryId))
        console.log(`   ✓ balance updated: $${c.balanceDollars.toFixed(2)} as of ${c.documentDate}`)
      }
      // Always log to balance_history — back-dated imports fill the timeline.
      await db.insert(balanceHistory).values({
        entryId,
        balanceCents: cents,
        periodEnd,
        sourceFileId: fileRow?.id ?? null,
      })
    }
  }

  // 5. Move the source file to Imported/new/<year>/ so the next run
  //    doesn't re-process it.
  const year = (c.documentDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4)
  const targetDir = path.join(IMPORTED, 'new', year)
  fs.mkdirSync(targetDir, { recursive: true })
  const outName = buildOutputName(c, filename)
  let final = path.join(targetDir, outName)
  let n = 1
  while (fs.existsSync(final)) {
    const parsed = path.parse(path.join(targetDir, outName))
    final = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  fs.renameSync(filepath, final)
  console.log(`   ✓ moved → Imported/new/${year}/${path.basename(final)}`)
  return 'matched'
}

// ─── Receipts subtree ────────────────────────────────────────────────────
//
// Vault File Drop\receipts\<llc-slug>\*.{jpg,pdf,…} — each file becomes a
// new receipt entry under the Receipts → <LLC> subcategory. Different
// shape from the top-level inbox (which matches files to an existing
// vault entry by institution); receipt files always create a new entry.

interface ParsedReceipt {
  merchant: string | null
  totalCents: number | null
  purchaseDate: string | null   // YYYY-MM-DD
  itemHint: string | null
}

const RECEIPT_PROMPT = `Read this receipt and reply ONLY with JSON in this exact shape (no prose, no markdown):
{
  "merchant": "the store / business name printed at the top, or null",
  "totalCents": "the final paid total as an integer in cents (e.g. $14.27 = 1427). Use the grand total, not subtotal. null if not visible.",
  "purchaseDate": "ISO YYYY-MM-DD if a date is visible, else null",
  "itemHint": "short phrase summarizing what was bought (≤40 chars), e.g. 'Groceries', 'Gas fill-up'. null if unclear"
}`

async function classifyReceipt(filepath: string, anthropic: Anthropic): Promise<ParsedReceipt | null> {
  const ext = path.extname(filepath).toLowerCase()
  const buffer = fs.readFileSync(filepath)
  const sizeMB = buffer.length / 1024 / 1024
  if (sizeMB > 30) {
    console.log(`   ⚠ ${path.basename(filepath)} is ${sizeMB.toFixed(1)} MB — exceeds 30 MB; skipping`)
    return null
  }
  const isPdf = ext === '.pdf'
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
  if (!isPdf && !isImage) return null

  const data = buffer.toString('base64')
  const mediaType = isPdf
    ? 'application/pdf'
    : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'
  const sourceBlock = isPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data },
      }
    : {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data },
      }

  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [
        { role: 'user', content: [sourceBlock, { type: 'text', text: RECEIPT_PROMPT }] },
      ],
    })
    const text = r.content.find((b) => b.type === 'text')
    const raw = text && 'text' in text ? text.text : ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0) return null
    const json = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>
    const merchant = typeof json.merchant === 'string' && json.merchant.trim() ? json.merchant.trim() : null
    const totalCents = typeof json.totalCents === 'number' && Number.isFinite(json.totalCents)
      ? Math.round(json.totalCents)
      : null
    const purchaseDate = typeof json.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.purchaseDate)
      ? json.purchaseDate
      : null
    const itemHint = typeof json.itemHint === 'string' && json.itemHint.trim() ? json.itemHint.trim().slice(0, 80) : null
    return { merchant, totalCents, purchaseDate, itemHint }
  } catch (err) {
    console.log(`   ⚠ receipt classify error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function processReceiptFile(
  filepath: string,
  ownerId: string,
  categoryId: string,
  subcategoryId: string,
  llcName: string,
  anthropic: Anthropic,
): Promise<'matched' | 'review' | 'error'> {
  const filename = path.basename(filepath)
  console.log(`\n🧾 ${llcName} / ${filename}`)

  const r = await classifyReceipt(filepath, anthropic)
  if (!r) {
    logReview(`receipts/${path.basename(path.dirname(filepath))}/${filename}`, 'receipt classification failed')
    return 'error'
  }
  console.log(`   ${r.merchant ?? '(unknown merchant)'} · ${r.totalCents != null ? '$' + (r.totalCents / 100).toFixed(2) : 'no total'} · ${r.purchaseDate ?? 'no date'}`)

  const stamp = r.purchaseDate ?? new Date().toISOString().slice(0, 10)
  // Title carries the amount so it's visible in the entry-card list
  // without drilling in — each receipt under an LLC subcategory reads
  // as e.g. "Office Depot — Toner 2026-06-02 — $87.41".
  const amountSuffix = r.totalCents != null ? ` — $${(r.totalCents / 100).toFixed(2)}` : ''
  const base = r.merchant
    ? `${r.merchant}${r.itemHint ? ' — ' + r.itemHint : ''} ${stamp}`.trim()
    : `Receipt ${stamp}`
  const title = `${base}${amountSuffix}`

  const customFields: Record<string, string> = {
    kind: 'receipt',
    merchant: r.merchant ?? 'Unknown',
    totalCents: String(r.totalCents ?? 0),
    purchaseDate: stamp,
    receiptCount: '1',
    source: 'vault-inbox',
  }

  const [entry] = await db
    .insert(entries)
    .values({
      categoryId,
      subcategoryId,
      type: 'document',
      title,
      customFields,
      isPrivate: false,
      isPersonal: false,
      isFavorite: false,
      isRecurring: false,
      createdBy: ownerId,
      updatedBy: ownerId,
    })
    .returning()

  const buffer = fs.readFileSync(filepath)
  const ext = path.extname(filename).toLowerCase()
  const contentType = ext === '.pdf'
    ? 'application/pdf'
    : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'
  const ts = Date.now()
  const outFilename = `receipt-${stamp}${ext}`
  const blobPath = `vault/${ownerId}/receipts/${ts}-${Math.floor(Math.random() * 1e6)}-${sanitize(outFilename)}`
  const blob = await put(blobPath, buffer, { access: 'private', contentType })
  await db.insert(filesTable).values({
    entryId: entry.id,
    filename: outFilename,
    blobUrl: blob.url,
    contentType,
    size: buffer.length,
    isPrivate: false,
    uploadedBy: ownerId,
  })
  console.log(`   ✓ entry created + photo attached (${(buffer.length / 1024).toFixed(0)} KB)`)

  // Move processed file into Imported/receipts/<llc>/<year>/ so a future
  // re-run doesn't re-process it. Same anti-clobber dance as the main
  // inbox flow.
  const year = stamp.slice(0, 4)
  const llcSlug = path.basename(path.dirname(filepath))
  const targetDir = path.join(IMPORTED, 'receipts', llcSlug, year)
  fs.mkdirSync(targetDir, { recursive: true })
  let final = path.join(targetDir, sanitize(outFilename))
  let n = 1
  while (fs.existsSync(final)) {
    const parsed = path.parse(final)
    final = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  fs.renameSync(filepath, final)
  console.log(`   ✓ moved → Imported/receipts/${llcSlug}/${year}/${path.basename(final)}`)
  return 'matched'
}

async function sweepReceiptsSubtree(ownerId: string, anthropic: Anthropic): Promise<{ matched: number; review: number; errors: number }> {
  const receiptsRoot = path.join(INBOX, 'receipts')
  if (!fs.existsSync(receiptsRoot)) return { matched: 0, review: 0, errors: 0 }

  // Look up the Receipts category. Bail out if it hasn't been seeded yet —
  // running scripts/seed-receipts-llcs.ts creates it + the LLC subs.
  const receiptsCat = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, 'receipts'))
    .then((r) => r[0])
  if (!receiptsCat) {
    console.log('⚠ Receipts category not seeded — run scripts/seed-receipts-llcs.ts')
    return { matched: 0, review: 0, errors: 0 }
  }

  const subs = await db
    .select({ id: subcategoriesTable.id, slug: subcategoriesTable.slug, name: subcategoriesTable.name })
    .from(subcategoriesTable)
    .where(eq(subcategoriesTable.categoryId, receiptsCat.id))
  const subBySlug = new Map(subs.map((s) => [s.slug, s]))

  const dirs = fs.readdirSync(receiptsRoot).filter((d) => {
    const full = path.join(receiptsRoot, d)
    return fs.statSync(full).isDirectory()
  })
  if (dirs.length === 0) return { matched: 0, review: 0, errors: 0 }

  let matched = 0
  let review = 0
  let errors = 0
  for (const dir of dirs) {
    const llc = subBySlug.get(dir)
    if (!llc) {
      console.log(`⚠ receipts/${dir}/ — no matching LLC subcategory; skipping folder`)
      continue
    }
    const files = fs.readdirSync(path.join(receiptsRoot, dir)).filter((f) => {
      const full = path.join(receiptsRoot, dir, f)
      if (!fs.statSync(full).isFile()) return false
      if (f === 'desktop.ini' || f.startsWith('.')) return false
      return SUPPORTED_EXTS.includes(path.extname(f).toLowerCase())
    })
    if (files.length === 0) continue
    console.log(`\n📁 receipts/${dir}/ — ${files.length} file${files.length === 1 ? '' : 's'}`)
    for (const f of files) {
      try {
        const result = await processReceiptFile(
          path.join(receiptsRoot, dir, f),
          ownerId,
          receiptsCat.id,
          llc.id,
          llc.name,
          anthropic,
        )
        if (result === 'matched') matched++
        else if (result === 'review') review++
        else errors++
      } catch (err) {
        console.log(`   ✗ ${f}: ${err instanceof Error ? err.message : String(err)}`)
        logReview(`receipts/${dir}/${f}`, err instanceof Error ? err.message : String(err))
        errors++
      }
    }
  }
  return { matched, review, errors }
}

async function main() {
  if (!fs.existsSync(INBOX)) {
    fs.mkdirSync(INBOX, { recursive: true })
    console.log(`Created Vault File Drop at: ${INBOX}`)
    console.log('Drop PDFs / images here and re-run.')
    return
  }

  const owner = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, OWNER.emails[0]))
    .then((r) => r[0])
  if (!owner) throw new Error(`Owner not found by email ${OWNER.emails[0]}`)

  const all = fs.readdirSync(INBOX).filter((f) => {
    const full = path.join(INBOX, f)
    if (!fs.statSync(full).isFile()) return false
    if (f === 'REVIEW.txt' || f === 'desktop.ini' || f.startsWith('.')) return false
    return SUPPORTED_EXTS.includes(path.extname(f).toLowerCase())
  })

  // banks/ subtree — same matching/attachment flow as the root inbox, but
  // routed through Haiku 4.5 for the ~3× cost win. Use this folder for
  // routine bank + credit-card statements; keep tax forms, insurance
  // docs, and anything where line-item accuracy matters in the root
  // inbox (Sonnet path).
  const banksRoot = path.join(INBOX, 'banks')
  const banksFiles = fs.existsSync(banksRoot)
    ? fs.readdirSync(banksRoot).filter((f) => {
        const full = path.join(banksRoot, f)
        if (!fs.statSync(full).isFile()) return false
        if (f === 'desktop.ini' || f.startsWith('.')) return false
        return SUPPORTED_EXTS.includes(path.extname(f).toLowerCase())
      })
    : []

  // new/ subtree — each file CREATES a new vault entry (instead of trying
  // to attach to an existing one). Use this for accounts / billers you
  // haven't set up in the vault yet — kids' bank accounts, new vendors,
  // anything that came back from the root pass as "no matching vault
  // entry — left in inbox" but you actually want a card for.
  const newRoot = path.join(INBOX, 'new')
  const newFiles = fs.existsSync(newRoot)
    ? fs.readdirSync(newRoot).filter((f) => {
        const full = path.join(newRoot, f)
        if (!fs.statSync(full).isFile()) return false
        if (f === 'desktop.ini' || f.startsWith('.')) return false
        return SUPPORTED_EXTS.includes(path.extname(f).toLowerCase())
      })
    : []

  // Receipts subtree is walked separately from the flat top-level inbox.
  // We let it run even when the top-level is empty.
  const receiptsRoot = path.join(INBOX, 'receipts')
  const hasReceiptsSubtree = fs.existsSync(receiptsRoot)

  if (all.length === 0 && banksFiles.length === 0 && newFiles.length === 0 && !hasReceiptsSubtree) {
    console.log(`📭 Inbox empty: ${INBOX}`)
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — classification needs the Claude API.')
    process.exit(1)
  }

  if (all.length > 0) {
    console.log(`📂 ${all.length} file${all.length === 1 ? '' : 's'} in root — attach-only, Sonnet\n`)
  }
  if (banksFiles.length > 0) {
    console.log(`🏦 ${banksFiles.length} file${banksFiles.length === 1 ? '' : 's'} in banks/ — attach-only, Haiku\n`)
  }
  if (newFiles.length > 0) {
    console.log(`🆕 ${newFiles.length} file${newFiles.length === 1 ? '' : 's'} in new/ — create entries, Sonnet\n`)
  }
  const anthropic = new Anthropic()

  let matched = 0
  let review = 0
  let errors = 0
  let duplicates = 0
  for (const f of all) {
    try {
      const result = await processFile(path.join(INBOX, f), owner.id, anthropic, MODEL_SONNET)
      if (result === 'matched') matched++
      else if (result === 'review') review++
      else if (result === 'duplicate') duplicates++
      else errors++
    } catch (err) {
      console.log(`   ✗ ${f}: ${err instanceof Error ? err.message : String(err)}`)
      logReview(f, err instanceof Error ? err.message : String(err))
      errors++
    }
  }

  // banks/ subtree pass — same matcher/attachment behavior as root,
  // just Haiku instead of Sonnet. Files that fail to match get logged
  // to REVIEW.txt with a banks/ prefix so they're easy to find.
  for (const f of banksFiles) {
    try {
      const result = await processFile(path.join(banksRoot, f), owner.id, anthropic, MODEL_HAIKU)
      if (result === 'matched') matched++
      else if (result === 'review') review++
      else if (result === 'duplicate') duplicates++
      else errors++
    } catch (err) {
      console.log(`   ✗ banks/${f}: ${err instanceof Error ? err.message : String(err)}`)
      logReview(`banks/${f}`, err instanceof Error ? err.message : String(err))
      errors++
    }
  }

  // new/ subtree pass — CREATE a new vault entry for each file rather
  // than searching for one to attach to. Uses Sonnet for the wider
  // accuracy budget across mixed doc types (kids' bank screenshots,
  // utility invoices, anything else you want a card for).
  if (newFiles.length > 0) {
    const financeCat = await db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(eq(categoriesTable.slug, 'finance'))
      .then((r) => r[0])
    if (!financeCat) {
      console.log(`⚠ Skipping new/ subtree — Finance category not seeded.`)
      for (const f of newFiles) {
        logReview(`new/${f}`, 'skipped — Finance category (slug=finance) not found')
      }
      errors += newFiles.length
    } else {
      for (const f of newFiles) {
        try {
          const result = await processNewEntryFile(path.join(newRoot, f), owner.id, anthropic, financeCat.id, MODEL_SONNET)
          if (result === 'matched') matched++
          else if (result === 'review') review++
          else if (result === 'duplicate') duplicates++
          else errors++
        } catch (err) {
          console.log(`   ✗ new/${f}: ${err instanceof Error ? err.message : String(err)}`)
          logReview(`new/${f}`, err instanceof Error ? err.message : String(err))
          errors++
        }
      }
    }
  }

  // Receipts subtree pass — separate from the main flow because each file
  // creates a NEW entry under the matching LLC subcategory rather than
  // attaching to an existing one.
  if (hasReceiptsSubtree) {
    const r = await sweepReceiptsSubtree(owner.id, anthropic)
    matched += r.matched
    review += r.review
    errors += r.errors
  }

  console.log(`\n──────────────────────────────────────────────`)
  console.log(`Imported: ${matched}    Duplicates: ${duplicates}    Needs review: ${review}    Errors: ${errors}`)
  if (duplicates > 0) {
    console.log(`See ${DUPLICATES}\\ for rejected duplicate files + .duplicate.txt markers.`)
  }
  if (review > 0 || errors > 0) {
    console.log(`See ${REVIEW_LOG} for details.`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
