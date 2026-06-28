import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  pgEnum,
  primaryKey,
  json,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Phase 2 financial-intel types ───────────────────────────────────────────
// Shape of the recent_activity column on entries — extracted from the
// most recently imported statement.
export interface RecentActivity {
  date: string         // ISO YYYY-MM-DD
  description: string  // 1-line summary of the transaction
  amountCents: number  // signed; negative for debits, positive for credits
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['superuser', 'admin', 'member', 'readonly'])

export const entryTypeEnum = pgEnum('entry_type', [
  'login',
  // Mobile / desktop app credential. Same shape as `login` (username +
  // password + optional URL) but tagged so it lists separately on /apps
  // and shows with its own App icon. Schema additions like this require
  // running scripts/migrate-app-login-enum.ts once against the live DB.
  'app_login',
  'note',
  'document',
  'bank_account',
  'credit_card',
  'identity',
  // Physical / non-account holdings (house, car, jewelry, etc.). Tracked
  // via the same currentBalance + balance_history plumbing as bank_account
  // — each "appraisal" the user records is one balance_history snapshot.
  'asset',
])

export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'expired'])

// Decision Lance attaches to a statement line in /reconcile. The values
// drive both UI chips and the eventual 1120-S / 1040 export buckets:
//   - matched: deductible business expense with a receipt attached
//   - no_receipt_needed: business expense where keeping a receipt isn't
//                        needed (recurring sub already-tracked, IRS < $75
//                        threshold, etc.)
//   - personal: not a business expense, attribute to the household
//   - transfer: internal money movement (Bluevine → BofA), excluded from
//               P&L entirely
//   - atm_cash: ATM withdrawal — cash is then accounted for via its own
//               paper trail, distinct from "personal" so the 1120-S
//               documentation can show "cash withdrawn vs. cash spent"
export const decisionEnum = pgEnum('statement_line_decision_kind', [
  'matched',
  'no_receipt_needed',
  'personal',
  'transfer',
  'atm_cash',
])

export const upgradeRequestStatusEnum = pgEnum('upgrade_request_status', [
  'pending',
  'handled',
  'dismissed',
])

// ─── Auth Tables (NextAuth / DrizzleAdapter compatible) ───────────────────────

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  // Untransformed avatar source — kept so users can re-crop without re-uploading
  imageOriginal: text('image_original'),
  // App-specific fields
  role: roleEnum('role').notNull().default('member'),
  passwordHash: text('password_hash'),
  invitedBy: text('invited_by'),
  // Used by the dashboard birthday banner ("Happy birthday, X!" on the day)
  // and family-wide notice ("Today is Sydney's birthday"). Stored as a date
  // so timezone shifts can't move someone's birthday off by a day.
  dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
  phone: text('phone'),
  address: text('address'),
  ssn: text('ssn'),
  driversLicense: text('drivers_license'),
  // Surfaces in the Family Info popout next to the DL number so the
  // family can see at-a-glance which licenses are about to expire.
  // Stored as YYYY-MM-DD text (matches the existing date-input pattern
  // used for purchase/asset dates) — no migration headache. Nullable.
  driversLicenseExpiry: text('drivers_license_expiry'),
  passport: text('passport'),
  // Parents-only date — Family Info popout shows this on rows where
  // isParent is true (Lance + Heather). YYYY-MM-DD text, same shape as
  // the new driversLicenseExpiry above. Nullable for non-parents.
  anniversary: text('anniversary'),
  // Voice-memo egg: a short audio clip (5–30s) that plays when someone
  // 5-taps this user's family avatar. URL points at a private Vercel Blob;
  // playback goes through /api/voice-memos/{userId} so the blob stays auth'd.
  voiceMemoBlobUrl: text('voice_memo_blob_url'),
  voiceMemoContentType: text('voice_memo_content_type'),
  // Phase 2: opaque per-user token for the read-only iCal feed at
  // /api/calendar/feed/<token>.ics. Calendar apps subscribe by URL; this
  // token IS the auth — keep it secret-ish (never logged, regenerable
  // from settings). Null until the user generates one.
  calendarToken: text('calendar_token').unique(),
  // Per-user accent theme. One of: forest (default — closest to the
  // original emerald), crimson, midnight, harvest. Drives a data-theme
  // attribute on the html root which swaps CSS-variable accent ramps.
  themeAccent: text('theme_accent').notNull().default('forest'),
  // Per-user ordering of the mobile tools-drawer tiles. Array of stable
  // tile keys (see TOOL_DRAWER_TILES in mobile-tools-drawer.tsx). When
  // null, the default order from that file is used. Long-press + drag
  // reorder on the drawer writes here via saveToolDrawerOrder().
  // Unknown keys are filtered on read; new tiles missing from a user's
  // saved order get appended to the end so adding a tile in code
  // doesn't break existing personalisation.
  toolDrawerOrder: text('tool_drawer_order').array(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
})

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  })
)

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
)

// ─── Invites ──────────────────────────────────────────────────────────────────

