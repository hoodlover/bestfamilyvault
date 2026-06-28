import { db } from './index'
import { categories, subcategories } from './schema'

const defaultCategories = [
  {
    name: 'Finances',
    slug: 'finances',
    icon: '/icons/cobb/finances.png',
    color: '#4ade80',
    description: 'Bank accounts, cards, investments, taxes, and financial records',
    sortOrder: 0,
    subs: ['Checking & Savings', 'Credit Cards', 'Investments', 'Loans & Mortgages', 'Taxes'],
  },
  {
    name: 'Our Places',
    slug: 'home',
    icon: '/icons/cobb/cab-close.png',
    color: '#fb923c',
    description: 'Utilities, insurance, appliances, and home services',
    sortOrder: 1,
    subs: ['Utilities', 'Insurance', 'Appliances', 'Security', 'HOA'],
  },
  {
    name: 'Family',
    slug: 'family',
    icon: '/icons/cobb/family.png',
    color: '#60a5fa',
    description: 'School, activities, records, and family accounts',
    sortOrder: 2,
    subs: ['School', 'Activities', 'Medical', 'Entertainment'],
  },
  {
    name: 'Health',
    slug: 'health',
    icon: '/icons/cobb/health.png',
    color: '#f87171',
    description: 'Medical records, insurance, prescriptions, and providers',
    sortOrder: 3,
    subs: ['Insurance', 'Doctors', 'Prescriptions', 'Dental', 'Vision'],
  },
  {
    name: 'Auto',
    slug: 'auto',
    icon: '/icons/cobb/mav-river-icon.png',
    color: '#facc15',
    description: 'Vehicles, insurance, and maintenance records',
    sortOrder: 4,
    subs: ['Insurance', 'Registration', 'Maintenance', 'Financing'],
  },
  {
    name: 'Documents',
    slug: 'documents',
    icon: '/icons/cobb/documents.png',
    color: '#c084fc',
    description: 'Important files, IDs, policies, and legal records',
    sortOrder: 5,
    subs: ['IDs', 'Legal', 'Insurance', 'Taxes', 'Receipts'],
  },
  {
    name: 'Travel',
    slug: 'travel',
    icon: '/icons/cobb/travel.png',
    color: '#38bdf8',
    description: 'Passports, frequent flyer, hotels, and travel accounts',
    sortOrder: 6,
    subs: ['Airlines', 'Hotels', 'Car Rentals', 'Passports & Visas'],
  },
  {
    name: 'Tech',
    slug: 'tech',
    icon: '/icons/cobb/tech.png',
    color: '#f472b6',
    description: 'Streaming, devices, subscriptions, and technology accounts',
    sortOrder: 7,
    subs: ['Streaming', 'Devices', 'Gaming', 'Memberships'],
  },
]

export async function seedCategories() {
  console.log('Seeding categories...')

  for (const cat of defaultCategories) {
    const { subs, ...catData } = cat

    const existing = await db.query.categories.findFirst({
      where: (c, { eq }) => eq(c.slug, catData.slug),
    })

    if (existing) {
      console.log(`  Category "${catData.name}" already exists, skipping.`)
      continue
    }

    const [inserted] = await db
      .insert(categories)
      .values({ ...catData, isDefault: true })
      .returning()

    for (let i = 0; i < subs.length; i++) {
      const subName = subs[i]
      await db.insert(subcategories).values({
        categoryId: inserted.id,
        name: subName,
        slug: subName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sortOrder: i,
      })
    }

    console.log(`  Seeded: ${catData.name} (${subs.length} subcategories)`)
  }

  console.log('Done!')
}

// Run directly: npx tsx src/lib/db/seed.ts
if (require.main === module) {
  seedCategories()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
