// Quick fix: the seed script picked a basename that lives in Finances/
// (collision), and the reconciler then bounced the Insurance category's
// icon over there. Point it at an actual Insurance/ file.

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const r = await sql`
    UPDATE category
    SET icon = '/icons/cobb/icons/Insurance/home_insurance-003.png'
    WHERE slug = 'insurance'
    RETURNING id, name, icon
  `
  console.log(r)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
