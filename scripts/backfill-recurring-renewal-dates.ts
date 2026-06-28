import { and, eq, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, statementLineItems } from '@/lib/db/schema'
import { normalizeMerchant } from '@/lib/recurring-detect'

const COMMIT = process.argv.includes('--commit')
const VERBOSE = process.argv.includes('--verbose')

type Period = 'monthly' | 'yearly'

const WEAK_WORDS = new Set([
  'app',
  'card',
  'checkcard',
  'cobb',
  'inc',
  'georgia',
  'now',
  'plan',
  'plus',
  'starter',
])

function ymd(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseYmd(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function addPeriod(value: string, period: Period) {
  const date = parseYmd(value)
  if (!date) return null
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const targetMonth = period === 'monthly' ? month + 1 : month
  const targetYear = period === 'yearly' ? year + 1 : year
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 12)).getUTCDate()
  return ymd(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay), 12)))
}

function amountMatches(entryAmount: number | null, txnAmount: number) {
  if (entryAmount == null) return true
  const expected = Math.abs(entryAmount)
  const actual = Math.abs(txnAmount)
  if (expected === actual) return true
  const tolerance = Math.max(150, Math.round(expected * 0.2))
  return Math.abs(expected - actual) <= tolerance
}

function relaxedAmountMatches(entryAmount: number | null, txnAmount: number) {
  if (entryAmount == null) return false
  const expected = Math.abs(entryAmount)
  const actual = Math.abs(txnAmount)
  const tolerance = Math.max(1000, Math.round(expected * 0.5))
  return Math.abs(expected - actual) <= tolerance
}

function words(value: string, { includeWeak = false } = {}) {
  return normalizeMerchant(value)
    .split(' ')
    .filter((word) => word.length >= 3)
    .filter((word) => includeWeak || !WEAK_WORDS.has(word))
}

function urlWords(value: string | null) {
  if (!value) return []
  try {
    const url = new URL(value)
    return words(url.hostname.replace(/^www\./, '').replace(/\./g, ' '))
  } catch {
    return words(value)
  }
}

function entryWords(entry: { title: string; url: string | null }) {
  return new Set([...words(entry.title), ...urlWords(entry.url)])
}

function overlapScore(entry: { title: string; url: string | null }, merchant: string) {
  const titleWords = entryWords(entry)
  const merchantWords = new Set(words(merchant))
  let score = 0
  for (const word of titleWords) {
    if (merchantWords.has(word)) score += 1
  }
  return score
}

function daysBetween(a: string | null, b: string) {
  if (!a) return Number.MAX_SAFE_INTEGER
  const left = parseYmd(a)
  const right = parseYmd(b)
  if (!left || !right) return Number.MAX_SAFE_INTEGER
  return Math.abs(left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000)
}

function likelyRecurringLine(rawDescription: string) {
  return /\b(recurring|autopay|domains?)\b/i.test(rawDescription)
}

function lineMatchRank(
  entry: {
    title: string
    amountCents: number | null
    startedAt: string | null
    url: string | null
  },
  line: {
    postedDate: string
    rawDescription: string
    normalizedMerchant: string
    amountCents: number
  },
) {
  const merchant = line.normalizedMerchant
  if (!merchant || merchant.length < 3) return null

  const titleToken = normalizeMerchant(entry.title)
  const fullTextMatch = merchant.includes(titleToken) || titleToken.includes(merchant)
  if (fullTextMatch && amountMatches(entry.amountCents, line.amountCents)) return 1

  const score = overlapScore(entry, merchant)
  if (score >= 2 && amountMatches(entry.amountCents, line.amountCents)) return 1
  if (score >= 1 && amountMatches(entry.amountCents, line.amountCents) && likelyRecurringLine(line.rawDescription)) {
    return 1
  }
  if (score >= 1 && relaxedAmountMatches(entry.amountCents, line.amountCents) && likelyRecurringLine(line.rawDescription)) {
    return 2
  }

  const hasDomainWord = words(entry.title, { includeWeak: true }).includes('domain')
  if (
    hasDomainWord &&
    /\bdomains?\b/i.test(line.rawDescription) &&
    amountMatches(entry.amountCents, line.amountCents) &&
    daysBetween(entry.startedAt, line.postedDate) <= 45
  ) {
    return 1
  }

  return null
}

