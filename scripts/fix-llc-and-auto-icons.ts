// One-shot:
//  - Auto category icon → autofiles.png
//  - CFS LLC → Startup Docs icon → company_startup_doc.png
//  - CFS LLC → Taxes RENAMED to "Tax Filings" + quarterlies.png icon
//  - CFS LLC → new "IRS" subcategory with irspaperwork.png icon
//
// All file paths target /icons/cobb/icons/llcs/ — Lance will drop the
// PNGs there. The DB updates land now; the images render as soon as
// the files are in place.
//
// Idempotent — re-runs are no-ops.
// Run with: npx tsx --env-file=.env.local scripts/fix-llc-and-auto-icons.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// All LLC paperwork icons live at public/ root.
const ICON_BASE = ''

const AUTO_CAT_ID = '01bc8431-ae7a-4b77-9ade-17e35008433e'
const CFS_LLC_CAT_ID = '9582a430-539a-4940-aa47-c3354f42e21a'
const STARTUP_DOCS_ID = 'de223c03-3389-44eb-a21d-01efafcf3ba9'
const CFS_TAXES_ID = 'e9d68bf9-5dd2-4217-9f94-20e24b74e176'

async function run() {
  // 1. Auto category icon
  await sql`UPDATE category SET icon = ${`${ICON_BASE}/autofiles.png`} WHERE id = ${AUTO_CAT_ID}`
  console.log('✓ Auto category → autofiles.png')

  // 2. Startup Docs icon
  await sql`UPDATE subcategory SET icon = ${`${ICON_BASE}/company_startup_doc.png`} WHERE id = ${STARTUP_DOCS_ID}`
  console.log('✓ CFS LLC → Startup Docs → company_startup_doc.png')

  // 3. Taxes → Tax Filings + quarterlies icon
  await sql`
    UPDATE subcategory
    SET name = 'Tax Filings',
        slug = 'tax-filings',
        icon = ${`${ICON_BASE}/quarterlies.png`}
    WHERE id = ${CFS_TAXES_ID}
  `
  console.log('✓ CFS LLC → Taxes renamed to "Tax Filings", quarterlies.png icon')

  // 4. New "IRS" sub under CFS LLC (skip if it already exists from a prior run)
  const existingIrs = (await sql`
    SELECT id FROM subcategory WHERE category_id = ${CFS_LLC_CAT_ID} AND slug = 'irs'
  `) as Array<{ id: string }>
  if (existingIrs.length === 0) {
    const idRow = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
    const newId = idRow[0].id
    // Sort it after Tax Filings — pick a high sort_order to avoid colliding.
    await sql`
      INSERT INTO subcategory (id, category_id, name, slug, icon, sort_order)
      VALUES (${newId}, ${CFS_LLC_CAT_ID}, 'IRS', 'irs', ${`${ICON_BASE}/irspaperwork.png`}, 99)
    `
    console.log(`✓ Created CFS LLC → IRS (id=${newId})`)
  } else {
    console.log('  CFS LLC → IRS already exists; left as-is')
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
