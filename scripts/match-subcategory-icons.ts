import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const ICON_BASE = '/icons/cobb'

/**
 * Best-match icon for a subcategory based on its name + parent category.
 * Returns null if no good match exists (caller leaves DB icon untouched).
 *
 * Priority: explicit name → keyword → category-specific default → null.
 */
function pickIcon(catSlug: string, name: string): string | null {
  const n = name.toLowerCase()

  // ── Explicit / strong matches (drive the bus) ──────────────────────────────
  if (/\bchecking\b|saving/.test(n)) return `${ICON_BASE}/checking.png`
  if (/credit\s*card|\bvisa\b/.test(n)) return `${ICON_BASE}/visa.png`
  if (/insurance/.test(n)) return `${ICON_BASE}/insurance.png`
  if (/investment/.test(n)) return `${ICON_BASE}/stocks.png`
  if (/stock/.test(n)) return `${ICON_BASE}/stocks.png`
  if (/loan|mortgage|financing/.test(n)) return `${ICON_BASE}/loan.png`
  if (/\btax/.test(n)) return `${ICON_BASE}/documents.png`
  if (/utilit/.test(n)) return `${ICON_BASE}/utilities.png`
  if (/appliance/.test(n)) return `${ICON_BASE}/appliances.png`
  if (/security|alarm|lock/.test(n)) return `${ICON_BASE}/privatevault.png`
  if (/\bhoa\b/.test(n)) return `${ICON_BASE}/legal.png`
  if (/airbnb|hotel|lodging/.test(n)) return `${ICON_BASE}/lodging.png`
  if (/\balexa/.test(n)) return `${ICON_BASE}/alexa-logo.png`
  if (/cabin/.test(n)) return `${ICON_BASE}/cabin.png`
  if (/camping/.test(n)) return `${ICON_BASE}/camping.png`
  if (/forest/.test(n)) return `${ICON_BASE}/cabin.png`
  if (/smart\s*home/.test(n)) return `${ICON_BASE}/smart-home.png`
  if (/smart.*device/.test(n)) return `${ICON_BASE}/smartdevices.png`
  if (/vendor/.test(n)) return `${ICON_BASE}/vendors.png`
  if (/school/.test(n)) return `${ICON_BASE}/school.png`
  if (/activit/.test(n)) return `${ICON_BASE}/activitis.png`
  if (/medical|doctor/.test(n)) return `${ICON_BASE}/doctor.png`
  if (/prescription/.test(n)) return `${ICON_BASE}/presciptions.png`
  if (/dental|dentist/.test(n)) return `${ICON_BASE}/dentist.png`
  if (/\bvision\b/.test(n)) return `${ICON_BASE}/vision.png`
  if (/first\s*aid|\bmedbag\b/.test(n)) return `${ICON_BASE}/firstaid.png`
  if (/health/.test(n)) return `${ICON_BASE}/health.png`
  if (/entertainment/.test(n)) return `${ICON_BASE}/entertain.png`
  if (/account/.test(n)) return `${ICON_BASE}/accounts.png`
  if (/church|ministry/.test(n)) return `${ICON_BASE}/church.png`
  if (/go\s*bag/.test(n)) return `${ICON_BASE}/gobag.png`
  if (/\bid\b|driver|license|passport|visa/.test(n) && !/credit/.test(n)) {
    if (/passport/.test(n)) return `${ICON_BASE}/passport.png`
    if (/driver/.test(n)) return `${ICON_BASE}/driverslicense.png`
    return `${ICON_BASE}/ID.png`
  }
  if (/music/.test(n)) return `${ICON_BASE}/music.png`
  if (/\bpet/.test(n)) return `${ICON_BASE}/pets.png`
  if (/shopping/.test(n)) return `${ICON_BASE}/shopping.png`
  if (/registration|car\s*doc/.test(n)) return `${ICON_BASE}/cardocs.png`
  if (/maintenance|maint\b/.test(n)) return `${ICON_BASE}/maint.png`
  if (/car\s*rental|rental/.test(n)) return `${ICON_BASE}/carrental.png`
  if (/airline/.test(n)) return `${ICON_BASE}/travel.png`
  if (/legal/.test(n)) return `${ICON_BASE}/legal.png`
  if (/license|certificate/.test(n)) return `${ICON_BASE}/certificates.png`
  if (/emergency/.test(n)) return `${ICON_BASE}/emergency.png`
  if (/end\s*of\s*the\s*world/.test(n)) return `${ICON_BASE}/endoftheworld.png`
  if (/fishing/.test(n)) return `${ICON_BASE}/fishing.png`
  if (/food|stores/.test(n)) {
    if (/store/.test(n)) return `${ICON_BASE}/stores.png`
    return `${ICON_BASE}/food.png`
  }
  if (/generator|equip/.test(n)) return `${ICON_BASE}/equip.png`
  if (/i'?m\s*gone/.test(n)) return `${ICON_BASE}/imgone.png`
  if (/solar/.test(n)) return `${ICON_BASE}/solar.png`
  if (/survival/.test(n)) return `${ICON_BASE}/survival.png`
  if (/water/.test(n)) return `${ICON_BASE}/water.png`
  if (/zombie/.test(n)) return `${ICON_BASE}/zombie.png`
  if (/streaming/.test(n)) return `${ICON_BASE}/streaming.png`
  if (/gaming|videogame/.test(n)) return `${ICON_BASE}/videogames.png`
  if (/membership/.test(n)) return `${ICON_BASE}/accounts.png`
  if (/\bfun\b/.test(n)) return `${ICON_BASE}/eastereggs.png`

  // ── Category-specific defaults ─────────────────────────────────────────────
  if (catSlug === 'finance') return `${ICON_BASE}/finances.png`
  if (catSlug === 'home') return `${ICON_BASE}/cabin.png`
  if (catSlug === 'kids') return `${ICON_BASE}/family.png`
  if (catSlug === 'health') return `${ICON_BASE}/health.png`
  if (catSlug === 'auto') return `${ICON_BASE}/auto.png`
  if (catSlug === 'business') return `${ICON_BASE}/howto.png`
  if (catSlug === 'travel') return `${ICON_BASE}/travel.png`
  if (catSlug === 'entertainment') return `${ICON_BASE}/tech.png`

  return null
}

async function run() {
  const subs = await sql`
    SELECT subcategory.id, subcategory.name, category.slug AS cat_slug
    FROM subcategory
    JOIN category ON category.id = subcategory.category_id
  `

  let updated = 0
  let unchanged = 0
  let unmatched = 0

  for (const s of subs) {
    const name = s.name as string
    const slug = s.cat_slug as string
    const id = s.id as string

    const icon = pickIcon(slug, name)
    if (!icon) {
      console.log(`  ✗ no match: [${slug}] ${name}`)
      unmatched += 1
      continue
    }

    const result = await sql`UPDATE subcategory SET icon = ${icon} WHERE id = ${id} AND (icon IS DISTINCT FROM ${icon})`
    // neon-http returns rows affected via undocumented behavior; treat as best-effort
    if ((result as unknown as { rowCount?: number })?.rowCount ?? 1) {
      console.log(`  ✓ [${slug}] ${name.padEnd(28)} → ${icon}`)
      updated += 1
    } else {
      unchanged += 1
    }
  }

  console.log(`\nDone — updated ${updated}, unchanged ${unchanged}, unmatched ${unmatched}`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
