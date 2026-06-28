// Hunt down login entries that look like recurring-pay subscriptions and
// reassign them to the Finance > Subscriptions subcategory so they show up
// on /subscriptions.
//
// Matches a curated list of well-known subscription services against the
// entry title, username, and URL (case-insensitive substring). Conservative
// by design — better to miss a few than to misclassify random Gmail logins
// as "Spotify."
//
// Usage:
//   Dry-run (default — just lists candidates):
//     npx tsx --env-file=.env.local scripts/find-subscriptions.ts
//   Apply changes (sets subcategoryId on every match):
//     npx tsx --env-file=.env.local scripts/find-subscriptions.ts --apply

import { eq, isNull, or } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { entries, categories, subcategories } from '../src/lib/db/schema'

// Substrings (case-insensitive). Add to this list whenever a new service
// shows up that the script missed. Keep entries reasonably specific —
// "Apple" alone would match "Apple Federal Credit Union." Use full
// product names where ambiguity exists.
const SUBSCRIPTION_TERMS = [
  // Streaming video
  'netflix', 'hulu', 'disney+', 'disney plus', 'hbo max', 'paramount+',
  'paramount plus', 'peacock', 'apple tv', 'appletv', 'youtube premium',
  'youtube tv', 'fubo', 'sling tv', 'philo', 'crunchyroll', 'mubi',
  'starz', 'showtime', 'discovery+',
  // Streaming audio
  'spotify', 'pandora premium', 'apple music', 'amazon music', 'tidal',
  'siriusxm', 'sirius xm', 'audible', 'kindle unlimited',
  // Software / cloud / productivity
  'adobe', 'creative cloud', 'microsoft 365', 'office 365', 'google one',
  'icloud+', 'icloud plus', 'dropbox plus', 'dropbox pro', 'notion',
  'figma', 'zoom pro', 'slack', '1password', 'lastpass', 'bitwarden premium',
  'evernote', 'todoist', 'grammarly',
  // Dev / AI
  'github', 'gitlab', 'chatgpt plus', 'openai', 'claude pro', 'anthropic',
  'gemini advanced', 'github copilot', 'cursor', 'replit', 'vercel',
  'netlify', 'cloudflare',
  // Shopping / memberships
  'amazon prime', 'costco', "sam's club", 'sams club', 'walmart+',
  'walmart plus', 'instacart+', 'doordash dashpass', 'uber one',
  'shoprunner',
  // Fitness / wellness
  'peloton', 'apple fitness', 'fitbit premium', 'strava', 'noom',
  'calm', 'headspace', 'whoop',
  // News / writing
  'new york times', 'nyt', 'wall street journal', 'wsj', 'washington post',
  'medium', 'substack', 'patreon',
  // Gaming
  'xbox game pass', 'playstation plus', 'ps plus', 'nintendo switch online',
  'twitch turbo', 'epic games',
  // Generic markers
  'subscription', 'monthly', 'annual', 'recurring',
]

const SUBS_SUBCAT_NAME = 'Subscriptions'
const FINANCE_SLUG = 'finance'

async function main() {
  const apply = process.argv.includes('--apply')

  // Find or insist on the Subscriptions subcategory under Finance.
  const finance = await db.select().from(categories).where(eq(categories.slug, FINANCE_SLUG)).then((r) => r[0])
  if (!finance) {
    console.error('No Finance category found. Visit /subscriptions once as a superuser to seed it.')
    process.exit(1)
  }
  const subsSub = await db
    .select()
    .from(subcategories)
    .where(eq(subcategories.categoryId, finance.id))
    .then((rows) => rows.find((s) => s.name === SUBS_SUBCAT_NAME))
  if (!subsSub) {
    console.error(`No "${SUBS_SUBCAT_NAME}" subcategory under Finance. Visit /subscriptions once as a superuser to seed it.`)
    process.exit(1)
  }

  // Pull every entry that hasn't already been tagged as Subscriptions, plus
  // ones with no subcategory at all. We don't filter by type='login' on the
  // server — some users might log subscriptions as 'note' or 'document'.
  const allEntries = await db
    .select({
      id: entries.id,
      title: entries.title,
      username: entries.username,
      url: entries.url,
      type: entries.type,
      categoryId: entries.categoryId,
      subcategoryId: entries.subcategoryId,
    })
    .from(entries)
    .where(or(isNull(entries.subcategoryId), eq(entries.subcategoryId, '')))

  const candidates = allEntries
    .map((e) => {
      const haystack = [e.title, e.username ?? '', e.url ?? ''].join(' ').toLowerCase()
      const hit = SUBSCRIPTION_TERMS.find((term) => haystack.includes(term))
      return hit ? { ...e, hit } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (candidates.length === 0) {
    console.log('No subscription-shaped entries found that need reassigning.')
    return
  }

  console.log(`Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}:`)
  for (const c of candidates) {
    console.log(`  • [${c.type}] ${c.title}  →  matched "${c.hit}"`)
  }

  if (!apply) {
    console.log()
    console.log(`Dry-run only. Re-run with --apply to assign all ${candidates.length} to "${SUBS_SUBCAT_NAME}".`)
    return
  }

  console.log()
  console.log('Applying...')
  // Also reparent into the Finance category so /subscriptions shows them
  // correctly even if they were filed elsewhere originally.
  for (const c of candidates) {
    await db.update(entries)
      .set({ subcategoryId: subsSub.id, categoryId: finance.id, updatedAt: new Date() })
      .where(eq(entries.id, c.id))
  }
  console.log(`Done. ${candidates.length} entries moved to Finance > Subscriptions.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