export const invites = pgTable('invite', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  role: roleEnum('role').notNull().default('member'),
  status: inviteStatusEnum('status').notNull().default('pending'),
  invitedBy: text('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  acceptedAt: timestamp('accepted_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

// ─── Upgrade Requests ─────────────────────────────────────────────────────────

export const upgradeRequests = pgTable('upgrade_request', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  message: text('message').notNull().default(''),
  requestedRole: roleEnum('requested_role'),
  status: upgradeRequestStatusEnum('status').notNull().default('pending'),
  handledBy: text('handled_by').references(() => users.id, { onDelete: 'set null' }),
  handledAt: timestamp('handled_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

// ─── Password reset tokens ────────────────────────────────────────────────────
//
// Self-serve email-based reset flow. The plaintext token only ever lives in
// the URL we mail to the user; the DB stores its SHA-256 hash so a database
// leak can't be replayed into account takeover. One-time use (consumedAt is
// stamped when the token is redeemed); 1-hour expiry.

export const passwordResetTokens = pgTable(
  'password_reset_token',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: index('password_reset_token_hash_idx').on(t.tokenHash),
  })
)

// ─── Time capsules ────────────────────────────────────────────────────────────
//
// Sealed messages with a future unlock date. fromUserId always set; toUserId
// nullable so a capsule can be addressed to "all family" (toUserId = null +
// any family member can read after unlock). Body is encrypted at rest using
// the same envelope as notes — keeps the DB unreadable even if the unlock
// date hasn't arrived yet.

export const timeCapsules = pgTable(
  'time_capsule',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    unlockAt: timestamp('unlock_at', { mode: 'date' }).notNull(),
    // Set the first time the recipient views the capsule after it has unlocked.
    // Lets us show "first opened on…" to the sender as a soft read-receipt.
    firstReadAt: timestamp('first_read_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    toUserIdx: index('time_capsule_to_user_idx').on(t.toUserId),
    unlockAtIdx: index('time_capsule_unlock_at_idx').on(t.unlockAt),
  })
)

// ─── Messages (family in-app messaging) ───────────────────────────────────────

export const messages = pgTable(
  'message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Body is nullable to allow voice-only messages. The send action
    // requires either body or voiceMemoBlobUrl to be present.
    body: text('body'),
    voiceMemoBlobUrl: text('voice_memo_blob_url'),
    voiceMemoContentType: text('voice_memo_content_type'),
    voiceMemoDurationSec: integer('voice_memo_duration_sec'),
    readAt: timestamp('read_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    toUserIdx: index('message_to_user_idx').on(t.toUserId),
    toUnreadIdx: index('message_to_unread_idx').on(t.toUserId, t.readAt),
  })
)

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable('category', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  icon: text('icon'),
  color: text('color'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

export const subcategories = pgTable(
  'subcategory',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // Optional parent for two-level nesting. Used by recipes: Holidays
    // is a parent, Christmas/Easter/Thanksgiving point to it via this
    // column. Null for top-level subcategories. Only one level of
    // nesting is supported (no grandchildren).
    parentSubcategoryId: text('parent_subcategory_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon'),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    categorySlugIdx: index('subcategory_category_slug_idx').on(t.categoryId, t.slug),
    parentIdx: index('subcategory_parent_idx').on(t.parentSubcategoryId),
  })
)

// ─── Entries ──────────────────────────────────────────────────────────────────

