// Nested capability inventory. Bullet → number → letter hierarchy.
// Edit this file as features ship; the page renders it generically.
//
// Shape:
//   Section
//     bullets: BulletNode[]
//       text: string
//       children?: BulletNode[]   (numbered)
//         children?: BulletNode[] (lettered a/b/c)

export interface BulletNode {
  text: string
  children?: BulletNode[]
}

export interface Section {
  title: string
  bullets: BulletNode[]
}

export const SECTIONS: Section[] = [
  {
    title: 'Vault Core (Entries)',
    bullets: [
      {
        text: 'Six entry types',
        children: [
          { text: 'Login (sites, apps, accounts with passwords)' },
          { text: 'Note (free-form text + rich formatting)' },
          { text: 'Document (PDF/file storage with metadata)' },
          { text: 'Bank account (institution, account #, routing #, type)' },
          { text: 'Credit card (cardholder, card #, expiry, CVV, network)' },
          { text: 'Identity (name, DOB, SSN, passport, driver\'s license)' },
        ],
      },
      {
        text: 'Privacy flags',
        children: [
          { text: 'isPrivate — superuser-only visibility (default off)' },
          { text: 'isPersonal — owner-only, even superusers don\'t see (default off)' },
          { text: 'Default — visible to all family members with appropriate role' },
        ],
      },
      {
        text: 'Per-user favorites (entry_favorite join table — not global)',
      },
      {
        text: 'Per-entry phone field (customer-service line)',
        children: [
          { text: 'Auto-fills from selected person on login/credit_card/identity types' },
          { text: 'Cleared on recurring entries (merchant phone, not user phone)' },
        ],
      },
      {
        text: 'Grouped / linked credentials',
        children: [
          { text: 'parentEntryId on entries — child entries roll up under a parent' },
          { text: 'Merge Candidates tool finds duplicate-site logins to bundle' },
        ],
      },
      {
        text: 'Custom fields (free-form key/value JSON per entry)',
      },
      {
        text: 'Tags array (free-form string array)',
      },
      {
        text: 'Encryption at rest (AES-256-GCM)',
        children: [
          { text: 'Encrypted columns: password, accountNumber, routingNumber, cvv, cardNumber, ssn, passport, driversLicense, noteContent' },
          { text: 'Non-deterministic IV (re-encrypting same value gives different ciphertext)' },
          { text: 'passwordUpdatedAt timestamp — only bumps on actual change (compares plaintext)' },
        ],
      },
      {
        text: 'LLC tagging on bank/credit-card entries',
        children: [
          { text: 'llcSubcategoryId references Receipts > <LLC> subcategory' },
          { text: 'Statements + detected recurring charges inherit the LLC tag' },
          { text: 'Picker only shows for bank_account / credit_card types' },
          { text: '5 LLCs: Path to Change, H&L Havens, CFS, PTC Havens, Place of Grace' },
        ],
      },
      {
        text: 'Recurring flag',
        children: [
          { text: 'isRecurring boolean on any entry type' },
          { text: 'Surfaces on /subscriptions regardless of category' },
          { text: 'subscriptionAmountCents + subscriptionPeriod (monthly/yearly/one_time)' },
          { text: 'subscriptionStartedAt + subscriptionRenewsAt (YYYY-MM-DD)' },
          { text: 'Paid-with link — connects subscription to credit card' },
        ],
      },
      {
        text: 'Search',
        children: [
          { text: 'Cross-field search (title, username, notes, custom fields, tags)' },
          { text: 'Bottom-nav Find tab' },
          { text: 'API endpoint /api/entries/search' },
          { text: 'Attached-file results show a parent-type chip (Note / Entry / Category) + "in <Parent Title>" so the file\'s owner is obvious at a glance' },
        ],
      },
    ],
  },

  {
    title: 'Passwords & Logins',
    bullets: [
      {
        text: 'Per-login storage',
        children: [
          { text: 'Username + password (encrypted)' },
          { text: 'Site URL' },
          { text: 'Customer-service phone' },
          { text: 'Notes / custom fields' },
        ],
      },
      {
        text: 'Browser extension (Chrome / Edge)',
        children: [
          { text: 'Autofill on matched sites — green pill shows on detected password fields' },
          { text: 'Capture freshly-typed passwords with "Save to vault?" banner' },
          { text: 'Update existing password flow (re-key on the same entry)' },
          { text: 'Picker shows when site matches multiple entries' },
          { text: 'Eye-toggle to reveal passwords in the picker' },
          { text: 'Inspect-field hint when extension can\'t find a recognized input' },
          { text: 'Password generator panel — Copy (now actually wired via clipboardWrite permission), Use, and Save buttons; Save persists immediately and shows an "Open in vault →" link to the new entry editor so it never feels like the save vanished' },
          { text: 'Popup empty-search states show +Password / +Note / +Entry quick-create pills that open the vault\'s new-X form in a new tab' },
          { text: 'Settings → Linked Devices ships a download card: blob-hosted zip of the current extension build + step-by-step Chrome-import + Load-Unpacked + pair instructions. Publish flow: bump extensions/browser/package.json, npm run build, npm run publish:extension (uploads via Vercel Blob)' },
          { text: 'Per-entry "Auto-fill on load" toggle (login + app_login types). When set AND the page has exactly one matching credential, the extension fills the moment the form renders — no green-pill click. Bottom-right toast "Filled X from vault — Undo" gives a 6-second escape hatch. Multi-match domains always defer to the picker' },
        ],
      },
      {
        text: 'Native Android autofill app',
        children: [
          { text: 'Integrates with Android system credential picker' },
          { text: 'BiometricPrompt gate before fill (with PIN fallback)' },
          { text: 'In-process credential cache so picker appears on first focus' },
          { text: 'Native-app autofill via package-name heuristic' },
          { text: '"Search vault" fallback for unmatched sites' },
          { text: 'Capture freshly-typed credentials via system prompt' },
        ],
      },
      {
        text: 'Native iOS autofill (planned)',
        children: [
          { text: 'Same /api/clients credential reuse pattern' },
          { text: 'Blocked on needing a Mac for build' },
        ],
      },
      {
        text: 'Per-device pairing',
        children: [
          { text: 'Pair code flow (/api/clients/pair/start + /complete)' },
          { text: 'Per-device session tokens (client_session table)' },
          { text: 'BiometricPrompt gates each session use' },
          { text: 'Linked-devices settings page — list + revoke' },
        ],
      },
      {
        text: 'Admin cleanup tools',
        children: [
          { text: 'Merge Candidates — find duplicate-site entries by URL match' },
          { text: 'Cleanup Credentials — bulk triage merged groups, auto-flag exact dupes' },
          { text: 'Stale Entry Audit — expired cards, abandoned logins' },
        ],
      },
    ],
  },

  {
    title: 'Bank Accounts & Statements',
    bullets: [
      {
        text: 'Per-account stored fields',
        children: [
          { text: 'Institution name (bankName)' },
          { text: 'Account number (encrypted)' },
          { text: 'Routing number (encrypted)' },
          { text: 'Account type (checking, savings, money market, etc.)' },
          { text: 'Customer-service phone' },
          { text: 'LLC tag (llcSubcategoryId)' },
        ],
      },
      {
        text: 'Bluevine sub-account routing',
        children: [
          { text: '5 pre-seeded sub-accounts (9058 PoG, 6242 PTC Havens, 6628 + 8845 H&L Havens, 6259 personal)' },
          { text: 'Auto-match by Bluevine + last-4 from statement classification' },
          { text: 'Idempotent seed script' },
        ],
      },
      {
        text: 'Statement import via Vault File Drop folder',
        children: [
          { text: 'Drop PDFs into C:\\Users\\lance\\Documents\\Vault File Drop\\' },
          { text: 'Claude classification: institution, last-4, type, date, balance' },
          { text: 'Fuzzy entry match — scoring: last-4 (10pts) > institution (3pts) > account title (1pt) > type-match bonus (2pts)' },
          { text: 'Upload to Vercel Blob, attach to matched entry' },
          { text: 'Move source to Imported\\<year>\\' },
          { text: 'No-match files log to REVIEW.txt' },
        ],
      },
      {
        text: 'Duplicate detection (v160+)',
        children: [
          { text: 'SHA-256 hash on every uploaded file (file.content_hash column)' },
          { text: 'Hash-check BEFORE classification — skips Claude on dups' },
          { text: 'Dup routes to Duplicates\\<year>\\ + sibling .duplicate.txt marker' },
          { text: 'Marker records original filename, entry attached to, original import date' },
        ],
      },
      {
        text: 'Balance extraction',
        children: [
          { text: 'currentBalance (signed cents) + balanceAsOf on entry' },
          { text: 'Only updates if statement is newer than current asOf' },
          { text: 'balance_history table — one row per statement period for charts' },
          { text: 'Source file ID tracked on each history row' },
        ],
      },
      {
        text: 'Asset entries + per-group net-worth filters (v238)',
        children: [
          { text: 'New entry type `asset` — houses, cars, jewelry, etc., manual valueCents on entry' },
          { text: 'Editing the value appends a balance_history snapshot (appraisal log)' },
          { text: 'NetWorthItem.group derived from (type, accountType): checking / savings / ira / investment / bank_other / credit / house / car / asset_other' },
          { text: 'NetWorthCard renders one filter chip per present group + per-row include checkbox' },
          { text: 'Exclusions persist in localStorage (cobbvault:netWorth:excludedGroups / excludedEntryIds) — per device' },
          { text: 'Filtered total shows "· filtered" badge; 30d delta hides while filters are active' },
        ],
      },
      {
        text: 'Vehicular Asset fields + Family Info car-reg link (v259)',
        children: [
          { text: 'Asset entries with kind matching Car/Truck/Boat/Motorcycle/RV/etc. (isVehicularKind in src/components/ui/vehicular-fields-block.tsx) render an extra block: VIN, License Plate, Driver (family dropdown), Insurance Acct #, Registration Expires' },
          { text: 'Fields land in customFields on the entry — no schema change' },
          { text: 'Shared VehicularFieldsBlock component used by both new-entry-form and edit-entry-form so they stay in lockstep' },
          { text: 'Edit page now fetches familyProfiles (id+name) and passes them to EditEntryForm — needed by the Driver dropdown' },
          { text: 'Family Info popout (v258) gains a "Car reg expires" row — getFamilyVitals scans asset entries, maps customFields.driverUserId → earliest registrationExpiry, surfaces under the matched member' },
          { text: 'Earliest expiry wins if a member is set as driver on more than one vehicle — covers families with multiple cars per driver' },
        ],
      },
      {
        text: 'Family Info quick-glance popout (v258)',
        children: [
          { text: 'New dashboard tile "Family Info" (icon: /icons/cobb/icons/system/id_info.png) pairs with Where Is It in a 2-col row above Cards/Contacts' },
          { text: 'Tile opens a modal with a blurred backdrop (bg-stone-950/70 backdrop-blur-md) listing the configured roster' },
          { text: 'Each row shows avatar + name/role + phone, email, birthday, SSN, DL # + DL expires, passport #, anniversary (parents-only), and a one-line address' },
          { text: 'Compact copy-icon at the end of every non-address field (half-opaque, full-opacity on hover, check mark for 1.5s after copy)' },
          { text: 'Schema additions in v258: users.driversLicenseExpiry (text YYYY-MM-DD), users.anniversary (text YYYY-MM-DD). Read via a defensive second query so pre-migration prod still renders the existing fields' },
          { text: '"View card" emerald deep-link to identity entry (match by firstName) — or "Create card" link to /entries/new?type=identity&firstName=... if none exists' },
          { text: 'Header carries an "Updated last: <date>" badge = max users.updatedAt across the matched roster — tells the family at a glance how stale the data is' },
          { text: 'Helper: src/lib/family-vitals.ts returns { members, lastUpdated }. Defensively try/catches the user query so a pre-migration prod still renders an empty popout' },
          { text: 'Member who hasn\'t joined yet shows a small "Not joined yet" amber chip but stays in the list per the standing rule' },
        ],
      },
      {
        text: 'Where Is It — single-page accordion locator (v257 rewrite of the v256 tile grid)',
        children: [
          { text: 'Notes-backed: rows under category slug `where-is-it`, subcategoryId = the area (Cabin / Home / Garage / Office / Shed / Storage / Safe, plus inline-added areas)' },
          { text: '/locate is one accordion-style document — sections per area, click-to-edit rows in place; no separate detail page' },
          { text: 'Thin server actions in entries.ts: createLocateNote, updateLocateNote, deleteLocateNote, createWhereIsItArea (idempotent by slug)' },
          { text: 'Each row state machine: view / editing / new-draft. Enter or blur with both fields filled commits; empty drafts auto-discard' },
          { text: 'Photo flow: file picker → PhotoCropUploader (drag-pan + zoom + canvas render to ≤1024px JPEG quality 0.9) → uploadFile with noteId. Skip-adjust uploads original' },
          { text: '"+ New area" form at bottom: slugifies the name, lands sortOrder 100+ so user areas sit below the seeded 7' },
          { text: 'Search filters across title + content client-side; section headers hide when their visible-row count = 0' },
          { text: 'Global search + Ask the Vault already include where-is-it notes — no extra wiring' },
        ],
      },
      {
        text: 'Transaction extraction (Phase 4b)',
        children: [
          { text: 'Up to 5-row recentActivity JSON snapshot on entry (for dashboard card)' },
          { text: 'Full ledger in statement_line_items table — every txn from every statement' },
          { text: 'Dedup unique index: (account, postedDate, amount, normalizedMerchant)' },
          { text: 'max_tokens=16000 — handles 100+ transaction statements' },
          { text: 'Backfill script for existing PDFs (scripts/backfill-statement-line-items.ts)' },
        ],
      },
      {
        text: 'Statement-drop reminder (Phase 3 cron)',
        children: [
          { text: 'Predicts arrival cadence from last 3-6 historical statements per account' },
          { text: 'Median pairwise interval: 26-34d → monthly, 84-100d → quarterly' },
          { text: 'Sends batched push when ≥1 statement is 2+ days overdue' },
          { text: 'One push per user per day (idempotent via reminders_sent)' },
          { text: 'Accounts with <3 history skipped (insufficient signal)' },
        ],
      },
    ],
  },

  {
    title: 'Credit Cards',
    bullets: [
      {
        text: 'Per-card fields',
        children: [
          { text: 'Cardholder name' },
          { text: 'Card number (encrypted)' },
          { text: 'Expiry (MM/YY or MM/YYYY)' },
          { text: 'CVV (encrypted)' },
          { text: 'Network (Visa / Mastercard / Amex / Discover / Debit / "Your Mom\'s Card")' },
          { text: 'LLC tag' },
        ],
      },
      {
        text: 'Live OCR scanner',
        children: [
          { text: 'Mobile camera → CreditCardScanner component' },
          { text: 'Extracts cardholder, number, expiry, network' },
          { text: 'Photo attached to entry' },
        ],
      },
      {
        text: 'Calendar surfacing',
        children: [
          { text: '30-day expiry warning on /calendar' },
          { text: 'Weekly digest flags expiring cards' },
        ],
      },
      {
        text: '/cards aggregator page',
        children: [
          { text: 'One place to browse every credit card + identity doc across categories' },
          { text: 'Tile shows attached scan thumbnail (or generic icon) + last-4 + network' },
          { text: 'Search filters by title, cardholder, network, last-4, DL #, passport #, owner' },
          { text: 'Expiry badge — red if expired, amber within 60 days' },
          { text: 'Linked from sidebar, mobile drawer, and the dashboard (Cards | Contacts pair)' },
        ],
      },
    ],
  },

  {
    title: 'Identity Documents',
    bullets: [
      {
        text: 'Per-identity fields',
        children: [
          { text: 'First / last name' },
          { text: 'Date of birth (auto-slash format)' },
          { text: 'SSN (encrypted, auto-dash format, copy button)' },
          { text: 'Passport # (encrypted)' },
          { text: 'Driver\'s License # (encrypted)' },
        ],
      },
      {
        text: 'Identity-document OCR scanner',
        children: [
          { text: 'Photo of license / passport → Claude extracts fields' },
          { text: 'Auto-fills firstName, lastName, DOB, SSN, etc.' },
          { text: 'Photo attached as supporting document' },
        ],
      },
      {
        text: 'Per-person picker on entry forms',
        children: [
          { text: 'Pick a family member → auto-fills name, DOB, phone, SSN, passport, DL' },
          { text: 'Defaults to current user' },
        ],
      },
    ],
  },

  {
    title: 'Receipts',
    bullets: [
      {
        text: 'LLC tile view at /receipts',
        children: [
          { text: 'One tile per LLC subcategory under Receipts' },
          { text: 'YTD total + receipt count per LLC' },
          { text: 'Lifetime total in footer' },
          { text: 'Sorted by YTD descending — busiest LLC first' },
          { text: 'Mobile: "Recent" section under By-book — last 5 receipts across all LLCs (store / LLC · date / mono amount), tap to open the entry' },
          { text: 'Cobb Family receipts subcategory auto-seeds on first /receipts/new load (no manual script run required) so personal / household receipts always have a home alongside the LLC buckets' },
        ],
      },
      {
        text: 'Drill-down per LLC tile',
        children: [
          { text: 'Filters entries to that LLC subcategory' },
          { text: 'Shows receipt cards with photo previews' },
        ],
      },
      {
        text: 'Single-receipt form',
        children: [
          { text: 'Snap photo → OCR via Claude Vision (claude-opus)' },
          { text: 'Extracts merchant, totalCents, purchaseDate, itemHint, rawText' },
          { text: 'Auto-categorize via LLC picker' },
          { text: 'Notes for project / reimbursable / who paid' },
        ],
      },
      {
        text: 'Batch receipt entry',
        children: [
          { text: 'Multiple photos attached to same parent entry' },
          { text: 'Each receipt extracted separately into customFields.items' },
        ],
      },
      {
        text: 'Folder routing for bulk drops',
        children: [
          { text: 'Vault File Drop\\receipts\\<llc-slug>\\ → auto-create receipt entry under that LLC' },
          { text: 'Folder name maps to subcategory slug' },
          { text: 'sweepReceiptsSubtree() in import-inbox.ts' },
        ],
      },
    ],
  },

  {
    title: 'Subscriptions & Recurring Charges',
    bullets: [
      {
        text: '/subscriptions page',
        children: [
          { text: 'List of all isRecurring=true entries across every category' },
          { text: 'Monthly-equivalent rollup at the bottom' },
          { text: '14-day warning highlight on upcoming renewals' },
          { text: 'External link icon for entries with a URL' },
          { text: 'Quick-remove button (just unchecks isRecurring, doesn\'t delete entry)' },
          { text: 'Sort pills (URL-driven via ?sort=): Name, Renews next (missing dates sink to bottom), Cost (monthly-equivalent so $120/yr ranks with $10/mo), Payment type (groups by entry.type)' },
          { text: 'Entries without a renewal date show an amber "no renewal date — add one" hint so missing dates are visible at a glance' },
        ],
      },
      {
        text: 'Tabs (when suggestions exist)',
        children: [
          { text: 'Tracked tab — manually marked recurring entries' },
          { text: 'Suggested tab — auto-detected candidates pending review' },
        ],
      },
      {
        text: 'Auto-detection (Phase 4b)',
        children: [
          { text: 'Weekly cron: /api/cron/detect-recurring (Sundays 21:00 UTC)' },
          {
            text: 'Detection algorithm',
            children: [
              { text: '≥3 debits of same normalizedMerchant on same account' },
              { text: 'Monthly: median interval 26-34d, stddev <5d' },
              { text: 'Yearly: median interval 350-380d, stddev <14d' },
              { text: 'Amount stability: MAD <20% of median' },
              { text: 'Skip if existing isRecurring entry fuzzy-matches the merchant' },
            ],
          },
          {
            text: 'Merchant normalization',
            children: [
              { text: 'Lowercase, strip .com / inc / llc / subscription suffixes' },
              { text: 'Trim trailing dates, state codes, 4+ digit IDs' },
              { text: 'Drop *subaccount markers and # references' },
            ],
          },
        ],
      },
      {
        text: 'Suggestion review',
        children: [
          { text: 'One-tap Approve → materializes a real isRecurring entry' },
          { text: 'Inherits categoryId + subcategoryId + llcSubcategoryId from source account' },
          { text: 'subscriptionRenewsAt set to predictedNextAt → Phase 2 reminder picks it up' },
          { text: 'Dismiss → status=dismissed, never re-suggested' },
          { text: 'LLC chip on each card (groups by Path to Change, H&L Havens, etc.)' },
          { text: 'Dashboard banner: "N recurring charges detected" → links to Suggested tab' },
        ],
      },
      {
        text: 'Reminder pipeline',
        children: [
          { text: '3-day-ahead push before each renewal (Phase 2 cron, daily 13:00 UTC)' },
          { text: 'Idempotent via reminders_sent table' },
          { text: 'Push body shows dollar amount when known' },
          { text: 'Tag prevents stacking ("Netflix in 3 days" replaces, not stacks)' },
        ],
      },
    ],
  },

  {
    title: 'Notes',
    bullets: [
      { text: 'Separate notes table (categoryId, subcategoryId, title, content, tags)' },
      { text: 'Recipe-specific shape (servings + recipes/* category)' },
      {
        text: 'Rich text editor (Tiptap)',
        children: [
          { text: 'Bold, italic, underline, highlight' },
          { text: 'Bullet, numbered, and task (checkbox) lists' },
          { text: 'Headings (H1/H2/H3)' },
          { text: 'Blockquote, inline code, code block' },
          { text: 'Undo / redo with keyboard shortcuts' },
          { text: 'Toolbar single-line on mobile (horizontal scroll, no wrap)' },
        ],
      },
      { text: 'Per-note tags' },
      { text: 'Per-note file attachments (polymorphic file.noteId)' },
      { text: 'Favorites + Private + Personal flags (same as entries)' },
      { text: '/notes browser with category filters' },
      { text: 'Mobile redesign: compact title + mono count + 40px add-note icon; always-visible pill search (replaces the desktop toggle). Favorite star color unified to gold (#d8a531) across notes, entries, grouped credentials, and search peek.' },
      { text: 'Delete-checked toolbar button — wipes every ticked taskItem (and drops empty taskLists) in one tap. Disabled when nothing is checked.' },
      {
        text: 'Autosave',
        children: [
          { text: '30-second cadence (was 5min; tightened so phone-screen-off doesn\'t eat edits)' },
          { text: 'Dirty / saved-at indicator' },
          { text: 'Unsaved-changes guard on navigation' },
          { text: 'RichTextEditor onChange wired through useFormAutosave' },
        ],
      },
    ],
  },

  {
    title: 'To Do Lists',
    bullets: [
      { text: 'Standalone /todos feature — separate tables (todo_list + todo_item), separate from inline note checkboxes' },
      { text: 'New-list button creates a list with today\'s date as the default title ("06/15/26 To Do") and jumps straight into the editor' },
      { text: 'Native <input type="checkbox"> on each row (not a custom component) — amber accent, large tap target' },
      { text: 'Auto-focus the "Add an item…" input on open so a fresh list is ready to type into' },
      { text: 'Enter on the new-item input creates and refocuses — chain items without re-tapping' },
      { text: 'Inline title rename (tap title or pencil icon)' },
      { text: 'Delete-checked button clears every ticked row at once' },
      { text: 'Reminders attach to the whole list — push notification deep-links into /todos/[id]' },
      { text: 'sortOrder is a real (float) so insertions between rows can pick a midpoint' },
    ],
  },

  {
    title: 'Recipes',
    bullets: [
      { text: 'Recipe entries with ingredients (parsed), instructions, servings, ratings' },
      { text: '24+ pre-seeded subcategories (Christmas, Slow Cooker, Easter, Poultry, etc.)' },
      {
        text: 'AI features',
        children: [
          { text: 'Recipe import via URL — Claude scrapes the page' },
          { text: 'Recipe search via natural language (claude-sonnet)' },
          { text: 'Ask-a-recipe Q&A' },
          { text: 'Cook-split — divide a recipe into parallel sub-tasks' },
        ],
      },
      { text: 'Servings-based ingredient scaling' },
      { text: 'Photo attachments per recipe' },
      { text: 'Mobile redesign: tight header (title + count + 40px add icon), tagline subline, vertical card-row list with mono abbrev pills. Desktop browse grid preserved at md+.' },
      { text: 'Area-nav pill row at the top of every meal-planning screen — Recipes / This week / Grocery / Quick-pick — so jumping between them is one tap. URL-routed; no client JS.' },
    ],
  },

  {
    title: 'Meal Plan',
    bullets: [
      { text: 'One meal plan per user (unique constraint)' },
      { text: 'Pick recipes for the week (mealPlanRecipes join)' },
      { text: 'Auto-generate shopping list from selected recipes' },
      {
        text: 'Skipped-items memory',
        children: [
          { text: 'Skipped items remembered across regenerations (item_key)' },
          { text: 'Survives scaling changes that alter display text' },
        ],
      },
      { text: 'Manual additions persist (isManual flag)' },
    ],
  },

  {
    title: 'Grocery / Shopping Lists',
    bullets: [
      { text: 'Multi-list support (named lists per meal plan)' },
      { text: 'Auto-rows from recipes + manual rows mixed' },
      { text: 'Recipe contribution tracking (recipeIds array per row)' },
      { text: 'Check-off → auto-demote to bottom (sortOrder bump)' },
      { text: 'Quick-pick staples — family-wide shared list of "always need"' },
      { text: '/meal-plan/quick-pick page for staples management' },
    ],
  },

  {
    title: 'Photos',
    bullets: [
      { text: 'Standalone photo entries (separate from receipts)' },
      { text: 'EXIF capture-date auto-detection (exifr library)' },
      { text: 'Direct upload to Vercel Blob' },
      { text: 'Title + notes + private/personal flags' },
    ],
  },

  {
    title: 'Letters & Time Capsules',
    bullets: [
      {
        text: '"Family Letters"',
        children: [
          { text: 'Text + audio + video letter formats' },
          { text: 'Per-recipient targeting (specific family member or all)' },
          { text: 'Media letter recorder (in-browser audio + video capture)' },
          { text: 'Letter-to-parents panel for cross-generational notes' },
          { text: 'Release rules controlled by Dead Man\'s Switch admin' },
        ],
      },
      {
        text: 'Time capsules',
        children: [
          { text: 'Schedule unlock date in the future' },
          { text: '"Seal capsule" once content is final' },
          { text: 'Family-targeted (one recipient or family-wide)' },
          { text: 'Relative date display ("Unlocks in 6 months on Monday March 5, 2027")' },
        ],
      },
    ],
  },

  {
    title: 'Voice Memos',
    bullets: [
      { text: 'Owner-records-for-family-member workflow' },
      { text: 'Per-user audio storage (separate from messages)' },
      { text: 'Voice memo settings page (superuser only)' },
      { text: 'Browser MediaRecorder API for capture' },
      { text: '/api/voice-memos/[userId] retrieval endpoint' },
    ],
  },

  {
    title: 'Messages',
    bullets: [
      { text: 'User-to-user threaded messages' },
      { text: 'Audio attachments per message (/api/message-audio/[id])' },
      { text: 'Unread tracking (readAt column)' },
      { text: 'Email notification on new message (sendMessageNotificationEmail)' },
      { text: 'Per-recipient inbox view' },
    ],
  },

  {
    title: 'I\'m Dead, Now What? (IDNW)',
    bullets: [
      { text: 'Dedicated top-level category (slug=now-what)' },
      {
        text: 'Fill wizard',
        children: [
          { text: 'Question-by-question prompts' },
          { text: 'Claude-assisted answers ("save and next" workflow)' },
          { text: 'Save Q+A pairs as note rows' },
          { text: 'Attach ANY file type (PDF, doc, photo) to an answer — not just images. The 2025 1040 attaches directly to the tax answer.' },
          { text: 'Multi-file attach: New + attach takes any number of files in one pick (or several picks); each compressed/uploaded against the freshly-created card with per-file failure surfacing' },
          { text: 'Search surfaces entries, notes, AND files (by filename) so a "1040" search finds the PDF\'s parent entry' },
          { text: 'Multi-select linked cards: picking a card no longer overwrites the typed answer — picks accumulate as chips and serialize as `Answer — [Card1](href), [Card2](href)` (links-only entries also allowed)' },
          { text: 'Labels updated: "Save a new entry or note (and attach a file)" / "Link existing entries, notes, or files"' },
        ],
      },
      { text: '"Same as owner" helper — copy answers from the primary guide' },
      {
        text: 'Yearly-review flag (per-topic in TOPIC_ORDER)',
        children: [
          { text: 'Marks topics whose answers drift annually (taxes, insurance, brokerage, healthcare, primary residences, vehicles, subscriptions, retirement, etc.)' },
          { text: 'Topic cards render a small amber "Yearly" pill — flips to a red "Review due" pill when the underlying note was last touched > 380 days ago (12 mo + slack)' },
          { text: 'Dashboard nag banner (superuser-only) counts how many flagged topics need a review and links to /now-what' },
        ],
      },
      { text: 'Add-new-card flow tailored for end-of-life prep' },
      { text: '/api/now-what/search — search vault for similar items (entries + notes + files)' },
      { text: '/api/now-what/fill — Claude fills suggested answer' },
    ],
  },

  {
    title: 'Reminders & Notifications',
    bullets: [
      {
        text: 'PWA Push (Web Push API)',
        children: [
          { text: 'VAPID keys (env: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)' },
          { text: 'web-push library for server send' },
          { text: 'Per-device subscription stored in push_subscription table' },
          { text: 'Dead-subscription pruning (delete after 3 strikes or 410 Gone)' },
          { text: 'failureCount + lastErrorAt tracking' },
        ],
      },
      {
        text: 'Settings toggle',
        children: [
          { text: 'Enable / Disable per device' },
          { text: '"Send test" button for verification' },
          { text: 'iOS install-required messaging when not standalone' },
          { text: 'Permission-denied messaging when browser blocks' },
        ],
      },
      {
        text: 'Reminder types',
        children: [
          {
            text: '3-day-ahead recurring charge (Phase 2, daily 13:00 UTC)',
            children: [
              { text: 'Per-entry push: "Heads up — Netflix · $17.99 charges in 3 days"' },
              { text: 'Tag prevents stacking same-entry reminders' },
              { text: 'Click → /entries/<id>' },
            ],
          },
          {
            text: 'Statement-drop overdue (Phase 3, daily 13:15 UTC)',
            children: [
              { text: 'Per-user batched push naming all overdue accounts' },
              { text: 'Click → /import' },
              { text: 'One reminder per day max per user' },
            ],
          },
          {
            text: 'Recurring-charges-detected (Phase 4b, after weekly cron)',
            children: [
              { text: '"N new recurring charges detected — review in Subscriptions"' },
              { text: 'Click → /subscriptions?tab=suggested' },
              { text: 'Only fires when NEW inserts happened (no nagging on refreshes)' },
            ],
          },
          {
            text: 'User-scheduled reminders (notes + todo lists)',
            children: [
              { text: 'reminder table — userId, title, body, noteId/todoListId FK, remindAt, sentAt' },
              { text: '/api/cron/process-reminders polls every 5min, fires sendPushToUser, stamps sentAt' },
              { text: 'ReminderControl component on /notes/[id] and /todos/[id] — datetime-local picker + pending list' },
              { text: 'Click → deep-links to parent note or todo list (or /reminders inbox)' },
              { text: 'Per-reminder tag so overlapping fires don\'t collapse in the tray' },
            ],
          },
        ],
      },
      {
        text: 'Weekly email digest (separate from push)',
        children: [
          { text: 'Sundays 18:00 UTC' },
          { text: 'Upcoming bills (next 7 days)' },
          { text: 'Expired + expiring (30-day lookahead) credit cards' },
          { text: 'Price-creep alerts' },
          { text: 'Net-worth deltas' },
          { text: 'Sent via SMTP (forwardemail.net for some, Zoho for others)' },
        ],
      },
      {
        text: 'Diagnostic tools',
        children: [
          { text: 'scripts/list-push-subscriptions.ts — show subscribed devices + endpoint prefixes' },
          { text: 'scripts/send-test-push.ts — fire a manual test push from CLI' },
        ],
      },
    ],
  },

  {
    title: 'Calendar',
    bullets: [
      { text: 'Renewal dates from recurring entries (subscriptionRenewsAt)' },
      { text: 'Credit card expiry dates' },
      { text: '30-day lookahead flagging' },
      { text: 'Already-past flagging' },
      {
        text: 'Mark handled — overdue renewal cleanup (Phase A, 2026-06-16)',
        children: [
          { text: 'Inline button on Overdue rows; advanceEntryRenewal() bumps subscriptionRenewsAt +1 period (monthly → +1 month with last-day clamp; yearly → +1 year)' },
          { text: 'one_time period rejected — those don\'t have a "next" by definition' },
          { text: 'Phase B (planned): statement-line auto-match should advance dates without manual taps; see project_auto_reconcile_renewals memory' },
        ],
      },
      {
        text: 'iCal feed',
        children: [
          { text: 'Per-user token (random UUID, stored on user row)' },
          { text: '/api/calendar/feed/[token] serves .ics' },
          { text: 'Subscribe from Google Calendar / Apple Calendar / Outlook' },
          { text: 'Token can be rotated / revoked in settings' },
        ],
      },
    ],
  },

  {
    title: 'AI Features (Claude)',
    bullets: [
      {
        text: 'Ask the Vault (natural-language search)',
        children: [
          { text: 'Builds compact index of all visible entries + notes' },
          { text: 'Claude Sonnet 4.6 ranks top 10 matches with snippets' },
          { text: 'Respects isPrivate + isPersonal filters' },
          { text: '~$0.002–0.01 per query' },
        ],
      },
      {
        text: 'Ask a Document (PDF/image Q&A)',
        children: [
          { text: 'Sparkles button on every attached PDF/image in FileList' },
          { text: '/api/ask-document with {fileId, question}' },
          { text: 'Claude reads document via base64 attachment' },
          { text: '30 MB limit per document' },
          { text: 'Multi-turn conversation per session' },
        ],
      },
      {
        text: 'OCR endpoints',
        children: [
          { text: '/api/ocr-receipt — Claude Vision (claude-opus)' },
          { text: '/api/ocr-recipe — recipe parsing' },
          { text: '/api/ocr-cloud — cloud document fallback' },
          { text: '/api/ocr-fields — generic field extraction' },
        ],
      },
      { text: '/api/suggest-category — auto-classify new entries by title + URL' },
      { text: '/api/recipe-search — natural language → recipe matches' },
      { text: '/api/recipe-cook-split — split into parallel sub-tasks' },
      { text: '/api/clients/voice/ask — voice assistant Q&A (mobile)' },
      {
        text: 'Statement classification (import-inbox)',
        children: [
          { text: 'Institution + last-4 + account name + type + date' },
          { text: 'Confidence: high / medium / low (low → REVIEW.txt)' },
          { text: 'Balance extraction (signed dollars)' },
          { text: 'Full transaction list (allTransactions field, max 16K tokens)' },
        ],
      },
    ],
  },

  {
    title: 'Family Management',
    bullets: [
      {
        text: 'Six family members',
        children: [
          { text: 'Five accepted invites' },
          { text: 'Sixth slot held open (AI-skeptic, not yet accepted)' },
        ],
      },
      {
        text: 'Four roles',
        children: [
          { text: 'superuser — full read/write, sees private entries' },
          { text: 'admin — write access, can manage users' },
          { text: 'member — write access, own personal' },
          { text: 'readonly — read access only' },
        ],
      },
      { text: 'Per-user profile (name, email, DOB, phone, avatar)' },
      { text: 'Family avatar row on dashboard' },
      {
        text: 'Per-user theme accent',
        children: [
          { text: 'Forest (forest green)' },
          { text: 'Crimson (deep red)' },
          { text: 'Midnight (navy blue)' },
          { text: 'Harvest (amber)' },
          { text: 'Picked in /settings' },
          { text: 'Repaints whole app via CSS custom properties (no reload)' },
        ],
      },
      { text: 'Birthday banner — 7-day lookahead + day-of celebration' },
      { text: 'Invite system with role assignment' },
      { text: 'Upgrade requests (member → admin) with admin approval' },
      { text: 'Per-user account deletion (cascade)' },
    ],
  },

  {
    title: 'Gmail Sync',
    bullets: [
      { text: 'OAuth Gmail link per user' },
      { text: 'Two-way contacts sync via People API' },
      {
        text: 'Sync frequency',
        children: [
          { text: 'Manual — sync only on button click' },
          { text: 'Hourly — picked up by cron sweep' },
          { text: 'Daily' },
          { text: 'Weekly' },
        ],
      },
      { text: 'Incremental fetches via syncToken' },
      { text: 'Hourly cron route at /api/cron/sync-gmail-contacts' },
      { text: 'Soft-delete + sync-status tracking (synced / local_created / local_modified / pending_delete)' },
      { text: 'Settings page panel (linked + frequency + last sync)' },
      { text: 'Quick-action row buttons on /contacts — Call (tel:) / Text (sms:) / Email (mailto:) open the native app without opening the contact editor first' },
    ],
  },

  {
    title: 'Bulk Import',
    bullets: [
      {
        text: 'CSV import',
        children: [
          { text: 'Header row → column-to-field mapping preview' },
          { text: 'Claude auto-suggest category per row' },
          { text: 'Re-runnable with source-ID dedup' },
        ],
      },
      { text: 'Plain text import (one entry per line)' },
      { text: 'Sticky Password XML import (CLI: import:sticky)' },
      {
        text: 'Vault File Drop folder ingestion',
        children: [
          { text: 'Drops PDFs / images at C:\\Users\\lance\\Documents\\Vault File Drop\\' },
          { text: 'Claude classification: institution, last-4, type, date' },
          { text: 'Receipts subfolder (receipts\\<llc-slug>\\) creates new receipt entries' },
          { text: 'Top-level files match existing entries by institution + last-4' },
          { text: 'Idempotent — files moved to Imported\\<year>\\ on success' },
          { text: 'No-match files log to REVIEW.txt' },
          { text: 'Duplicates routed to Duplicates\\<year>\\ with .duplicate.txt marker' },
        ],
      },
      {
        text: 'Recently Imported section (v161)',
        children: [
          { text: 'Last 30 days of file imports shown as cards on /import' },
          { text: 'Green NEW pill on each card' },
          { text: '"Mark all seen" button (localStorage timestamp)' },
          { text: 'Click card → parent entry/note' },
        ],
      },
      {
        text: 'Auto-run schedule',
        children: [
          { text: 'Windows Task Scheduler runs npm run import:inbox' },
          { text: 'PowerShell wrapper: scripts/import-inbox-runner.ps1' },
          { text: 'Logs to scripts/import-inbox-log.txt' },
        ],
      },
    ],
  },

  {
    title: 'Offline Access',
    bullets: [
      { text: 'Encrypted IndexedDB read-only snapshot' },
      { text: 'PIN unlock when network is down' },
      { text: 'Family can read vault during outages' },
      { text: 'Manual refresh of snapshot from /settings' },
      { text: '/offline page handles unlock + display' },
    ],
  },

  {
    title: 'Customization & Theming',
    bullets: [
      { text: 'Per-user theme accent (data-theme on <html>)' },
      { text: '500-step color ramps per theme' },
      { text: 'Stock green-* palette for guaranteed-green elements (Save buttons, NEW pills)' },
      { text: 'Per-user avatar' },
      { text: 'Profile + password settings' },
      { text: 'Per-user calendar feed token' },
      { text: 'Per-user push subscription' },
    ],
  },

  {
    title: 'Admin Tools',
    bullets: [
      {
        text: 'User management',
        children: [
          { text: 'Role changes' },
          { text: 'Password reset' },
          { text: 'Account deletion (cascade)' },
        ],
      },
      {
        text: 'Category / subcategory editor',
        children: [
          { text: 'Rename, reorder (up/down), add, delete' },
          { text: 'Icon picker per category/subcategory' },
          { text: 'Move subcategory to different parent category' },
          { text: '"↑ Promote to top-level category" — convert sub into its own main' },
          { text: 'Delete blocked when category has children (move first)' },
          { text: 'Inline rename + slug auto-gen' },
        ],
      },
      { text: 'Mass Reclassify — bulk-move entries to new category/sub' },
      { text: 'Merge Candidates — duplicate-site entry finder' },
      { text: 'Cleanup Credentials — merged-group triage' },
      { text: 'Stale Entry Audit — expired cards, abandoned logins' },
      { text: 'Files browser — every file in vault, reassign / delete' },
      { text: 'Icon Browser — visual library under /public/icons' },
      { text: 'Dead Man\'s Switch — letter release rules' },
      { text: 'Demo data reset (daily cron at 06:00 UTC)' },
      { text: 'Capabilities page (this!)' },
    ],
  },

  {
    title: 'Cron Jobs / Automation',
    bullets: [
      {
        text: 'Vercel cron (vercel.json)',
        children: [
          { text: '06:00 UTC daily — /api/cron/reset-demo' },
          { text: 'Hourly — /api/cron/sync-gmail-contacts' },
          { text: 'Sundays 18:00 UTC — /api/cron/weekly-digest' },
          { text: '13:00 UTC daily — /api/cron/recurring-reminders' },
          { text: '13:15 UTC daily — /api/cron/statement-drop-reminders' },
          { text: 'Sundays 21:00 UTC — /api/cron/detect-recurring' },
        ],
      },
      {
        text: 'Local Windows scheduled task',
        children: [
          { text: '"Family Vault - import inbox" — nightly' },
          { text: 'Triggers npm run import:inbox via scripts/import-inbox-runner.ps1' },
          { text: 'Logs to scripts/import-inbox-log.txt' },
        ],
      },
      { text: 'CRON_SECRET auth via Bearer header (rejects unauthorized hits in prod)' },
    ],
  },

  {
    title: 'PWA / Mobile',
    bullets: [
      {
        text: 'Service worker (public/sw.js)',
        children: [
          { text: 'Stale-while-revalidate for static assets' },
          { text: 'Network-only for HTML' },
          { text: 'Per-version cache busting (CACHE_NAME bump per deploy)' },
          { text: 'Push event handler with payload tag + url support' },
          { text: 'notificationclick handler — focuses open tab if one exists' },
          { text: 'SKIP_WAITING message handler for in-app version prompt' },
        ],
      },
      { text: 'PWA install on iOS 16.4+ and Android' },
      { text: 'Long URLs on entry cards render as the hostname only (prettyHost in lib/format-url.ts) — long signup-flow URLs no longer dominate; full URL still shows on the entry detail page' },
      { text: 'Dashboard mobile big-banner artwork (bigbanner.png) auto-slides off the screen 30 seconds after first paint; stays gone for the session and up to 24h. Force-close (sessionStorage clear) or 24h-elapsed restores it. The crest + greeting + search row stays put.' },
      {
        text: 'Mobile bottom nav (mobile-nav.tsx)',
        children: [
          { text: 'Home / Find / Add / My Vault / Menu — 5 tabs, accent-tinted when active' },
          { text: 'Add tab → sheet with 12 quick-add options' },
          { text: 'Menu tab → slide-in left tools drawer (replaces the old floating hamburger)' },
        ],
      },
      {
        text: 'Mobile tools drawer (mobile-tools-drawer.tsx)',
        children: [
          { text: 'Slides from the left when the Menu tab is tapped; backdrop tap + Esc + X close it' },
          { text: '2-up illustrated tile grid sectioned Plan / Family / Money / Vault' },
          { text: 'Inline vault search up top; Sign out in the footer' },
          { text: 'Collapsible "More" surfaces Categories, Ask, Eggs, and Admin (role-gated)' },
          { text: 'Separate from desktop sidebar (sidebar.tsx); changes need both files' },
        ],
      },
      {
        text: 'Add menu sheet (8 options)',
        children: [
          { text: 'Password (/entries/new?type=login)' },
          { text: 'Note (/notes/new)' },
          { text: 'Item (/entries/new generic)' },
          { text: 'Upload (/entries/new?type=upload)' },
          { text: 'Photo (/photo/new)' },
          { text: 'Recurring (/entries/new?type=login&isRecurring=true)' },
          { text: 'Recipe (/recipes/new)' },
          { text: 'Time Capsule (/capsules)' },
        ],
      },
      { text: '200ms guard on backdrop tap-close (prevents ghost-click)' },
      { text: 'Touch-friendly button sizing' },
      { text: 'Per-version localStorage marker (sw-register) for cache invalidation' },
    ],
  },

  {
    title: 'Easter Eggs',
    bullets: [
      {
        text: 'Maverick truck',
        children: [
          { text: 'Drives across the screen at idle' },
          { text: 'Random direction (left ↔ right) per session' },
          { text: 'CSS keyframe animation' },
        ],
      },
      {
        text: 'Banner hover egg',
        children: [
          { text: '3-second hover on the main banner' },
          { text: 'Triggers full-screen family-photo overlay (teotwawki.png)' },
          { text: 'Dismisses on click or after 4s' },
        ],
      },
      { text: 'Settings page secret tap egg (settings-egg.tsx)' },
      { text: 'Settings title secret tap egg (settings-title-egg.tsx)' },
      { text: 'Dashboard secret tap egg (secret-tap-egg.tsx)' },
      { text: 'Konami code (rumored — not yet confirmed)' },
      { text: 'AIliencode footer credit — AI in bold red +4pt, .com in white' },
      { text: '"Your Mom\'s Card" as a credit card network option' },
    ],
  },
]
