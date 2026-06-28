import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

;(async () => {
  const cats = await db.select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories).orderBy(categories.sortOrder)
  for (const c of cats) {
    const subs = await db.select({ id: subcategories.id, name: subcategories.name, slug: subcategories.slug })
      .from(subcategories).where(eq(subcategories.categoryId, c.id))
    console.log(`- ${c.name} (${c.slug})`)
    for (const s of subs) console.log(`    · ${s.name} (${s.slug})`)
  }
  process.exit(0)
})()
