# The Cobb Vault

A self-hosted family password manager + notes + grouped credentials, built as a PWA with Next.js (App Router), Drizzle ORM, and Neon Postgres. Personal vaults, shared categories, merge multiple family logins for the same site into one card.

> ⚠️ **Storage note:** Passwords are stored as plaintext in Postgres (rather than encrypted-at-rest with a master password). Fine if you trust whoever runs the database (you, on your own Neon project). **Don't** treat this as a Bitwarden/1Password replacement until at-rest encryption is added.

## Try the demo

A public demo runs at the deployed `/demo` route — pick a role (Owner / Parent / Kid / Guest) and you're auto-signed in with sample data. The DB resets daily; don't enter real passwords.

## Run it for your own family

### 1. Database

Create a free Neon Postgres project (https://neon.tech) and copy its `DATABASE_URL`.

### 2. Local dev

```bash
git clone https://github.com/hoodlover/cobbvault.git
cd cobbvault
npm install
cp .env.example .env.local        # then paste DATABASE_URL + NEXTAUTH_SECRET
npm run db:push                   # apply schema to your Neon DB
npm run dev
```

Open http://localhost:3000. The very first time, you'll need a superuser — create one via the seed script or by inserting a row directly. (Self-registration of a first user is on the to-do list.)

### 3. Deploy to Vercel

1. Click **New Project** in Vercel and import the repo.
2. Add env vars: `DATABASE_URL`, `NEXTAUTH_SECRET`. **Do not set `NEXTAUTH_URL`** — Vercel auto-provides `AUTH_TRUST_HOST` and Auth.js v5 infers the host from the request. Setting `NEXTAUTH_URL` to a localhost value will break every redirect in prod.
3. Deploy. Done.

## Run a public demo (separate from your real instance)

Two Vercel projects + two Neon DBs.

```
production  ─►  cobbvault-real     ─►  Neon (real DB)
demo        ─►  cobbvault-demo     ─►  Neon (demo DB)  + DEMO_MODE=true
```

### Setup

1. **Create a second Neon project** for the demo DB.
2. **Create a second Vercel project** pointing at the same repo.
3. Set env vars on the demo project:
   - `DATABASE_URL` → demo Neon URL
   - `DEMO_MODE` → `true`
   - `NEXT_PUBLIC_DEMO_MODE` → `true`  (for the banner + login CTA)
   - `NEXTAUTH_SECRET` → any random string
   - `CRON_SECRET` → any random string (Vercel auto-sends this header to cron routes)
   - (Do NOT set `NEXTAUTH_URL` — Auth.js v5 infers it from the request on Vercel.)
4. After first deploy, run the seed:
   ```bash
   # locally, with .env.demo pointed at demo Neon URL + DEMO_MODE=true
   npx tsx --env-file=.env.demo scripts/seed-demo.ts
   ```
   Or hit the cron endpoint manually with the secret:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DEMO.vercel.app/api/cron/reset-demo
   ```
5. Vercel cron is configured in `vercel.json` — runs daily at 06:00 UTC and re-seeds the DB. Bump frequency if you have Pro tier.

### Safety: the demo seed/reset cannot run against your real DB

Three layers:
- `scripts/seed-demo.ts` refuses to run unless `DEMO_MODE=true` is in env.
- `/api/cron/reset-demo` returns 403 if `DEMO_MODE !== 'true'` (so even if Vercel cron fires on prod, nothing happens).
- The cron endpoint also requires the correct `Authorization: Bearer $CRON_SECRET` header.

Demo logins (all use password `demo1234`):

| Email | Role |
|---|---|
| `demo@cobbvault.app` | Superuser (full access) |
| `parent@cobbvault.app` | Admin |
| `kid1@cobbvault.app` | Member |
| `kid2@cobbvault.app` | Member |
| `guest@cobbvault.app` | Read-only |

## Useful scripts

```bash
npm run db:push                                                # push schema to current DATABASE_URL
npx tsx --env-file=.env.demo scripts/seed-demo.ts              # wipe + seed demo DB
npx tsx --env-file=.env.local scripts/undo-recent-merges.ts "<title>" --execute   # unlink a merge
npx tsx --env-file=.env.local scripts/blob-usage.ts            # report Vercel Blob storage usage
npx tsx --env-file=.env.local scripts/backup-vault.ts          # snapshot DB + blob inventory to ./backups/
npx tsx --env-file=.env.local scripts/backup-vault.ts --with-blobs  # also download every blob (slow, ~7 GB)
npx tsx --env-file=.env.local scripts/import-bug-out.ts            # dry-run: bulk-import the Bug Out Folder
npx tsx --env-file=.env.local scripts/import-bug-out.ts --execute  # commit the import
npx tsx --env-file=.env.local scripts/convert-bug-out-to-entries.ts  # dry-run: convert bug-out notes → document entries
npx tsx --env-file=.env.local scripts/convert-bug-out-to-entries.ts --execute  # commit the conversion
npx tsx --env-file=.env.local scripts/export-passwords.ts          # printable HTML of all credentials → exports/
npx tsx --env-file=.env.local scripts/reset-password.ts <email>    # reset a user's password (random) — superuser needs --i-know
npx tsx --env-file=.env.local scripts/seed-birthdays.ts            # seed family birthdays (Heather, Tadan, Sydney, Makenzie, Paiton)
```

## Stack

- Next.js (App Router, server actions)
- NextAuth (credentials provider, JWT sessions, DrizzleAdapter)
- Drizzle ORM + Neon Postgres (HTTP driver — works on Vercel edge & node)
- Tailwind v4 + lucide-react icons
- Service worker (`public/sw.js`) — stale-while-revalidate, network-first HTML