export const entries = pgTable(
  'entry',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    subcategoryId: text('subcategory_id').references(() => subcategories.id, {
      onDelete: 'set null',
    }),
    // Optional LLC tag — points at an LLC subcategory under the Receipts
    // category (Path to Change, H&L Havens, CFS, PTC Havens, Place of
    // Grace). Orthogonal to category/subcategory: a bank_account stays
    // filed under Finances > Checking & Savings AND gets tagged with its
    // LLC so detected recurring charges + statement attachments inherit
    // the LLC association. Null on personal accounts.
    llcSubcategoryId: text('llc_subcategory_id').references(() => subcategories.id, {
      onDelete: 'set null',
    }),
    type: entryTypeEnum('type').notNull(),
    title: text('title').notNull(),
    // Login fields
    username: text('username'),
    password: text('password'), // TODO Tier 2: encrypt — currently plaintext
    // Stamped only when the password field actually changes (manual edit
    // or extension capture) — not on title/url/note edits — so the card
    // can show "password last updated YYYY-MM-DD" accurately. NULL on
    // legacy rows; display layer falls back to updatedAt for those until
    // the next password change stamps a real value.
    passwordUpdatedAt: timestamp('password_updated_at', { mode: 'date' }),
    url: text('url'),
    // Note fields (also used for entry-level notes)
    noteContent: text('note_content'),
    // Bank account fields
    bankName: text('bank_name'),
    accountType: text('account_type'),
    accountNumber: text('account_number'), // ENCRYPTED at rest (see ENTRY_ENCRYPTED_FIELDS in lib/crypto.ts) — any SQL ILIKE against this column matches ciphertext, not plaintext. Decrypt with decryptEntries before reading.
    routingNumber: text('routing_number'), // ENCRYPTED — see accountNumber above.
    // Credit card fields
    cardholderName: text('cardholder_name'),
    cardNumber: text('card_number'), // ENCRYPTED — see accountNumber above.
    expiryDate: text('expiry_date'),
    cvv: text('cvv'), // TODO Tier 2: encrypt — currently plaintext
    cardNetwork: text('card_network'),
    // Identity fields
    firstName: text('first_name'),
    lastName: text('last_name'),
    dateOfBirth: text('date_of_birth'),
    ssn: text('ssn'), // TODO Tier 2: encrypt — currently plaintext
    passport: text('passport'), // TODO Tier 2: encrypt — currently plaintext
    driversLicense: text('drivers_license'), // TODO Tier 2: encrypt — currently plaintext
    // Contact phone — used by login / credit_card / bank_account / note types
    // for the customer-service or contact number tied to the entry.
    phone: text('phone'),
    // Generic extra data
    customFields: json('custom_fields').$type<Record<string, string>>(),
    tags: text('tags').array(),
    // Grouped entries — child entries point to a parent
    parentEntryId: text('parent_entry_id'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    // Per-entry opt-in: when true and the browser extension finds EXACTLY
    // ONE entry matching the page's registrable domain, it fills the
    // username + password the moment the page settles — no click on the
    // green pill required. Defaults off because silent autofill defeats
    // the click-as-anti-phishing-checkpoint; users turn it on per entry
    // (typically sites they hit dozens of times a day).
    autofillOnLoad: boolean('autofill_on_load').notNull().default(false),
    // When true, this entry is a recurring bill / subscription — surfaces
    // on the /subscriptions page regardless of which subcategory the entry
    // is filed under. Removing it there just unflags this column; the entry
    // stays in its original category. Avoids duplicate entries when a card
    // also bills monthly (e.g. a Netflix login that's both an Entertainment
    // login AND a recurring charge).
    isRecurring: boolean('is_recurring').notNull().default(false),
    // Optional subscription detail — only meaningful when isRecurring=true.
    // Amount in cents to dodge float-pennies; period describes the cadence
    // ('monthly' | 'yearly' | 'one_time'); started/renews are stored as
    // 'YYYY-MM-DD' to match the existing dateOfBirth / expiryDate text-date
    // pattern in this table.
    subscriptionAmountCents: integer('subscription_amount_cents'),
    subscriptionPeriod: text('subscription_period'),
    subscriptionStartedAt: text('subscription_started_at'),
    subscriptionRenewsAt: text('subscription_renews_at'),
    // Phase 2: financial intel extracted from imported statements.
    // currentBalance is signed cents — positive for assets (savings,
    // brokerage), negative for debts (credit-card balance owed).
    // Updated whenever a statement is auto-imported via the inbox.
    currentBalance: integer('current_balance'),
    balanceAsOf: timestamp('balance_as_of', { mode: 'date' }),
    recentActivity: jsonb('recent_activity').$type<RecentActivity[]>(),
    // Plaid connection state — populated when the user links this
    // entry to a bank login through the Plaid widget. plaidItemId
    // identifies the Plaid "Item" (bank login); plaidAccountId pins
    // to a specific account inside that Item (since one Plaid Item
    // can hold multiple accounts and we want this entry to mirror
    // just one). plaidAccessToken is encrypted at rest with the same
    // crypto.encrypt the other secret fields use. plaidCursor stores
    // the last sync position so transactions/sync only returns new
    // rows on each subsequent call. plaidSyncedAt is the timestamp
    // of the most recent successful sync, surfaced in the UI.
    plaidItemId: text('plaid_item_id'),
    plaidAccessToken: text('plaid_access_token'),
    plaidAccountId: text('plaid_account_id'),
    plaidCursor: text('plaid_cursor'),
    plaidSyncedAt: timestamp('plaid_synced_at', { mode: 'date' }),
    isPrivate: boolean('is_private').notNull().default(false), // superuser only
    isPersonal: boolean('is_personal').notNull().default(false), // strictly owner-only — superusers do NOT bypass
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index('entry_category_idx').on(t.categoryId),
    typeIdx: index('entry_type_idx').on(t.type),
    privateIdx: index('entry_private_idx').on(t.isPrivate),
    personalIdx: index('entry_personal_idx').on(t.isPersonal),
    parentIdx: index('entry_parent_idx').on(t.parentEntryId),
  })
)

// ─── Notes ────────────────────────────────────────────────────────────────────

export const notes = pgTable(
  'note',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    subcategoryId: text('subcategory_id').references(() => subcategories.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    tags: text('tags').array(),
    // Recipe yield. Only meaningful when the note is filed under the
    // recipes category — null on every other note.
    servings: integer('servings'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    isPrivate: boolean('is_private').notNull().default(false),
    isPersonal: boolean('is_personal').notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index('note_category_idx').on(t.categoryId),
    personalIdx: index('note_personal_idx').on(t.isPersonal),
  })
)

// ─── Per-user favorites ──────────────────────────────────────────────────────
//
// Each user has their own favorites list. The legacy entries.is_favorite /
// notes.is_favorite columns are kept around so any read paths that haven't
// been migrated yet keep returning something sensible — but the source of
// truth is now these join tables.

export const entryFavorites = pgTable(
  'entry_favorite',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userEntryIdx: uniqueIndex('entry_fav_user_entry_idx').on(t.userId, t.entryId),
    userIdx: index('entry_fav_user_idx').on(t.userId),
  })
)

