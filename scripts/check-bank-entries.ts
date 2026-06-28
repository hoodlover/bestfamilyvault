import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { ilike, or } from 'drizzle-orm'

async function main() {
  const targets = ['0202', '0695', '2517', '0254', '0262', 'BofA', 'Bank of America', 'Axos']
  for (const t of targets) {
    const rows = await db
      .select({ id: entries.id, title: entries.title, type: entries.type })
      .from(entries)
      .where(ilike(entries.title, `%${t}%`))
    console.log(`\n[${t}] → ${rows.length} matches:`)
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.type.padEnd(13)} ${r.title}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