async function main() {
  const recurring = await db
    .select({
      id: entries.id,
      title: entries.title,
      period: entries.subscriptionPeriod,
      amountCents: entries.subscriptionAmountCents,
      startedAt: entries.subscriptionStartedAt,
      url: entries.url,
      customFields: entries.customFields,
    })
    .from(entries)
    .where(
      and(
        eq(entries.isRecurring, true),
        isNull(entries.parentEntryId),
        or(isNull(entries.subscriptionRenewsAt), eq(entries.subscriptionRenewsAt, '')),
      ),
    )

  const lines = await db
    .select({
      postedDate: statementLineItems.postedDate,
      rawDescription: statementLineItems.rawDescription,
      normalizedMerchant: statementLineItems.normalizedMerchant,
      amountCents: statementLineItems.amountCents,
    })
    .from(statementLineItems)

  const updates: Array<{
    id: string
    title: string
    period: Period
    lastPostedDate: string
    nextRenewsAt: string
    rawDescription: string
    amountCents: number
  }> = []
  const skipped: Array<{
    title: string
    reason: string
    detail?: string
    candidates?: string[]
  }> = []

  for (const entry of recurring) {
    if (entry.period !== 'monthly' && entry.period !== 'yearly') {
      skipped.push({
        title: entry.title,
        reason: `period is ${entry.period ?? 'blank'}`,
        detail: VERBOSE
          ? `amount ${entry.amountCents == null ? 'blank' : `$${(Math.abs(entry.amountCents) / 100).toFixed(2)}`}, started ${entry.startedAt ?? 'blank'}, url ${entry.url ?? 'blank'}, fields ${JSON.stringify(entry.customFields ?? {})}`
          : undefined,
      })
      continue
    }

    if (normalizeMerchant(entry.title).length < 3) {
      skipped.push({ title: entry.title, reason: 'title token too short' })
      continue
    }

    const matches = lines
      .filter((line) => line.amountCents < 0)
      .map((line) => ({ ...line, matchRank: lineMatchRank(entry, line) }))
      .filter((line) => line.matchRank != null)
      .sort(
        (a, b) =>
          a.matchRank! - b.matchRank! ||
          b.postedDate.localeCompare(a.postedDate),
      )

    const latest = matches[0]
    if (!latest) {
      const candidates = VERBOSE
        ? lines
            .filter((line) => line.amountCents < 0)
            .map((line) => ({
              ...line,
              score: overlapScore(entry, line.normalizedMerchant),
              amountDiff:
                entry.amountCents == null
                  ? Number.MAX_SAFE_INTEGER
                  : Math.abs(Math.abs(entry.amountCents) - Math.abs(line.amountCents)),
            }))
            .filter((line) => line.score > 0 || line.amountDiff <= 150)
            .sort(
              (a, b) =>
                b.score - a.score ||
                a.amountDiff - b.amountDiff ||
                b.postedDate.localeCompare(a.postedDate),
            )
            .slice(0, 5)
            .map(
              (line) =>
                `${line.postedDate} ${line.normalizedMerchant} (${line.rawDescription}, $${(Math.abs(line.amountCents) / 100).toFixed(2)}, score ${line.score}, diff ${line.amountDiff})`,
            )
        : undefined
      skipped.push({
        title: entry.title,
        reason: 'no matching statement debit',
        detail: VERBOSE
          ? `amount ${entry.amountCents == null ? 'blank' : `$${(Math.abs(entry.amountCents) / 100).toFixed(2)}`}, started ${entry.startedAt ?? 'blank'}, url ${entry.url ?? 'blank'}, fields ${JSON.stringify(entry.customFields ?? {})}`
          : undefined,
        candidates,
      })
      continue
    }

    const nextRenewsAt = addPeriod(latest.postedDate, entry.period)
    if (!nextRenewsAt) {
      skipped.push({ title: entry.title, reason: `bad posted date ${latest.postedDate}` })
      continue
    }

    updates.push({
      id: entry.id,
      title: entry.title,
      period: entry.period,
      lastPostedDate: latest.postedDate,
      nextRenewsAt,
      rawDescription: latest.rawDescription,
      amountCents: latest.amountCents,
    })
  }

  console.log(`${COMMIT ? 'LIVE' : 'DRY RUN'} recurring renewal-date backfill`)
  console.log(`missing renewal rows: ${recurring.length}`)
  console.log(`confident updates: ${updates.length}`)
  console.log(`skipped: ${skipped.length}\n`)

  for (const update of updates) {
    console.log(
      `${COMMIT ? 'updated' : 'would update'} ${update.title}: ${update.period}, last ${update.lastPostedDate} -> renews ${update.nextRenewsAt} (${update.rawDescription}, $${(Math.abs(update.amountCents) / 100).toFixed(2)})`,
    )
    if (COMMIT) {
      await db
        .update(entries)
        .set({ subscriptionRenewsAt: update.nextRenewsAt, updatedAt: new Date() })
        .where(eq(entries.id, update.id))
    }
  }

  if (skipped.length > 0) {
    console.log('\nSkipped:')
    for (const row of skipped) {
      console.log(`- ${row.title}: ${row.reason}`)
      if (VERBOSE && row.detail) {
        console.log(`  entry: ${row.detail}`)
      }
      if (VERBOSE && row.candidates && row.candidates.length > 0) {
        for (const candidate of row.candidates) {
          console.log(`  candidate: ${candidate}`)
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