export const noteFavorites = pgTable(
  'note_favorite',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userNoteIdx: uniqueIndex('note_fav_user_note_idx').on(t.userId, t.noteId),
    userIdx: index('note_fav_user_idx').on(t.userId),
  })
)

// ─── Meal plan (singleton per user) ──────────────────────────────────────────
//
// One mealPlan row per user, lazy-inserted on first /meal-plan visit. Holds
// her current week's picks (mealPlanRecipes) and the resolved shopping list
// (shoppingListItems). The plan is overwritten in place; we don't keep a
// historical archive — start fresh by clearing.

export const mealPlans = pgTable(
  'meal_plan',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Normalized ingredient names (e.g. "flour", "olive oil") the user
    // has explicitly OPTED INTO buying — "yes, put this on the grocery
    // list". Auto-rows default to UNCHECKED (not on the list); the user
    // ticks each one she wants to actually buy. Selections survive
    // recipe scale changes because the merger preserves itemKey.
    //
    // (Legacy `skipped_item_keys` column is left in place for one
    // release while live data drains — it's no longer read or written
    // by app code, but the migration script doesn't drop columns to
    // avoid losing data in case of rollback.)
    selectedItemKeys: text('selected_item_keys').array(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('meal_plan_user_idx').on(t.userId),
  })
)

export const mealPlanRecipes = pgTable(
  'meal_plan_recipe',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mealPlanId: text('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    // Multiplier on the recipe's stated servings. Stored as float so we
    // can do half-recipes (0.5×) and 1.5×, 2.5×, etc. Stepper in the UI
    // moves in 0.5 increments from 0.5 up to 10.
    scale: real('scale').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    planRecipeIdx: uniqueIndex('mpr_plan_recipe_idx').on(t.mealPlanId, t.recipeId),
  })
)

// Named shopping lists within a single meal plan. Each meal plan
// auto-gets one "From Meal Plan" list (isAutoMealPlan = true) where
// recipe-derived auto-rows and the legacy single-list manual items
// land. Users can create additional named lists ("Heather's weekly",
// "Daughter's snacks", "Costco run", …) that coexist; the grocery
// view switches between them via ?list=<id>.
export const shoppingLists = pgTable(
  'shopping_list',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mealPlanId: text('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Exactly one list per meal_plan is the auto list — it's the
    // destination for recipe-generated rows + survives clearMealPlan
    // (which only wipes its own items). User-created lists have
    // isAutoMealPlan = false and CAN be deleted entirely.
    isAutoMealPlan: boolean('is_auto_meal_plan').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    planIdx: index('shopping_list_plan_idx').on(t.mealPlanId),
  })
)

// NOTE: shoppingListItems also indexes mealPlanId; renamed to
// shopping_list_item_plan_idx (was shopping_list_plan_idx — pre-existing
// copy-paste duplicate that drizzle-kit push refused to apply once a
// second table referencing the same index name landed in the diff).

export const shoppingListItems = pgTable(
  'shopping_list_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mealPlanId: text('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    // Which named list this row belongs to. Backfilled to the meal
    // plan's auto-list during the multi-list migration; new code
    // ALWAYS sets this explicitly. The mealPlanId column above is now
    // redundant (the list itself points at the plan) but kept for one
    // release to avoid breaking older deployments mid-rollout.
    shoppingListId: text('shopping_list_id')
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    // Display text — e.g. "2 cups flour" for a merged auto-row, or "paper
    // towels" for a manual entry.
    text: text('text').notNull(),
    // Normalized ingredient name from the parser ("flour", "olive oil").
    // Auto-rows only; null for manual entries. Used to (1) preserve the
    // user's skip choice across regenerations even when scaling changes
    // the display text, and (2) match merged rows back to the parent
    // mealPlans.skippedItemKeys set.
    itemKey: text('item_key'),
    // Recipes that contributed quantities to this row. Empty/null for manual
    // items. When recipes are added/removed/rescaled, all non-manual rows
    // are regenerated; manuals are left alone.
    recipeIds: text('recipe_ids').array(),
    isManual: boolean('is_manual').notNull().default(false),
    purchased: boolean('purchased').notNull().default(false),
    // Higher = lower in the list. Bumped above max when an item is checked,
    // so checked rows demote to the bottom.
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    planIdx: index('shopping_list_item_plan_idx').on(t.mealPlanId),
  })
)

// ─── Quick-Pick staples (shared across the family) ──────────────────────────
//
// Family-wide editable staples list backing the /meal-plan/quick-pick page.
// Seeded once from GROCERY_STAPLES in src/lib/grocery-staples.ts; after
// that any family member can add/edit/delete items via the edit toggle.
// No userId — one shared list for the household so everyone's tweaks
// land in the same place.

export const quickPickItems = pgTable(
  'quick_pick_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    category: text('category').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index('quick_pick_category_idx').on(t.category, t.sortOrder),
  })
)

// Family Letters release-gated content.

