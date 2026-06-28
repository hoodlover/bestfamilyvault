import { db } from '@/lib/db'
import { categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const iconMap: Record<string, string> = {
  auto: '/icons/cobb/mav-river-icon.png',
  business: '/icons/cobb/documents.png',
  documents: '/icons/cobb/documents.png',
  entertainment: '/icons/cobb/tech.png',
  family: '/icons/cobb/family.png',
  finance: '/icons/cobb/finances.png',
  finances: '/icons/cobb/finances.png',
  health: '/icons/cobb/health.png',
  home: '/icons/cobb/cab-close.png',
  kids: '/icons/cobb/family.png',
  notes: '/icons/cobb/notes.png',
  passwords: '/icons/cobb/passwords.png',
  pets: '/icons/cobb/pets.png',
  properties: '/icons/cobb/cab-close.png',
  shopping: '/icons/cobb/shopping.png',
  tech: '/icons/cobb/tech.png',
  travel: '/icons/cobb/travel.png',
}

async function main() {
  for (const [slug, icon] of Object.entries(iconMap)) {
    const result = await db
      .update(categories)
      .set({ icon })
      .where(eq(categories.slug, slug))
      .returning({ name: categories.name })

    if (result.length) {
      console.log(`  Updated ${result[0].name} → ${icon}`)
    } else {
      console.log(`  Not found: ${slug}`)
    }
  }
  console.log('Done!')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
