# Cobb Vault — Idea roadmap

Ideas from brainstorm sessions. Pick a few at a time. Each item lists
rough effort + which existing pieces it builds on.

Legend: ⏱️ effort estimate · 🔌 builds on · 💡 why it matters

---

## Tier 1 — quick wins (a weekend each)

### "On this day" widget
Dashboard shows photos / letters / entries from this date in past years.
- ⏱️ 2-3 hours
- 🔌 dashboard layout, existing entry/note/letter timestamps
- 💡 nostalgia hit every morning. Family stays connected to memory without effort.

### Time-locked letters
Write a letter today, set unlock to a date or event ("Sydney's 18th
birthday", "Christmas 2035"). Hidden from recipients until then.
- ⏱️ 3-4 hours
- 🔌 letters table — add `unlockAt` column + UI
- 💡 the letters feature gets ten times more powerful. Letters become a
   real time capsule.

### Bill / renewal calendar
Calendar view of every entry with a renewal/expiration date. "Due in 7
days" badges on the dashboard.
- ⏱️ 4 hours
- 🔌 entries already have `subscriptionRenewsAt`, expiry dates
- 💡 catch a charge BEFORE it hits, not after.

### Document Q&A
Pick any attached PDF, ask Claude a question about it. *"What's my AMEX
balance?"* / *"What did the vet say about Tito?"*
- ⏱️ 3 hours
- 🔌 Anthropic API already wired, files table, file render routes
- 💡 statements stop being inert files; they become askable.

### "Ask the vault" — natural-language search
Search box where you type a question, Claude finds the right entry/note.
*"Where do we keep the cabin keys?"* → points to the right note.
- ⏱️ 5 hours
- 🔌 Anthropic API, decryptEntries
- 💡 better than keyword search by a lot. Lance's "I know I wrote it
   somewhere" problem solved.

---

## Tier 2 — AI-leveraged extensions of the inbox importer

### Statement auto-extract
When a statement gets imported, Claude pulls closing balance + transaction
summary. Sets balance fields on the bank/credit-card entry.
- ⏱️ 6 hours
- 🔌 the inbox importer (just shipped). Same Claude classify step,
   richer prompt.
- 💡 foundation for net worth + price-creep detection below.

### Net-worth dashboard
Sums every account's current balance minus debts. Updates whenever a
new statement gets imported.
- ⏱️ 3 hours (after balance extraction works)
- 🔌 statement auto-extract above
- 💡 no Plaid, no spreadsheet, no chore. The vault becomes the financial
   source of truth.

### Recurring-bill price-creep detector
Compare consecutive statements for the same bill. Flag when amounts
jumped 20%+ between months. *"Your Xfinity went from $75 → $98."*
- ⏱️ 4 hours
- 🔌 statement auto-extract, isRecurring flag
- 💡 catches sneaky price hikes you'd otherwise eat for years.

### Smart auto-categorize on entry creation
Type a title + URL → Claude proposes category + subcategory + entry
type. One-click accept.
- ⏱️ 2-3 hours
- 🔌 Anthropic API, categories table
- 💡 reduces entry-creation clicks to almost zero. Compounds.

### Receipt → entry from a phone photo
Snap a receipt → Claude OCRs → creates a categorized expense entry with
vendor, amount, date.
- ⏱️ 4 hours
- 🔌 photo capture flow, Anthropic Vision (already used for ID/credit-card
   scanning)
- 💡 expense tracking without the friction.

---

## Tier 3 — Family OS / emotional bets (longer build, bigger payoff)

### Letters TO Dad
Kids can write back to you. You see the letters now (or they're locked
until your 70th birthday). Bidirectional letters page.
- ⏱️ 6-8 hours
- 🔌 letters table + new "from" field + permission tweaks
- 💡 fixes the one-way nature of the current letters. Heals.

### Voice prompt journal
Weekly push notification: *"What's something you want the kids to know?"*
Record 60 seconds, auto-saved to letters.
- ⏱️ 5 hours (assuming push infra exists; otherwise +6)
- 🔌 letters page, MediaRecorder, voice-memo upload
- 💡 in 6 months you have 26 voice notes you'd never have written.

### Annual photobook auto-publish
Every December, Claude assembles a printable PDF from the year's photos
+ entries + favorite letters. Family Christmas gift.
- ⏱️ 6-8 hours
- 🔌 photo capture, letters, Anthropic for layout / curation
- 💡 Heather doesn't have to scrapbook. Memories preserved without effort.

### First-times log
Kid turns of voting age, gets first phone, first car, first job. Quick-add
interface, searchable later, sortable by kid.
- ⏱️ 4 hours
- 🔌 new entry type or new sub-table
- 💡 the kids will love this when they're 30.

---

## Tier 4 — Operational hygiene

### Weekly digest email
Every Sunday 6pm: what changed, who logged in, what got autofilled,
pending saves not actioned.
- ⏱️ 4 hours
- 🔌 Resend/SMTP, audit log, admin queries
- 💡 the vault stays maintained without you having to "go check."

### Family inbox / mentions
Heather can leave a comment on any entry: *"Lance, this card got
replaced — update the number?"* Mention badge on your dashboard.
- ⏱️ 6 hours
- 🔌 entries table + new comments table, dashboard widget
- 💡 lightweight async coordination without leaving the vault.

### Calendar export (.ics feed)
Push every dated entry (renewals, expirations, anniversaries, vet visits,
school events) to a `.ics` URL Google Calendar / Apple Calendar can
subscribe to.
- ⏱️ 3 hours
- 🔌 entries table dated fields, new `/ics/<userId>/feed.ics` route
- 💡 vault becomes source of truth, calendar is just a view.

---

## Tier 5 — Voice / device integrations

### Alexa Skill for Cobb Vault ⭐ (your jam)
Custom private Skill talks to vault. *"Alexa, ask Cobb Vault what's the
WiFi password"* → skill calls vault API → speaks the answer.

Sensitive answers (full passwords, account numbers, SSN) get pushed to
the Alexa app on your phone instead of spoken aloud — uses Alexa's
ProactiveEvents API for that. Anyone in the room hears nothing private.

Build pieces:
- AWS Lambda (or any HTTPS endpoint) hosting the skill backend
- Alexa Developer Console: Skill manifest + intent schema
  - `GetWifiIntent` → "tell me the WiFi password"
  - `GetGarageCodeIntent` → "what's the garage code"
  - `FindEntryIntent` with slot for entry name → generic search
  - `RememberPasswordIntent` → quick-add (with sensitivity guard)
- Account linking via OAuth (skill links to a vault user — same
  pairing flow as the browser extension already uses)
- Vault endpoint: `/api/clients/skills/alexa` accepting the intent
  payload and returning Alexa-compatible JSON
- Push-to-app handler for sensitive responses

Skill stays "Account Only" — never published, only your household
Echos see it.

- ⏱️ 10-12 hours
- 🔌 the paired-client API surface (`/api/clients/*`) we already built
   for the browser extension; same auth model
- 💡 hands-free vault access. *"Alexa, what's River's microchip number?"*
   *"Alexa, tell me the address for the cabin."* Felt-magic from a
   couch.

### iOS Shortcuts / Siri integration
Same idea, Apple side. *"Hey Siri, vault, WiFi password"* → returns from
vault. *"Hey Siri, save this to vault"* → captures from active app.
- ⏱️ 6-8 hours (less than Alexa — Apple's Shortcuts don't need a
  whole skill backend, just URL endpoints)
- 🔌 paired-client API surface
- 💡 sci-fi every time. Pair with Alexa for full coverage.

### Google Home / Assistant skill
Same as Alexa, Google ecosystem. Probably skip unless someone in the
family is heavily Google-Home.
- ⏱️ 10-12 hours
- 🔌 paired-client API
- 💡 covers the "I don't have an Echo in this room" scenarios.

---

## Tier 6 — Sleeper hits / weird ideas

### Apple Wallet emergency-info pass
Health insurance card + emergency contacts + allergies + meds as a Wallet
pass. Pull up on your phone lock screen instantly.
- ⏱️ 5 hours
- 🔌 Wallet pass spec + identity entries
- 💡 if something happens to you, ER staff can get critical info from
   your phone without a passcode.

### Vault visitor stats / weekly heartbeat
Surface "Heather logged in 3 times this week. She added 2 entries."
Family-presence indicator on your dashboard.
- ⏱️ 3 hours
- 🔌 lastSeenAt on users, audit log
- 💡 small thing; quietly affirming that the family's USING this.

### Voice memo on every entry edit
When you create/change an entry, optionally record a 10-second voice
note explaining WHY. Future viewers hear the context.
- ⏱️ 5 hours
- 🔌 voice memo recorder (already exists), entry edit flow, blob upload
- 💡 makes the vault a story, not just a database.

### Holiday card list
Addresses + relationships + last-contacted date. Christmas card list
the vault keeps fresh.
- ⏱️ 3 hours
- 🔌 contacts (already synced from Gmail) + new "card list" tag
- 💡 December stops being chaos.

### Allowance / chore tracker
Per-kid weekly checklist. Parents check off, kids see their list on
their dashboard. Optional running balance for allowance.
- ⏱️ 8-10 hours
- 🔌 new tasks table, per-user views
- 💡 the kids interact with the vault for a reason that's about them.

### Time-locked photos
Like time-locked letters but for individual photos. *"Open this photo
on Sydney's wedding day."*
- ⏱️ 3 hours (if time-locked letters is built)
- 🔌 letters time-lock + photo entries
- 💡 the kids find them later. Surprise gifts across decades.

---

## Lance's Amazon / Alexa command extraction (in progress)

Take screenshots of your Alexa app's Routines screen, drop into a folder,
script reads them via Claude Vision and creates a single
"Alexa Commands & Routines" note for the family.
- ⏱️ 30 minutes (small variant of the inbox importer)
- 🔌 inbox importer, Anthropic Vision
- 💡 the family knows what to say to Alexa without asking you.

---

## Picking what's next

Honest sort by **value-per-hour**:
1. **"On this day"** (2 hrs, big emotional payoff)
2. **Document Q&A** (3 hrs, useful immediately on every existing PDF)
3. **Bill / renewal calendar** (4 hrs, real money saved)
4. **Statement auto-extract → net worth** (9 hrs combined, foundation for everything financial)
5. **Alexa Skill** (10-12 hrs, your jam, would feel magical every day)

Anything in Tier 3 (family/emotional) is impossible to ROI-rank because
the payoff is *generational*, not weekly. Letters TO Dad and the voice
prompt journal both fall into "you'll wish you started 10 years ago"
territory.