export const letters = pgTable(
  'letter',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Recipient slot is identified by a first-name slug (e.g. 'tadan'),
    // NOT a user FK. Two of the kids haven't signed up yet, so we can't bind
    // to user accounts at letter-creation time. The /letters page filters
    // letters for non-superusers by matching this slug to their account's
    // first name (see recipientSlugForUserName in lib/letters-recipients.ts).
    // Source of truth for allowed slugs is LETTER_RECIPIENTS.
    recipientName: text('recipient_name').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''), // TODO Tier 2: encrypt — currently plaintext
    fileUrl: text('file_url'),
    fileName: text('file_name'),
    contentType: text('content_type'),
    size: integer('size'),
    // Letter type:
    //   'gift'    = parent → kid letters (legacy default; release-gated by
    //               letterRelease singleton — visible only to superuser
    //               until releasedAt is in the past, then visible to the
    //               named kid).
    //   'note-to' = direct private letter (kid → parent typically). Only
    //               author + named recipient see it. Other family members
    //               (including superuser) cannot — privacy partition.
    direction: text('direction').notNull().default('gift'),
    // Optional time-lock: if set + in future, the recipient sees a locked
    // placeholder ("unlocks YYYY-MM-DD") instead of the content. Author
    // and superuser still see the full content.
    unlockAt: timestamp('unlock_at', { mode: 'date' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    recipientIdx: index('letter_recipient_idx').on(t.recipientName),
  })
)

// ─── Letter release gate ─────────────────────────────────────────────────────
//
// One-row table. While `releasedAt` is NULL or in the future, ONLY the
// superuser (Lance) can read letter content; everyone else sees sealed cards
// regardless of first-name match. Once `releasedAt` is set to a past time,
// family members can read letters addressed to their slug.
//
// The trigger that flips this flag (inactivity heartbeat, trusted-contact
// override, etc.) is intentionally not implemented yet — that's a separate
// session. For now the row can be set manually via SQL or a future admin
// action when the time comes.

export const letterRelease = pgTable('letter_release', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  releasedAt: timestamp('released_at', { mode: 'date' }),
  releasedBy: text('released_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
})

// ─── Files (Vercel Blob attachments) ──────────────────────────────────────────

export const files = pgTable('file', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Polymorphic — attach to entry, note, or category
  entryId: text('entry_id').references(() => entries.id, { onDelete: 'cascade' }),
  noteId: text('note_id').references(() => notes.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'cascade' }),
  // Blob metadata
  filename: text('filename').notNull(),
  blobUrl: text('blob_url').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(), // bytes
  // SHA-256 of the original bytes. Nullable for legacy rows uploaded
  // before this column existed — the import-inbox flow uses this to
  // detect statement duplicates so re-dropping the same file just
  // routes to a Duplicates/ folder instead of double-importing.
  contentHash: text('content_hash'),
  // Display rotation for image files, in 90-degree increments
  // (0 / 90 / 180 / 270). The bytes on disk are unchanged; the API
  // route /api/files/[id] applies the rotation via sharp before
  // serving so downstream consumers (/cards thumbnails, the eyeball
  // preview, download) all see the same orientation.
  rotation: integer('rotation').notNull().default(0),
  isPrivate: boolean('is_private').notNull().default(false),
  uploadedBy: text('uploaded_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index('file_uploaded_by_hash_idx').on(t.uploadedBy, t.contentHash),
}))

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  entries: many(entries),
  notes: many(notes),
  files: many(files),
  invitesSent: many(invites),
}))

export const categoriesRelations = relations(categories, ({ many }) => ({
  subcategories: many(subcategories),
  entries: many(entries),
  notes: many(notes),
  files: many(files),
}))

export const subcategoriesRelations = relations(subcategories, ({ one, many }) => ({
  category: one(categories, { fields: [subcategories.categoryId], references: [categories.id] }),
  entries: many(entries),
  notes: many(notes),
}))

export const entriesRelations = relations(entries, ({ one, many }) => ({
  category: one(categories, { fields: [entries.categoryId], references: [categories.id] }),
  subcategory: one(subcategories, { fields: [entries.subcategoryId], references: [subcategories.id] }),
  creator: one(users, { fields: [entries.createdBy], references: [users.id] }),
  files: many(files),
  parent: one(entries, { fields: [entries.parentEntryId], references: [entries.id], relationName: 'grouped' }),
  children: many(entries, { relationName: 'grouped' }),
}))

export const notesRelations = relations(notes, ({ one, many }) => ({
  category: one(categories, { fields: [notes.categoryId], references: [categories.id] }),
  subcategory: one(subcategories, { fields: [notes.subcategoryId], references: [subcategories.id] }),
  creator: one(users, { fields: [notes.createdBy], references: [users.id] }),
  files: many(files),
}))

// ─── Balance history (phase 2 — month-over-month deltas + price-creep) ──────
//
// One row per imported statement that yielded a balance. Lets the
// dashboard show "last month vs this month" deltas and lets the price-
// creep detector compare consecutive recurring-bill amounts.

export const balanceHistory = pgTable(
  'balance_history',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    balanceCents: integer('balance_cents').notNull(),
    periodEnd: timestamp('period_end', { mode: 'date' }).notNull(),
    sourceFileId: text('source_file_id').references(() => files.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    entryPeriodIdx: index('balance_history_entry_period_idx').on(t.entryId, t.periodEnd),
  }),
)

