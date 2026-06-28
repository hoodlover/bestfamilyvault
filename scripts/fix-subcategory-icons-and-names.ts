// One-shot:
//  - Rename "Health Insurance Recipes" → "Health Insurance Receipts"
//  - Set explicit icons on the 5 Receipts → LLC subs
//  - Rename "Placeholder, LLC" → "Place of Grace, LLC" (name + slug)
//  - Set explicit finance icon on Auto → Financing
//  - Rename the Vault File Drop\receipts\placeholder folder to place-of-grace
//
// Idempotent — re-runs are no-ops where the target state is already reached.
// Run with: npx tsx --env-file=.env.local scripts/fix-subcategory-icons-and-names.ts

import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const INBOX = String.raw`C:\Users\lance\Documents\Vault File Drop`
const ICON_LLC_BASE = '/icons/cobb/icons/llcs'
const ICON_FINANCES = '/icons/cobb/finances.png'
const ICON_RECEIPTS = '/icons/cobb/icons/Finances/receipts.png'

const llcs: Array<{ id: string; iconFile: string }> = [
  { id: '0c0042b4-2b84-4acf-be6b-9c5fbed0e57d', iconFile: 'ptcllc.png' },        // Path to Change, LLC
  { id: '81e82225-687b-425c-9a70-cd1824e01064', iconFile: 'handlhavens.png' },   // H&L Havens LLC
  { id: 'bdce0fd2-168c-4dfa-b7eb-1646ce1089c5', iconFile: 'cfsllc.png' },        // CFS, LLC
  { id: 'e69ae9ff-c977-4ba9-ad48-48b021899ac6', iconFile: 'ptrchavens.png' },    // PTC Havens, LLC
  { id: 'ceb50579-e1f5-4d1b-af12-0dfb52f942fc', iconFile: 'placeofgrace.png' },  // Placeholder → Place of Grace
]

const HEALTH_REC_ID = '408583a0-ef02-4986-aeaa-9fbc4d3c1a19'
const PLACEHOLDER_ID = 'ceb50579-e1f5-4d1b-af12-0dfb52f942fc'
const AUTO_FINANCING_ID = '23f0fa02-31af-4cf9-abd4-3dc7415260bb'

async function run() {
  // 1. Health Insurance Recipes → Receipts + receipts icon
  await sql`
    UPDATE subcategory
    SET name = 'Health Insurance Receipts',
        slug = 'health-insurance-receipts',
        icon = ${ICON_RECEIPTS}
    WHERE id = ${HEALTH_REC_ID}
  `
  console.log('✓ Renamed "Health Insurance Recipes" → "Health Insurance Receipts"')

  // 2. Auto → Financing: pin the finance icon explicitly
  await sql`
    UPDATE subcategory
    SET icon = ${ICON_FINANCES}
    WHERE id = ${AUTO_FINANCING_ID}
  `
  console.log('✓ Pinned Auto → Financing icon to finances.png')

  // 3. Placeholder, LLC → Place of Grace, LLC (name + slug)
  await sql`
    UPDATE subcategory
    SET name = 'Place of Grace, LLC',
        slug = 'place-of-grace'
    WHERE id = ${PLACEHOLDER_ID}
  `
  console.log('✓ Renamed "Placeholder, LLC" → "Place of Grace, LLC"')

  // 4. Five LLC icons
  for (const llc of llcs) {
    const iconPath = `${ICON_LLC_BASE}/${llc.iconFile}`
    await sql`
      UPDATE subcategory SET icon = ${iconPath} WHERE id = ${llc.id}
    `
    console.log(`  + ${llc.iconFile} → ${llc.id}`)
  }

  // 5. Rename Vault File Drop\receipts\placeholder to place-of-grace
  if (process.platform === 'win32' && fs.existsSync(INBOX)) {
    const oldDir = path.join(INBOX, 'receipts', 'placeholder')
    const newDir = path.join(INBOX, 'receipts', 'place-of-grace')
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir)
      console.log(`✓ Renamed folder placeholder → place-of-grace`)
    } else if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true })
      console.log(`✓ Created folder place-of-grace`)
    } else {
      console.log(`  Folder place-of-grace already exists; left placeholder alone if present`)
    }
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
