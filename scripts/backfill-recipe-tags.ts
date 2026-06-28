// One-time backfill for existing recipes (notes under the Recipes
// category) that pre-date the recipe-type multi-select. For each recipe
// we ask Claude Haiku to pick 0-3 of the 15 canonical recipe types,
// then write the names to notes.tags[] and set notes.subcategoryId to
// the first match so the existing /categories/recipes?sub=... filter
// picks them up.
//
// Already-tagged recipes (any tag overlapping the canonical set) are
// skipped — never clobber a user's manual choice.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-recipe-tags.ts          # dry run
//   npx tsx --env-file=.env.local scripts/backfill-recipe-tags.ts --apply  # commit
//
// Concurrency is capped at 5 in-flight Claude calls to keep us well
// below the rate limit while still finishing in well under a minute
// for a typical family vault.

import { and, eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../src/lib/db/index'
import { categories, notes, subcategories } from '../src/lib/db/schema'
import { decrypt } from '../src/lib/crypto'

const apply = process.argv.includes('--apply')
const CONCURRENCY = 5
const RECIPES_SLUG = 'recipes'

// Must match the list in src/lib/actions/recipes.ts.
const CANONICAL_NAMES = [
  'Slow Cooker',
  'Poultry',
  'Seafood',
  'Desserts',
  'Salads',
  'Side Dishes',
  'Soup',
  'Bread',
  'Appetizers',
  'Vegetarian',
  'Pasta',
  'Meat',
  'Vegetables',
  'Cookies',
  'Holidays',
] as const
const CANONICAL_SET = new Set<string>(CANONICAL_NAMES)

const SYSTEM_PROMPT =
  'You categorize a single recipe into one or more of these recipe types:\n' +
  CANONICAL_NAMES.map((n) => `- ${n}`).join('\n') + '\n\n' +
  'Pick 1-3 that genuinely fit. If nothing fits well, return an empty array. ' +
  'Treat "Slow Cooker" as the cooking method (only when the recipe explicitly ' +
  'uses a slow cooker / crockpot). "Holidays" is for recipes specifically tied ' +
  'to a holiday (Thanksgiving turkey, Christmas cookies, etc.), not just festive ' +
  'food. "Vegetarian" only when there is no meat/seafood/poultry as a real ' +
  'ingredient. Multiple tags are fine when they all apply (e.g. a ham soup ' +
  'is Soup + Meat).\n\n' +
  'Output ONLY a JSON object: {"tags": ["Name1", "Name2"]}. No commentary, ' +
  'no markdown fences. Use the exact names as listed above (case + spelling).'

interface ClassifyResult {
  tags: string[]
}

function safeParse(raw: string): ClassifyResult | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as Partial<ClassifyResult>
    if (!Array.isArray(parsed.tags)) return null
    const valid = parsed.tags.filter((t): t is string => typeof t === 'string' && CANONICAL_SET.has(t))
    // Cap at 3 — the prompt asks for it, but enforce defensively.
    return { tags: valid.slice(0, 3) }
  } catch {
    return null
  }
}

async function classify(client: Anthropic, title: string, content: string): Promise<string[]> {
  const userText = `Title: ${title}\n\n${content || '(no content)'}`.slice(0, 8000)
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  })
  const textBlock = response.content.find(
    (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
  )
  const parsed = safeParse(textBlock?.text.trim() ?? '')
  return parsed?.tags ?? []
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY missing. Add it to .env.local.')
    process.exit(1)
  }
  const client = new Anthropic({ apiKey })

  const recipesCat = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, RECIPES_SLUG))
    .then((r) => r[0])
  if (!recipesCat) {
    console.error('No "recipes" category found. Nothing to backfill.')
    process.exit(0)
  }

  const subs = await db
    .select({ id: subcategories.id, name: subcategories.name })
    .from(subcategories)
    .where(eq(subcategories.categoryId, recipesCat.id))
  const subIdByName = new Map(subs.map((s) => [s.name, s.id]))
  const missingFromDb = CANONICAL_NAMES.filter((n) => !subIdByName.has(n))
  if (missingFromDb.length > 0) {
    console.error(
      `Canonical subcategories missing in DB: ${missingFromDb.join(', ')}\n` +
      'Hit /recipes/new once as any logged-in user to seed them, then re-run.',
    )
    process.exit(1)
  }

  const allRecipes = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      tags: notes.tags,
      subcategoryId: notes.subcategoryId,
    })
    .from(notes)
    .where(eq(notes.categoryId, recipesCat.id))

  console.log(`Found ${allRecipes.length} notes under Recipes.`)

  // Skip ones already tagged with any canonical name — assume the user
  // categorized them on purpose.
  const todo = allRecipes.filter((n) => {
    const existing = n.tags ?? []
    return !existing.some((t) => CANONICAL_SET.has(t))
  })
  const skipped = allRecipes.length - todo.length
  console.log(`Skipping ${skipped} already-tagged. Will classify ${todo.length}.`)
  console.log(`Mode: ${apply ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}`)
  console.log('')

  let done = 0
  let updated = 0
  let empty = 0
  let failed = 0

  // Tiny worker pool so we don't fire 100 requests at once.
  async function worker(slice: typeof todo) {
    for (const note of slice) {
      const decrypted = decrypt(note.content) ?? ''
      let tags: string[] = []
      try {
        tags = await classify(client, note.title, decrypted)
      } catch (err) {
        failed += 1
        console.error(`  ! ${note.title}: ${err instanceof Error ? err.message : 'classify failed'}`)
        done += 1
        continue
      }

      done += 1
      if (tags.length === 0) {
        empty += 1
        console.log(`  · ${note.title}  →  (no match)`)
        continue
      }

      const primarySubId = subIdByName.get(tags[0]) ?? null
      console.log(`  ${apply ? '✔' : '→'} ${note.title}  →  ${tags.join(', ')}`)

      if (apply) {
        await db.update(notes).set({
          tags,
          // Only overwrite an unset subcategoryId — if the user already
          // pinned a primary subcategory, respect it.
          ...(note.subcategoryId ? {} : { subcategoryId: primarySubId }),
          updatedAt: new Date(),
        }).where(eq(notes.id, note.id))
        updated += 1
      }
    }
  }

  // Split into CONCURRENCY round-robin slices.
  const slices: (typeof todo)[] = Array.from({ length: CONCURRENCY }, () => [])
  todo.forEach((n, i) => slices[i % CONCURRENCY].push(n))
  await Promise.all(slices.map((s) => worker(s)))

  console.log('')
  console.log(`Done. Classified ${done} / ${todo.length}.`)
  console.log(`  Updated: ${updated}`)
  console.log(`  No match: ${empty}`)
  console.log(`  Failed:   ${failed}`)
  if (!apply) console.log('\nDry run — re-run with --apply to write.')
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