export const filesRelations = relations(files, ({ one }) => ({
  entry: one(entries, { fields: [files.entryId], references: [entries.id] }),
  note: one(notes, { fields: [files.noteId], references: [notes.id] }),
  category: one(categories, { fields: [files.categoryId], references: [categories.id] }),
  uploader: one(users, { fields: [files.uploadedBy], references: [users.id] }),
}))

// ─── Statement line items (Phase 4b) ────────────────────────────────────────
//
// One row per transaction parsed from an imported statement. The
// `recentActivity` JSON blob on entries keeps a 5-row preview for the
// dashboard card; this table keeps the full ledger so the recurring-
// charge detector has enough history to spot patterns.
//
// Dedup is at the (account, postedDate, amount, normalizedMerchant) level
// — re-importing the same statement twice should NOT create duplicates.

export const statementLineItems = pgTable(
  'statement_line_item',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountEntryId: text('account_entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    // The file this transaction was parsed out of — nullable because the
    // backfill script may need to populate without a clear source file
    // mapping. Detached on file delete rather than cascading; we want the
    // historical txn data to survive a file purge.
    sourceFileId: text('source_file_id').references(() => files.id, { onDelete: 'set null' }),
    // YYYY-MM-DD strings to dodge timezone drift in date math.
    statementDate: text('statement_date'),       // when the statement closed (if known)
    postedDate: text('posted_date').notNull(),   // when the txn cleared
    rawDescription: text('raw_description').notNull(),
    normalizedMerchant: text('normalized_merchant').notNull(),
    amountCents: integer('amount_cents').notNull(),  // signed; debits negative
    currency: text('currency').notNull().default('USD'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userMerchantIdx: index('statement_line_item_user_merchant_idx').on(t.userId, t.normalizedMerchant),
    accountDateIdx: index('statement_line_item_account_date_idx').on(t.accountEntryId, t.postedDate),
    dedupIdx: uniqueIndex('statement_line_item_dedup_idx').on(
      t.accountEntryId, t.postedDate, t.amountCents, t.normalizedMerchant,
    ),
  }),
)

// ─── Statement-line decisions (reconciliation, tax prep) ────────────────────
//
// One row per statement line that Lance has explicitly classified on the
// /reconcile page. Most lines won't have a row here — they're either
// auto-classified as recurring (via approved recurring_suggestion) or as
// receipt-matched (via the receipt-entry / customFields heuristics), and
// don't need explicit user input. The rows that DO live here are the
// manual decisions: "this is personal", "this is an internal transfer",
// "this is a receipt-less business expense", "this is a cash withdrawal",
// or an explicit "matched to receipt X" override of the auto-match.
//
// PK is statementLineItemId so each line has at most one decision —
// re-deciding is an upsert. receiptEntryId is only meaningful for
// decision='matched'; nullable so SET NULL on receipt delete doesn't
// orphan the decision row. The decision survives.
export const statementLineDecision = pgTable(
  'statement_line_decision',
  {
    statementLineItemId: text('statement_line_item_id')
      .primaryKey()
      .references(() => statementLineItems.id, { onDelete: 'cascade' }),
    decision: decisionEnum('decision').notNull(),
    receiptEntryId: text('receipt_entry_id').references(() => entries.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    decisionIdx: index('statement_line_decision_decision_idx').on(t.decision),
    receiptIdx: index('statement_line_decision_receipt_idx').on(t.receiptEntryId),
  }),
)

// ─── Recurring-charge suggestions (Phase 4b) ────────────────────────────────
//
// What the weekly detection cron produces. One row per (account, merchant)
// candidate the detector found. Lance reviews on the /subscriptions
// Suggested tab and approves/dismisses; approve materializes a real
// entries row with isRecurring=true so Phase 2's reminder cron picks it
// up automatically.

export const recurringSuggestions = pgTable(
  'recurring_suggestion',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountEntryId: text('account_entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    // Inherited from accountEntry at detection time. Denormalized for query
    // (so the UI can group/filter by LLC without re-joining entries).
    llcSubcategoryId: text('llc_subcategory_id').references(() => subcategories.id, {
      onDelete: 'set null',
    }),
    normalizedMerchant: text('normalized_merchant').notNull(),
    displayName: text('display_name').notNull(),
    typicalAmountCents: integer('typical_amount_cents').notNull(),
    period: text('period').notNull(),       // 'monthly' | 'yearly'
    firstSeenAt: text('first_seen_at').notNull(),    // YYYY-MM-DD
    lastSeenAt: text('last_seen_at').notNull(),
    occurrenceCount: integer('occurrence_count').notNull(),
    predictedNextAt: text('predicted_next_at').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'dismissed'
    // Set when status='approved' — points at the materialized recurring entry.
    approvedEntryId: text('approved_entry_id').references(() => entries.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index('recurring_suggestion_user_status_idx').on(t.userId, t.status),
    // Dedup: at most one suggestion per (account, merchant). Re-runs of the
    // detection cron upsert into the same row — refreshing amount,
    // lastSeenAt, predictedNextAt.
    dedupIdx: uniqueIndex('recurring_suggestion_dedup_idx').on(t.accountEntryId, t.normalizedMerchant),
  }),
)

