// Seeds statement_line_items by re-parsing every PDF currently attached
// to a bank_account or credit_card entry. Without this, Phase 4b
// recurring-charge detection only has data going forward — Lance would
// see no suggestions until 3+ months of fresh statements landed. With
// this, the detector has years of history on day one.
//
// Idempotent: skips any file whose sourceFileId already shows up in
// statement_line_items (set after a successful parse). Re-run after
// failures is safe — completed files won't double-process.
//
// Run: npx tsx --env-file=.env.local scripts/backfill-statement-line-items.ts
//
// Optional: pass an entry id as the first argument to limit the backfill
// to a single account, useful for testing or re-trying a single failed
// account.

import Anthropic from '@anthropic-ai/sdk'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, files as filesTable, statementLineItems } from '@/lib/db/schema'
import { normalizeMerchant } from '@/lib/recurring-detect'

interface ParsedTransactions {
  statementDate: string | null
  transactions: Array<{
    postedDate: string
    description: string
    amountDollars: number
  }>
}

const PROMPT = `Extract EVERY transaction line from this bank or credit-card statement. Reply ONLY with JSON in this exact shape (no prose, no markdown fences):
{
  "statementDate": "ISO date YYYY-MM-DD — the statement period end. null if not visible.",
  "transactions": [
    {
      "postedDate": "YYYY-MM-DD",
      "description": "merchant/payee string verbatim from the statement",
      "amountDollars": -12.34
    }
  ]
}

Rules:
- amountDollars is SIGNED: negative for debits/charges/purchases, positive for credits/deposits/payments-received.
- description is verbatim — do NOT clean it up, normalize, or rewrite.
- Include EVERY row even if the statement has 100+ lines. Do not truncate.
- If this is not a transaction-bearing statement (tax form, insurance bill, fee notice), return {"statementDate": null, "transactions": []}.`

const ARG_ENTRY_ID = process.argv[2] || null

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — pass --env-file=.env.local')
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing')
  process.exit(1)
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN missing')
  process.exit(1)
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function parseStatement(blobUrl: string, contentType: string): Promise<ParsedTransactions | null> {
  const blobRes = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })
  if (!blobRes.ok) {
    console.log(`     ⚠ blob fetch failed (${blobRes.status})`)
    return null
  }
  const buffer = Buffer.from(await blobRes.arrayBuffer())
  const sizeMB = buffer.length / 1024 / 1024
  if (sizeMB > 30) {
    console.log(`     ⚠ ${sizeMB.toFixed(1)} MB — exceeds Anthropic 30 MB doc limit`)
    return null
  }

  const isPdf = contentType === 'application/pdf'
  const sourceBlock = isPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: buffer.toString('base64') },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: contentType as 'image/png' | 'image/jpeg' | 'image/webp',
          data: buffer.toString('base64'),
        },
      }

  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: PROMPT }] }],
    })
    const text = r.content.find((b) => b.type === 'text')
    const raw = text && 'text' in text ? text.text : ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0) {
      console.log(`     ⚠ no JSON: "${raw.slice(0, 80)}"`)
      return null
    }
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch (err) {
    console.log(`     ⚠ Claude error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

;(async () => {
  // Already-processed file ids — anything that shows up as sourceFileId
  // in statement_line_items has been parsed before; skip.
  const processedRows = await db
    .selectDistinct({ sourceFileId: statementLineItems.sourceFileId })
    .from(statementLineItems)
  const processed = new Set(processedRows.map((r) => r.sourceFileId).filter((id): id is string => !!id))
  console.log(`Already-processed file count: ${processed.size}`)

  // PDFs attached to bank_account / credit_card entries. Filter to one
  // entry if the CLI arg was passed.
  const accountTypeFilter = inArray(entries.type, ['bank_account', 'credit_card'])
  const accountIdFilter = ARG_ENTRY_ID ? eq(entries.id, ARG_ENTRY_ID) : undefined

  const candidates = await db
    .select({
      fileId: filesTable.id,
      blobUrl: filesTable.blobUrl,
      contentType: filesTable.contentType,
      filename: filesTable.filename,
      accountEntryId: filesTable.entryId,
      userId: entries.createdBy,
      accountTitle: entries.title,
    })
    .from(filesTable)
    .innerJoin(entries, eq(entries.id, filesTable.entryId))
    .where(
      and(
        sql`${filesTable.contentType} = 'application/pdf'`,
        accountTypeFilter,
        ...(accountIdFilter ? [accountIdFilter] : []),
      ),
    )
  console.log(`Candidate PDFs: ${candidates.length}${ARG_ENTRY_ID ? ` (filtered to entry ${ARG_ENTRY_ID})` : ''}`)

  let parsed = 0
  let skipped = 0
  let errored = 0
  let txnsInserted = 0

  for (const f of candidates) {
    if (processed.has(f.fileId)) {
      skipped++
      continue
    }
    if (!f.accountEntryId || !f.userId) {
      console.log(`  ${f.filename}: missing account or user id — skipping`)
      errored++
      continue
    }

    console.log(`\n  ${f.accountTitle} · ${f.filename}`)
    const result = await parseStatement(f.blobUrl, f.contentType)
    if (!result) {
      errored++
      continue
    }
    if (!result.transactions || result.transactions.length === 0) {
      console.log(`     · no transactions (probably not a statement)`)
      parsed++
      continue
    }

    const rows = result.transactions
      .filter((t) => t.postedDate && t.description && Number.isFinite(t.amountDollars))
      .map((t) => ({
        userId: f.userId!,
        accountEntryId: f.accountEntryId!,
        sourceFileId: f.fileId,
        statementDate: result.statementDate ?? null,
        postedDate: t.postedDate,
        rawDescription: t.description,
        normalizedMerchant: normalizeMerchant(t.description),
        amountCents: Math.round(t.amountDollars * 100),
        currency: 'USD',
      }))

    if (rows.length > 0) {
      await db.insert(statementLineItems).values(rows).onConflictDoNothing()
      txnsInserted += rows.length
      console.log(`     ✓ ${rows.length} transactions`)
    }
    parsed++
  }

  console.log('')
  console.log(`Done: parsed=${parsed} skipped=${skipped} errored=${errored} txnsInserted=${txnsInserted}`)
})()
