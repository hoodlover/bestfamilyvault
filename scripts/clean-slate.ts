// Destructive reset for a fresh Best Family Vault database.
//
// This truncates app data and seeds a tiny fake dataset so new users can see
// how records relate without exposing any copied family data.
//
// Usage:
//   $env:RESET_CLEAN_SLATE='bestfamilyvault'
//   npm run db:clean-slate

import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
  categories,
  entries,
  mealPlans,
  messages,
  notes,
  shoppingListItems,
  shoppingLists,
  subcategories,
  timeCapsules,
  todoItems,
  todoLists,
  users,
} from '../src/lib/db/schema'

const REQUIRED_CONFIRMATION = 'bestfamilyvault'
const SAMPLE_PASSWORD = 'ChangeMeDemo123!'

function requireConfirmation() {
  if (process.env.RESET_CLEAN_SLATE !== REQUIRED_CONFIRMATION) {
    console.error(
      [
        '',
        '[ABORT] This script wipes the configured database.',
        `Set RESET_CLEAN_SLATE=${REQUIRED_CONFIRMATION} and re-run only after checking DATABASE_URL.`,
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  if (!process.env.DATABASE_URL) {
    console.error('[ABORT] DATABASE_URL is missing.')
    process.exit(1)
  }
}

async function wipeDatabase() {
  await db.execute(sql`TRUNCATE TABLE
    "client_pair_code",
    "client_session",
    "gmail_contact",
    "gmail_link",
    "reminder",
    "todo_item",
    "todo_list",
    "push_subscription",
    "login_attempt",
    "reminders_sent",
    "recurring_suggestion",
    "statement_line_decision",
    "statement_line_item",
    "balance_history",
    "file",
    "letter_release",
    "letter",
    "quick_pick_item",
    "shopping_list_item",
    "shopping_list",
    "meal_plan_recipe",
    "meal_plan",
    "note_favorite",
    "entry_favorite",
    "note",
    "entry",
    "subcategory",
    "category",
    "message",
    "time_capsule",
    "password_reset_token",
    "upgrade_request",
    "invite",
    "verificationToken",
    "session",
    "account",
    "user"
    RESTART IDENTITY CASCADE`)
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(SAMPLE_PASSWORD, 10)
  const inserted = await db
    .insert(users)
    .values([
      { name: 'Demo Owner', email: 'owner@example.com', role: 'superuser', passwordHash },
      { name: 'Demo Partner', email: 'partner@example.com', role: 'admin', passwordHash },
      { name: 'Demo Member', email: 'member@example.com', role: 'member', passwordHash },
    ])
    .returning({ id: users.id, email: users.email })

  return {
    ownerId: inserted.find((u) => u.email === 'owner@example.com')!.id,
    partnerId: inserted.find((u) => u.email === 'partner@example.com')!.id,
    memberId: inserted.find((u) => u.email === 'member@example.com')!.id,
  }
}

async function seedCategories() {
  const categoryRows = await db
    .insert(categories)
    .values([
      {
        name: 'Finances',
        slug: 'finances',
        icon: '/icons/cobb/finances.png',
        color: '#4ade80',
        description: 'Banking, cards, assets, bills, and financial documents',
        sortOrder: 0,
        isDefault: true,
      },
      {
        name: 'Home',
        slug: 'home',
        icon: '/icons/cobb/cab-close.png',
        color: '#fb923c',
        description: 'Utilities, maintenance, insurance, and household records',
        sortOrder: 1,
        isDefault: true,
      },
      {
        name: 'Family',
        slug: 'family',
        icon: '/icons/cobb/family.png',
        color: '#60a5fa',
        description: 'Identity records, school, health, and shared family notes',
        sortOrder: 2,
        isDefault: true,
      },
      {
        name: 'Tech',
        slug: 'tech',
        icon: '/icons/cobb/tech.png',
        color: '#f472b6',
        description: 'Apps, devices, subscriptions, and online services',
        sortOrder: 3,
        isDefault: true,
      },
    ])
    .returning({ id: categories.id, slug: categories.slug })

  const bySlug = Object.fromEntries(categoryRows.map((c) => [c.slug, c.id]))
  const subRows = [
    { categoryId: bySlug.finances, name: 'Checking & Savings', slug: 'checking-savings', sortOrder: 0 },
    { categoryId: bySlug.finances, name: 'Credit Cards', slug: 'credit-cards', sortOrder: 1 },
    { categoryId: bySlug.finances, name: 'Assets', slug: 'assets', sortOrder: 2 },
    { categoryId: bySlug.home, name: 'Utilities', slug: 'utilities', sortOrder: 0 },
    { categoryId: bySlug.home, name: 'Insurance', slug: 'insurance', sortOrder: 1 },
    { categoryId: bySlug.family, name: 'Identity', slug: 'identity', sortOrder: 0 },
    { categoryId: bySlug.family, name: 'Emergency', slug: 'emergency', sortOrder: 1 },
    { categoryId: bySlug.tech, name: 'Logins', slug: 'logins', sortOrder: 0 },
    { categoryId: bySlug.tech, name: 'Apps', slug: 'apps', sortOrder: 1 },
  ]

  const insertedSubs = await db.insert(subcategories).values(subRows).returning({
    id: subcategories.id,
    slug: subcategories.slug,
  })

  return {
    categories: bySlug,
    subcategories: Object.fromEntries(insertedSubs.map((s) => [s.slug, s.id])),
  }
}

async function seedSampleData(ownerId: string, partnerId: string, ids: Awaited<ReturnType<typeof seedCategories>>) {
  const common = { createdBy: ownerId, updatedBy: ownerId, isPrivate: false, isPersonal: false }

  const [bankEntry] = await db
    .insert(entries)
    .values({
      ...common,
      categoryId: ids.categories.finances,
      subcategoryId: ids.subcategories['checking-savings'],
      type: 'bank_account',
      title: 'Sample Household Checking',
      bankName: 'Example Credit Union',
      accountType: 'Checking',
      accountNumber: '0000000000',
      routingNumber: '000000000',
      currentBalance: 245000,
      balanceAsOf: new Date(),
      noteContent: 'Fake sample account for learning the vault layout.',
      isFavorite: true,
    })
    .returning({ id: entries.id })

  await db.insert(entries).values([
    {
      ...common,
      categoryId: ids.categories.tech,
      subcategoryId: ids.subcategories.logins,
      type: 'login',
      title: 'Sample Streaming Login',
      username: 'demo@example.com',
      password: 'FAKE-password-for-demo-only',
      url: 'https://example.com',
      noteContent: 'This is a fake login so the password UI has one harmless example.',
    },
    {
      ...common,
      categoryId: ids.categories.tech,
      subcategoryId: ids.subcategories.apps,
      type: 'app_login',
      title: 'Sample Phone App',
      username: 'demo@example.com',
      password: 'FAKE-app-password',
      url: 'https://app.example.com',
    },
    {
      ...common,
      categoryId: ids.categories.finances,
      subcategoryId: ids.subcategories['credit-cards'],
      type: 'credit_card',
      title: 'Sample Rewards Card',
      cardholderName: 'Demo Owner',
      cardNetwork: 'Visa',
      cardNumber: '4111-1111-1111-1111',
      expiryDate: '12/30',
      cvv: '123',
      currentBalance: -18542,
      balanceAsOf: new Date(),
      noteContent: 'Fake test card number.',
    },
    {
      ...common,
      categoryId: ids.categories.family,
      subcategoryId: ids.subcategories.identity,
      type: 'identity',
      title: 'Sample Identity Record',
      firstName: 'Demo',
      lastName: 'Member',
      dateOfBirth: '2000-01-01',
      ssn: '000-00-0000',
      noteContent: 'Fake identity record showing where important details live.',
    },
    {
      ...common,
      categoryId: ids.categories.finances,
      subcategoryId: ids.subcategories.assets,
      type: 'asset',
      title: 'Sample Vehicle',
      currentBalance: 1250000,
      balanceAsOf: new Date(),
      noteContent: 'Fake asset record with a sample value.',
    },
  ])

  await db.insert(notes).values([
    {
      ...common,
      categoryId: ids.categories.family,
      subcategoryId: ids.subcategories.emergency,
      title: 'Emergency Contacts',
      content: 'Neighbor: Jordan Example, 555-0100\nDoctor: Example Clinic, 555-0101',
      isFavorite: true,
    },
    {
      ...common,
      categoryId: ids.categories.home,
      subcategoryId: ids.subcategories.utilities,
      title: 'Home Shutoff Notes',
      content: 'Water shutoff is in the basement utility closet. This is sample text.',
    },
  ])

  const [todoList] = await db
    .insert(todoLists)
    .values({ userId: ownerId, title: 'Sample Move-In Checklist', isFavorite: true })
    .returning({ id: todoLists.id })

  await db.insert(todoItems).values([
    { listId: todoList.id, text: 'Invite household members', sortOrder: 0 },
    { listId: todoList.id, text: 'Replace fake sample entries with real records', sortOrder: 1 },
    { listId: todoList.id, text: 'Set up password reset email settings', sortOrder: 2 },
  ])

  const [mealPlan] = await db
    .insert(mealPlans)
    .values({ userId: ownerId })
    .returning({ id: mealPlans.id })

  const [shoppingList] = await db
    .insert(shoppingLists)
    .values({ mealPlanId: mealPlan.id, name: 'Sample Grocery List' })
    .returning({ id: shoppingLists.id })

  await db.insert(shoppingListItems).values([
    { mealPlanId: mealPlan.id, shoppingListId: shoppingList.id, text: 'Coffee - 1 bag', isManual: true, sortOrder: 0 },
    { mealPlanId: mealPlan.id, shoppingListId: shoppingList.id, text: 'Milk - 1 gallon', isManual: true, sortOrder: 1 },
  ])

  await db.insert(messages).values({
    fromUserId: ownerId,
    toUserId: partnerId,
    body: 'Welcome to the sample vault. Replace this with your own family data.',
  })

  await db.insert(timeCapsules).values({
    fromUserId: ownerId,
    toUserId: null,
    title: 'Sample Time Capsule',
    body: 'This fake message unlocks in the future and demonstrates sealed notes.',
    unlockAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  })

  return bankEntry.id
}

async function main() {
  requireConfirmation()

  console.log('Wiping configured database...')
  await wipeDatabase()

  console.log('Seeding starter users...')
  const { ownerId, partnerId } = await seedUsers()

  console.log('Seeding starter categories...')
  const ids = await seedCategories()

  console.log('Seeding fake sample records...')
  await seedSampleData(ownerId, partnerId, ids)

  console.log('')
  console.log('Clean slate ready.')
  console.log(`Sample logins use password: ${SAMPLE_PASSWORD}`)
  console.log('  owner@example.com    superuser')
  console.log('  partner@example.com  admin')
  console.log('  member@example.com   member')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