// ─── Reminder bookkeeping ────────────────────────────────────────────────────
//
// One row per (user, kind, forDate, optional entry) reminder the crons
// have sent. Lets a same-day cron re-run skip pushes it's already fired.
// No FK on entryId — the row should survive entry deletion as historical
// audit ("we DID notify Lance about Netflix on 2026-06-04 even though
// he later archived that entry").
//
// kind values currently in use:
//   'recurring-3d'    — Phase 2: per-entry, 3 days before subscriptionRenewsAt
//   'statement-drop'  — Phase 3: per-user batch, statement(s) overdue

export const remindersSent = pgTable(
  'reminders_sent',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    forDate: text('for_date').notNull(), // YYYY-MM-DD — string keeps date math timezone-free
    entryId: text('entry_id'),            // nullable for batched kinds
    sentAt: timestamp('sent_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('reminders_sent_lookup_idx').on(t.userId, t.kind, t.forDate),
  }),
)

// ─── Web Push subscriptions ──────────────────────────────────────────────────
//
// One row per device the user has opted in to receive push notifications on
// (phone, tablet, desktop). `endpoint` is the per-device URL the browser
// gives us at subscription time — unique across the table so a re-subscribe
// from the same device just upserts. `p256dh` + `auth` are the encryption
// keys web-push uses to sign each send.
//
// `failureCount` increments on 410/404 responses from the push service
// (token revoked). After 3 consecutive failures the row is deleted by
// sendPushToUser() so dead subscriptions don't accumulate.

// ─── Login attempts (Phase: anti-brute-force) ──────────────────────────────
//
// One row per /login submission, succeeded or failed. Read at request
// time to decide whether to throttle this IP / email combo; written
// after every attempt so the count stays current. Pruned daily by a
// cron — rows older than 7 days are dropped to keep the table small.
//
// Also serves as the source of truth for "new-device login alerts":
// after a successful login, we check whether any prior row for the
// same email has the same IP. If not, we email the user.
export const loginAttempts = pgTable(
  'login_attempt',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    // First hop of x-forwarded-for. Stored verbatim — no IPv6
    // normalization — because we just bucket-count, never parse.
    ip: text('ip').notNull(),
    // Lowercased email the user typed. Stored even on failure so the
    // (email, ip) rate-limit can target a specific account; never
    // surface this in error messages.
    email: text('email').notNull(),
    succeeded: boolean('succeeded').notNull(),
    userAgent: text('user_agent'),
    attemptedAt: timestamp('attempted_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    ipTimeIdx: index('login_attempt_ip_time_idx').on(t.ip, t.attemptedAt),
    emailTimeIdx: index('login_attempt_email_time_idx').on(t.email, t.attemptedAt),
  }),
)

export const pushSubscriptions = pgTable(
  'push_subscription',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    lastErrorAt: timestamp('last_error_at', { mode: 'date' }),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (t) => ({
    endpointIdx: uniqueIndex('push_subscription_endpoint_idx').on(t.endpoint),
    userIdx: index('push_subscription_user_idx').on(t.userId),
  }),
)

// ─── Todo lists ──────────────────────────────────────────────────────────────
//
// Standalone checklist feature — separate from the inline checklist
// extension on notes. Each list is its own row; its items live in
// todo_item with a sortOrder column so the user can drag-reorder.
// Title defaults to "<date> To Do" on creation but is editable.

export const todoLists = pgTable(
  'todo_list',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Per-list star / priority float a whole list to the top of /todos.
    // Lance pulled the equivalent toggles off individual items — too
    // noisy at the row level — so the affordance lives on the LIST card
    // instead. Sort order: priority desc → favorite desc → updatedAt desc.
    isFavorite: boolean('is_favorite').notNull().default(false),
    isPriority: boolean('is_priority').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userUpdatedIdx: index('todo_list_user_updated_idx').on(t.userId, t.updatedAt),
  }),
)

export const todoItems = pgTable(
  'todo_item',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    listId: text('list_id')
      .notNull()
      .references(() => todoLists.id, { onDelete: 'cascade' }),
    text: text('text').notNull().default(''),
    isChecked: boolean('is_checked').notNull().default(false),
    // Per-item flags that drive the visual sort order. isPriority floats
    // an item to the top of its list; isFavorite is a softer star (same
    // gold treatment as note/entry favorites). Both binary for now —
    // a multi-tier priority is easy to grow into later by widening the
    // column to integer + remapping the sort.
    isFavorite: boolean('is_favorite').notNull().default(false),
    isPriority: boolean('is_priority').notNull().default(false),
    // 0-based float so insertions between two items can pick a midpoint
    // without renumbering the world. Cron-style refresh of integers
    // happens lazily on save if rows pile up at the same value.
    sortOrder: real('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    listIdx: index('todo_item_list_idx').on(t.listId),
  }),
)

// ─── User-scheduled reminders ────────────────────────────────────────────────
//
// Distinct from remindersSent (which is cron audit bookkeeping). These are
// reminders the USER explicitly set on a note or todo list — "ping me at
// 5pm Friday." The process-reminders cron polls for rows where
// remindAt ≤ now AND sentAt IS NULL, fires a web-push, marks sentAt.
//
// targetKind+targetId is a polymorphic deep-link — when the user taps the
// push notification, sw.js openWindow's the resolved URL ('/notes/X' or
// '/todos/Y'). FKs cascade so deleting the parent cleans the reminder too.

