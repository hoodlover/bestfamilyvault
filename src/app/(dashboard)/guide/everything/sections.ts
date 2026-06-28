// User-facing "everything this app does" sections — plain English,
// flat bullets in the **Bold name** — short desc style. Grouped into
// logical buckets (not the app's category nav) so anyone can scan
// and find a feature by what it's FOR. Edit as features ship; the
// admin /admin/capabilities page has the technical detail.

export interface BulletNode {
  name?: string         // bold lead-in (e.g. "Receipt capture")
  text: string          // the short description after the em-dash
  children?: BulletNode[]
}

export interface Section {
  title: string
  blurb?: string  // optional one-line intro under the heading
  bullets: BulletNode[]
}

export const SECTIONS: Section[] = [
  {
    title: 'Getting in & getting around',
    bullets: [
      { name: 'Sign in', text: 'Email + password your vault admin set up. Forgot it? Tap Forgot password? on the sign-in screen — you get a one-time reset link that dies in an hour.' },
      { name: 'Bottom bar', text: 'Home · Find · Add · My Vault · Menu lives at the foot of every page on your phone.' },
      { name: 'Menu drawer', text: 'Tap Menu on mobile for everything that isn\'t one of the daily five. Grouped Plan / Family / Money / Vault so you find things by what they\'re for.' },
      { name: 'Sidebar', text: 'On a computer, the left rail mirrors the menu drawer with the same groupings, always visible.' },
      { name: '? button on every page', text: 'Top corner — tap it for a focused list of what you can do on the page you\'re on. Skip the doc-hunt.' },
      { name: 'Color themes', text: 'Settings → pick Forest, Crimson, Midnight, or Harvest. Per-person.' },
      { name: 'Offline access', text: 'Settings → Offline Access downloads an encrypted, PIN-locked snapshot to your phone so the family can still read the vault when the internet is down. Refresh anytime.' },
      { name: 'Add to Home Screen', text: 'Installs the vault like a real app. Required on iPhone for push notifications to work.' },
    ],
  },

  {
    title: 'What lives in your vault',
    bullets: [
      { name: 'Six things you can save', text: 'Logins, bank accounts, credit cards, identity docs (SSN/passport/DL), PDFs/documents, and free-form notes.' },
      { name: 'Privacy levels', text: 'Default = whole family. Personal = only YOU. Private = superuser only.' },
      { name: 'Favorites', text: 'Heart on any card — yours alone, not shared with the family.' },
      { name: 'Custom fields & tags', text: 'Any entry can carry extra key/value fields plus free-form tags for your own filing system.' },
      { name: 'Encryption at rest', text: 'Sensitive stuff (passwords, account #s, SSNs, CVVs, note bodies) is encrypted on disk — not just hidden behind a login.' },
      { name: 'Find tab', text: 'Bottom-nav search runs across titles, usernames, notes, custom fields, tags, and attached file names. Results show what folder/note each match lives under.' },
      { name: 'Grouped logins', text: 'Multiple accounts on the same site (work + personal Google) roll up under one parent so they don\'t crowd your list.' },
      { name: 'Merge candidates', text: 'Admin tool that finds duplicate-site logins and lets you bundle or de-dupe in bulk.' },
    ],
  },

  {
    title: 'Passwords & autofill',
    bullets: [
      { name: 'Browser extension', text: 'Chrome, Edge, Brave on Mac or Windows. Install from Settings → Linked Devices → Install on a new device, pair with a 6-digit code.' },
      { name: 'Green pill fill', text: 'On any saved site, a green pill appears on the password field. Click it → fills.' },
      { name: 'Auto-fill on load', text: 'For sites you hit constantly (Gmail, your bank): tick "Auto-fill on load" on the entry. The password drops in the moment the page opens. A "Filled X — Undo" toast slides in for 6 seconds in case it was the wrong account.' },
      { name: 'Save prompt', text: 'Type a new password anywhere → the extension asks "Save to vault?"' },
      { name: 'Strong password generator', text: 'Built into the popup. Copy actually copies, Use fills the form, or Save stores it immediately + gives you a link to jump in and add details.' },
      { name: 'Quick-add buttons', text: 'Empty search results show +Password / +Note / +Entry pills so you can add the missing thing on the spot.' },
      { name: 'Android autofill app', text: 'Pair once. Android\'s normal password picker now shows your vault entries. Fingerprint/face required each time.' },
      { name: 'iOS (planned)', text: 'Native iOS app is coming — waiting on a Mac. For now: open the PWA, look up the password, copy-paste.' },
      { name: 'Linked devices', text: 'Settings shows every paired device. Lost or stolen? Revoke and it can no longer fill anything.' },
      { name: 'Chrome CSV import', text: 'Already have passwords saved in Chrome? Same card walks you through exporting them and importing into the vault in one go.' },
    ],
  },

  {
    title: 'Bank accounts, cards & IDs',
    bullets: [
      { name: 'Bank entries', text: 'Institution, account number, routing, type, customer-service phone — all on one card.' },
      { name: 'Vault File Drop folder', text: 'Drag any bank or credit-card statement PDF into C:\\Users\\lance\\Documents\\Vault File Drop\\. Overnight (or instantly on Sync now) the app reads it, figures out the bank + last-4 + date, and attaches it to the right account.' },
      { name: 'Duplicate detection', text: 'Drop the same statement twice → the second copy moves to Duplicates\\<year>\\ with a note saying why. Your vault never gets a double-attached PDF.' },
      { name: 'LLC tagging', text: 'Tag any bank or credit-card entry with an LLC (Path to Change / H&L Havens / etc.). Future statements and detected charges roll up under that LLC.' },
      { name: 'Bluevine sub-accounts', text: 'Five of Bluevine\'s seven sub-accounts are pre-mapped to the right LLC/personal slot so statements auto-route on day one.' },
      { name: 'Credit cards', text: 'Cardholder, number, expiry, CVV, network. Snap a photo of the front and Claude reads the number + expiry + name.' },
      { name: 'Identity docs', text: 'Per-person SSN, DOB, passport, driver\'s license. Scan a passport or DL and Claude pulls the fields. Pick a family member to auto-fill name + DOB + phone from their profile.' },
      { name: 'Cards page', text: '/cards lists every credit card AND every ID across the whole vault, regardless of where it\'s filed. Scan thumbnails are the tile art, so you recognize them visually instead of by title.' },
      { name: 'Expiry badges', text: 'Red badge for expired, amber within 60 days — on both the Cards page and the Sunday email digest.' },
      { name: 'Cards search', text: 'Filter by title, name, network, last-4, DL number, passport number — useful when you remember "Chase" but not how you spelled it.' },
    ],
  },

  {
    title: 'Receipts & LLC tracking',
    bullets: [
      { name: 'Per-LLC tile', text: 'Receipts page shows one tile per LLC (Path to Change, H&L Havens, CFS, PTC Havens, Place of Grace) with this year\'s total + count and the all-time total.' },
      { name: 'Snap a receipt', text: 'New receipt form → camera. Claude reads merchant, total, and date. Confirm + save.' },
      { name: 'Batch receipts', text: 'Multiple photos at once, all attached to the same expense entry.' },
      { name: 'Folder drop', text: 'Drop a photo into Vault File Drop\\receipts\\<llc-slug>\\ → auto-creates a receipt under that LLC.' },
      { name: 'Per-receipt notes', text: 'Each receipt remembers what project / who paid / whether reimbursable in a free-form note.' },
      { name: 'Drill into an LLC', text: 'Tap any LLC tile → see all that LLC\'s receipts in one list.' },
    ],
  },

  {
    title: 'Recurring bills & calendar',
    bullets: [
      { name: 'Mark anything recurring', text: 'Flag any entry → it appears on the Subscriptions page no matter what category it\'s filed under. Track amount, period, renewal date, and which card pays it.' },
      { name: 'Monthly roll-up', text: 'Top of the Subscriptions page shows your total monthly equivalent across every recurring charge.' },
      { name: 'Auto-detection', text: 'Every week the app scans every transaction. If a merchant charges 3+ months in a row at a stable amount, it gets flagged.' },
      { name: 'Suggested tab', text: 'Open Suggested → ✓ approves a candidate into a real recurring entry, ✗ dismisses it. Grouped by LLC so you can see which business each one belongs to.' },
      { name: '3-day push reminder', text: '"Heads up — Netflix · $17.99 in 3 days." Tap to jump to the entry.' },
      { name: 'Price-creep alerts', text: 'Bills whose amount jumped show up in the Sunday email digest so a quiet creep doesn\'t hide.' },
      { name: 'Calendar view', text: '/calendar shows every renewal + card expiry on a month grid. Within 30 days is highlighted; overdue rows are highlighted too.' },
      { name: 'Mark handled', text: 'One tap on an overdue row rolls the renewal forward one month (or one year for annual bills) so the bill drops out of Overdue.' },
      { name: 'iCal feed', text: 'Settings → Calendar Feed → copy URL → paste into Google / Apple / Outlook. Renewals show up in your normal calendar. Rotate or revoke anytime.' },
    ],
  },

  {
    title: 'Net worth, assets & vehicles',
    bullets: [
      { name: 'Net Worth card', text: 'Dashboard card sums checking + savings + investments + assets minus credit-card balances. Updates as new statements come in.' },
      { name: 'Month-over-month delta', text: 'Trend arrow next to the total tells you which way you\'re moving.' },
      { name: 'Assets (house, car, jewelry)', text: '+ Add → Asset for one-off things you own. Pick a kind (House, Car, Jewelry…) so the net-worth card buckets it correctly.' },
      { name: 'Appraisal log', text: 'Every time you bump an asset\'s value, that save is logged as an appraisal snapshot so you have a history.' },
      { name: 'Filter what counts', text: 'Tap Filters on the Net Worth card to toggle whole groups (Checking, IRAs, Houses, Cars) or per-row checkboxes. Your choices stick on this device.' },
      { name: 'Vehicle details', text: 'Pick a vehicular asset kind (Car / Truck / Boat / Motorcycle / RV) and a Vehicle Details block appears: VIN, plate, driver, insurance acct #, registration expiry.' },
      { name: 'Driver linking', text: 'Setting Driver to a family member makes their registration-expiry date appear on the Family Info popout — so you handle the soonest-expiring one first.' },
    ],
  },

  {
    title: 'Recipes, meal plans & groceries',
    bullets: [
      { name: 'Save a recipe', text: 'Type it yourself OR paste a URL — Claude scrapes the page and structures it.' },
      { name: 'Ingredient parsing', text: 'Quantities and units are pulled out so the app knows "2 cups flour" vs "salt to taste".' },
      { name: 'Categories + pills', text: '24+ categories pre-built (Chicken, Slow Cooker, Desserts, Christmas, Camping…) with abbrev pills like SLO, MEA, DES.' },
      { name: 'Scale servings', text: 'Bump servings up or down — ingredient quantities recalculate automatically.' },
      { name: 'Cooking mode', text: 'Hit Start recipe on any saved one. Full-screen, huge text, prev/next, screen stays on, per-step read-aloud.' },
      { name: 'Ask Claude about a recipe', text: '"Can I sub almond flour?", "How early can I make this?" — answered against the recipe in front of you.' },
      { name: 'Cook split', text: 'For big meals, Claude divides the recipe into parallel tasks (one person on prep, another on stove).' },
      { name: 'Plain-English recipe search', text: '"Something quick with chicken and rice" finds what fits across everything you\'ve saved.' },
      { name: 'Web recipe search', text: 'Pull in star ratings inline and hide anything below 4.5 so you only see the keepers.' },
      { name: 'Meal Plan', text: 'One per person. Pick recipes for the week.' },
      { name: 'Build shopping list', text: 'Tap Build → every ingredient from every selected recipe lands on your grocery list. Three recipes calling for flour roll up to one line.' },
      { name: 'Manual items persist', text: 'Add paper towels, snacks, anything not in a recipe. Regenerating the list refreshes the recipe items but keeps your manual ones.' },
      { name: 'Skipped items remembered', text: 'Items you unchecked last time stay skipped on the regenerate.' },
      { name: 'Multiple named lists', text: 'Weekly shop, road trip, Costco run. Switch with the pill at the top of the grocery view.' },
      { name: 'Quick-Pick staples', text: 'A 16-category grid of the things you always need. Tick boxes and one tap drops the lot onto whichever list you\'re building.' },
      { name: 'Store mode', text: 'Grouped by Publix aisle with big checkboxes, Print / PDF button for paper-shopping.' },
      { name: 'Standalone Recipes PWA', text: 'Visit /recipes then Add to Home Screen for a separate recipe icon — the cookbook on its own without the rest of the vault chrome.' },
    ],
  },

  {
    title: 'Notes & to-do lists',
    bullets: [
      { name: 'Rich text notes', text: 'Bold, italic, underline, highlight, headings, lists, checkboxes. Filed under any category.' },
      { name: 'Autosave', text: 'Saves every 30 seconds — your edits survive if the phone screen turns off mid-sentence.' },
      { name: 'Attach photos or PDFs', text: 'Any note can carry attached files; drop several at once and they all land on the new note.' },
      { name: 'Wipe checked checkboxes', text: 'Trash icon in the toolbar removes every ticked line in one tap — no more hunting.' },
      { name: 'Note reminders', text: 'Pick a date + time on any note → the vault pushes a notification when it fires (tap to jump back to the note).' },
      { name: 'To-do lists', text: 'Quick checklists separate from notes. Title pre-fills with today\'s date so you just start typing.' },
      { name: 'Native checkboxes', text: 'Real OS checkboxes, big enough to tap, accent-amber when ticked.' },
      { name: 'Cursor-ready', text: 'Cursor is already in the "Add an item" box when the list opens. Hit Enter to drop the next blank row.' },
      { name: 'Delete checked', text: 'One tap clears every ticked item once the list gets cluttered.' },
    ],
  },

  {
    title: 'Photos & attachments',
    bullets: [
      { name: 'Standalone photos', text: 'Snap or upload a photo as its own vault entry. Title + notes + privacy controls like anything else.' },
      { name: 'EXIF date', text: 'Capture date is pulled from the photo\'s built-in data when present.' },
      { name: 'Auto-named files', text: 'Every upload becomes "parent-title-YYYY-MM-DD.ext" so the filename tells you what it is later.' },
      { name: 'Rename', text: 'Pencil icon on each file lets you override the auto-name.' },
    ],
  },

  {
    title: 'Letters, capsules & family messages',
    bullets: [
      { name: 'Family Letters', text: 'Text, audio, or video letters addressed to one family member or all. Record in the browser — no separate recorder.' },
      { name: 'Time capsules', text: 'Write something, set an unlock date, tap Seal. Stays locked until the date — family-targeted so you can pick recipients.' },
      { name: 'Dead Man\'s Switch', text: 'Owner/admin setup that decides the rules for when each letter gets released.' },
      { name: 'Voice memos', text: 'Browser-based recording → send to a specific family member → they get a notification + the memo plays in-app.' },
      { name: 'In-app messages', text: 'Text or audio to anyone in the family. Unread badge until they open it. Also fires an email so they\'re notified outside the app.' },
    ],
  },

  {
    title: 'Family info, treasure-map & roles',
    bullets: [
      { name: 'Family Info popout', text: 'Dashboard tile pops a modal with phone, email, SSN, DOB, DL #, passport #, car-reg expiry, and address for everyone — all in plaintext for quick glance.' },
      { name: 'Copy buttons', text: 'A small icon at the end of every field copies it. Flips to a green check for a second after a successful copy.' },
      { name: 'View / Create card', text: 'A link on each row drops you into that person\'s Identity entry. If nobody made it yet, the link becomes Create card and pre-fills the right name.' },
      { name: 'Unfilled-slot placeholder', text: 'Family members who haven\'t accepted their invite still show in the layout with a "Not joined yet" tag, so the page doesn\'t shift later.' },
      { name: 'Where Is It', text: '/locate is the family treasure-map: every important physical thing, what area it lives in, and the detailed spot. So anyone can find it without tearing the house apart.' },
      { name: 'Inline add + edit', text: 'Tap + on any area to add a row; click any cell to edit in place. Tiny trash icon at the row end removes it.' },
      { name: 'Photo with crop/zoom', text: 'Attach a photo to a Where-Is-It row, then drag + slider-zoom to frame exactly the spot you want highlighted before saving.' },
      { name: 'Treasure-map search', text: 'Box at the top filters every area down to matching rows; areas with no hits collapse out of view.' },
      { name: 'Family roles', text: 'Superuser sees everything except other people\'s Personal items. Admin writes + invites + cleans up. Member writes own + reads shared. Read-only views shared without edits.' },
      { name: 'Invites', text: 'Send a link, they pick a password, the role you assigned takes effect.' },
      { name: 'Birthday banner', text: 'Reminds the whole family 7 days before each birthday.' },
    ],
  },

  {
    title: 'The "if I\'m gone" stuff',
    blurb: 'A wizard for prepping all the "what happens if the owner is gone" answers in one place.',
    bullets: [
      { name: 'Question-by-question wizard', text: 'Prompts you topic by topic. Claude suggests answers based on what\'s already in your vault.' },
      { name: 'Same as owner', text: 'On joint topics, one button can copy the owner\'s answer instead of typing it twice.' },
      { name: 'Attach the actual file', text: 'The answer can BE a document — like the 2025 1040 attached to the tax answer.' },
      { name: 'Multi-file attach', text: 'Pick several PDFs or photos in one go; they all attach to the new note or password.' },
      { name: 'Search across everything', text: 'When linking an existing thing, the box finds entries, notes AND files by name — "1040" finds the PDF\'s parent note.' },
      { name: 'Multi-card linking', text: 'Pick a couple of vault cards and they line up as chips — picking a new one no longer wipes what you just typed.' },
      { name: 'Yearly review pill', text: 'Topics that drift every year (taxes, insurance, brokerage, healthcare, retirement, vehicles, primary residences, subscriptions, account summaries) wear a small "Yearly" pill on their card.' },
      { name: 'Overdue flag', text: 'Answers untouched for over a year flip the pill to red "Review due" so it stands out.' },
      { name: 'Dashboard banner', text: 'A quiet amber banner counts how many answers are overdue. Tap it to jump straight to the IDNW page and review.' },
    ],
  },

  {
    title: 'Smart helpers (Claude)',
    blurb: 'AI baked into the spots where it actually helps — not pulled into a separate "AI" tab.',
    bullets: [
      { name: 'Ask the Vault', text: 'Top-nav Ask button → plain-English questions Claude answers from across everything you can see, with citations. "Where\'s our marriage license?", "When does the Bluevine card expire?"' },
      { name: 'Privacy-respecting', text: 'Won\'t surface someone\'s Personal items to anyone else — Ask the Vault only reads what you\'re allowed to read.' },
      { name: 'Ask a Document', text: 'On any attached PDF, click the ✨ Sparkles icon → ask "What\'s the closing balance?", "When is this due?", "Who is the trustee?" Multi-turn — follow up as needed.' },
      { name: 'Statement reading', text: 'Bank + credit-card PDFs get parsed automatically: institution, last-4, date, balance.' },
      { name: 'Receipt reading', text: 'Photo receipts get merchant + total + date pulled out so all you do is confirm.' },
      { name: 'Card scanning', text: 'Snap the front of a credit card or driver\'s license / passport — fields fill themselves.' },
      { name: 'Recipe scraping', text: 'Paste a URL → Claude turns the page into a structured recipe (ingredients, steps, servings).' },
      { name: 'Recurring detection', text: 'Weekly scan of every transaction across your accounts surfaces likely subscriptions you forgot you had.' },
    ],
  },

  {
    title: 'Reminders, alerts & integrations',
    bullets: [
      { name: 'Push notifications', text: 'Settings → Reminders → enable on each device. iPhone needs Add to Home Screen first.' },
      { name: 'Recurring charge alerts', text: '3 days before each bill: "Heads up — Netflix charges in 3 days."' },
      { name: 'Statement ready', text: 'When a bank statement should be available: "3 statements ready — drop them in Vault File Drop."' },
      { name: 'Detector alerts', text: '"5 charges detected — review in Subscriptions" when the auto-detector finds new candidates.' },
      { name: 'Sunday email digest', text: 'Upcoming bills (next 7 days), expiring credit cards (next 30), price-creep alerts, net-worth changes.' },
      { name: 'Gmail contacts sync', text: 'One-time OAuth in Settings → Gmail Sync. Pick how often (manual, hourly, daily, weekly). Edits in either place flow to the other.' },
      { name: 'Contacts quick-actions', text: 'On /contacts, each row has Call / Text / Email buttons right there — one tap opens phone, messages, or mail without opening the contact card.' },
    ],
  },

  {
    title: 'Bulk import & file drops',
    bullets: [
      { name: 'CSV with header', text: 'Upload a spreadsheet; map columns to fields on the next step.' },
      { name: 'Plain text', text: 'One entry per line works for quick bulk-adds.' },
      { name: 'Vault File Drop folder', text: 'Drop PDFs or images into the folder; the importer routes them — statements to bank entries, receipts to LLC tiles, smart-router for everything else.' },
      { name: 'Recently imported feed', text: '/import shows everything brought in the last 30 days. New imports wear a green NEW pill until you tap "Mark all seen".' },
      { name: 'Android share queue', text: '/inbox is a separate queue for things shared into the vault from your Android phone — kept apart from the desktop folder workflow on purpose.' },
    ],
  },
]
