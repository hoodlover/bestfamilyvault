import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const ICON_BASE = '/icons/cobb'

const slugToIcon: Record<string, string> = {
  finance: `${ICON_BASE}/finances.png`,
  home: `${ICON_BASE}/cabin.png`,
  kids: `${ICON_BASE}/family.png`,
  health: `${ICON_BASE}/health.png`,
  auto: `${ICON_BASE}/auto.png`,
  business: `${ICON_BASE}/howto.png`,
  travel: `${ICON_BASE}/travel.png`,
  entertainment: `${ICON_BASE}/tech.png`,
}

async function run() {
  for (const [slug, icon] of Object.entries(slugToIcon)) {
    await sql`UPDATE category SET icon = ${icon} WHERE slug = ${slug}`
    console.log(`  ✓ ${slug} → ${icon}`)
  }
  console.log('Done.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