export const reminders = pgTable(
  'reminder',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    noteId: text('note_id').references(() => notes.id, { onDelete: 'cascade' }),
    todoListId: text('todo_list_id').references(() => todoLists.id, { onDelete: 'cascade' }),
    remindAt: timestamp('remind_at', { mode: 'date' }).notNull(),
    sentAt: timestamp('sent_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('reminder_user_idx').on(t.userId),
    // The cron's scan is "remind_at <= now AND sent_at IS NULL ORDER BY
    // remind_at" — a plain b-tree on remind_at is enough since pending
    // rows are the tiny minority by the time the table grows.
    remindAtIdx: index('reminder_remind_at_idx').on(t.remindAt),
  }),
)

export const invitesRelations = relations(invites, ({ one }) => ({
  inviter: one(users, { fields: [invites.invitedBy], references: [users.id] }),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  fromUser: one(users, { fields: [messages.fromUserId], references: [users.id], relationName: 'sender' }),
  toUser: one(users, { fields: [messages.toUserId], references: [users.id], relationName: 'recipient' }),
}))

export const upgradeRequestsRelations = relations(upgradeRequests, ({ one }) => ({
  user: one(users, { fields: [upgradeRequests.userId], references: [users.id], relationName: 'requester' }),
  handler: one(users, { fields: [upgradeRequests.handledBy], references: [users.id], relationName: 'handler' }),
}))

// ─── Gmail Contacts (per-user, two-way sync) ─────────────────────────────────
//
// gmailLinks holds the OAuth tokens + sync state for each user that has
// connected their Gmail. One row per user. gmailContacts is the actual
// per-user contact list, scoped by userId so contacts never bleed across
// the family.

export const gmailLinks = pgTable("gmail_link", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  gmailEmail: text("gmail_email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  // When the access token expires. Refreshed lazily by getGoogleAccessToken.
  accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
  scope: text("scope"),
  // "manual" | "hourly" | "daily" | "weekly". Manual users never get
  // picked up by the cron sweep — they only sync when they tap Sync now.
  syncFrequency: text("sync_frequency").notNull().default("manual"),
  // Opaque People API token for incremental fetches. Null until the first
  // full import succeeds; cleared when Google reports EXPIRED_SYNC_TOKEN
  // (which forces a full re-fetch on the next pull).
  syncToken: text("sync_token"),
  lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
})

export const gmailContacts = pgTable(
  "gmail_contact",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // People API resource name ("people/c12345"). Null for vault-created
    // contacts not yet pushed to Gmail.
    googleResourceName: text("google_resource_name"),
    // Etag from the People API. Sent back on update for optimistic
    // concurrency — Google rejects a stale write so two-way edit conflicts
    // surface as 409s instead of silently clobbering.
    googleEtag: text("google_etag"),

    displayName: text("display_name"),
    givenName: text("given_name"),
    familyName: text("family_name"),
    emails: json("emails").$type<Array<{ value: string; type?: string }>>(),
    phones: json("phones").$type<Array<{ value: string; type?: string }>>(),
    addresses: json("addresses").$type<Array<{ value: string; type?: string }>>(),
    organization: text("organization"),
    jobTitle: text("job_title"),
    birthday: text("birthday"),
    notes: text("notes"),

    // "synced" | "local_created" | "local_modified" | "pending_delete"
    syncStatus: text("sync_status").notNull().default("synced"),
    // Soft-delete marker for the pending_delete state. Hard delete happens
    // only after the People API DELETE round-trips successfully.
    deletedAt: timestamp("deleted_at", { mode: "date" }),

    // Per-row star. Local-only — does not round-trip to Google People API
    // (Google has no equivalent "starred" flag on contacts). Favorited
    // contacts float to the top of /contacts.
    isFavorite: boolean("is_favorite").notNull().default(false),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("gmail_contact_user_idx").on(t.userId),
  })
)


// ─── Client autofill sessions (browser extension + mobile autofill) ──────────
//
// Bearer-token-authenticated clients that talk to /api/clients/*. Each
// paired browser / phone is one row. We hash the token at rest (SHA-256
// is fine — the token is the secret, not the hash) so a DB leak doesn't
// hand out live API tokens. Unique index on token_hash gives O(log n)
// lookup on every request.

export const clientSessions = pgTable(
  "client_session",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Friendly device name, e.g. "Chrome — Lance MacBook"
    name: text("name").notNull(),
    // 'extension' | 'android' | 'ios'
    platform: text("platform").notNull(),
    tokenHash: text("token_hash").notNull(),
    // Bumped on every authenticated request so the settings panel can
    // show "last used 3 minutes ago"
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }),
    // Set when the user revokes; auth middleware rejects revoked rows
    // even though the token hash still matches
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("client_session_user_idx").on(t.userId),
    hashIdx: uniqueIndex("client_session_token_hash_idx").on(t.tokenHash),
  })
)

export const clientPairCodes = pgTable("client_pair_code", {
  // 6-digit string. Primary key so collisions are SQL-level conflicts
  // we can retry around in the route.
  code: text("code").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  // Set when /api/clients/pair/complete uses the code. After this is
  // set the code can never be redeemed again.
  consumedAt: timestamp("consumed_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
})
