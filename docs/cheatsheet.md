# Cobb Vault — Operations Cheat Sheet

Commands you'll actually run, grouped by tool. Copy-paste-ready.

---

## PowerShell (local dev, in `c:\Projects\cobbvault`)

### Daily workflow

| Command | Why |
|---|---|
| `npm run dev` | Start the dev server on http://localhost:3000. Hot-reloads on file save. |
| `npx tsc --noEmit` | Typecheck the whole project without producing files. Run before pushing. |
| `npm run build` | Full production build locally. Catches issues Vercel would catch. |
| `npm run lint` | ESLint pass. |

### Database

| Command | Why |
|---|---|
| `npm run db:push` | Apply schema changes from `src/lib/db/schema.ts` to your Neon DB. Run this every time you change the schema file. Will prompt on data-loss operations — read carefully. |
| `npm run db:studio` | Open Drizzle Studio in the browser to browse/edit DB rows visually. Useful for one-off inspection without writing SQL. |
| `npm run db:seed` | Populate the DB with the demo dataset from `src/lib/db/seed.ts`. Destructive — clears existing data. Run only on a fresh DB. |
| `npm run encrypt:existing` | One-time: encrypts plaintext rows in `entry`, `note`, `message`, `letter` after you've added `ENCRYPTION_KEY`. Idempotent — safe to run twice. |

**Example — after editing the schema:**
```
npm run db:push
```
Then verify in Neon SQL editor: `\dt` or `SELECT tablename FROM pg_tables WHERE schemaname='public';`

### Git / deploy

| Command | Why |
|---|---|
| `git status` | See what's changed since last commit. Run before every commit. |
| `git diff` | See the actual line-by-line changes. Use `git diff --stat` for just the file list. |
| `git log --oneline -10` | Last 10 commits, one line each. Quick history scan. |
| `git push origin master` | Push to GitHub → triggers Vercel auto-deploy on master. |
| `git pull --ff-only` | Fetch + fast-forward merge from origin. Safer than plain `pull`. |

**Example — typical commit:**
```
git status                                # see what changed
git add src/                              # stage code changes
git add public/icons/                     # stage new images
git commit -m "Short description"
git push origin master                    # ships to prod
```

### One-offs

| Command | Why |
|---|---|
| `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` | Generate a new 256-bit base64 key. Used for `ENCRYPTION_KEY`. Only run once per project lifetime. |
| `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` | Same idea, hex format. Used by NextAuth for `AUTH_SECRET`. |
| `npx tsx --env-file=.env.local scripts/blob-usage.ts` | Report Vercel Blob storage: total bytes, breakdown by prefix (`vault/` vs `avatars/`), top 5 largest files, % of Hobby-plan free tier. Read-only. |
| `npx tsx --env-file=.env.local scripts/backup-vault.ts` | Off-Vercel backup. Dumps every DB table to `./backups/{timestamp}/db/*.json` plus a blob inventory manifest. Read-only on Vercel. Encrypted columns stay encrypted (need `ENCRYPTION_KEY` to read on restore). Stash the resulting folder somewhere off-Vercel — that's the whole point. |
| `npx tsx --env-file=.env.local scripts/backup-vault.ts --with-blobs` | Same as above plus downloads every blob into `./backups/{timestamp}/blobs/files/`. Slow (~10 min for the current ~7 GB) and large. Run weekly or before any risky migration. |
| `npx tsx --env-file=.env.local scripts/import-bug-out.ts` | **Dry-run** the Bug Out Folder import. Walks `C:\Users\lance\Documents\4625 Forest Place\Bug Out Folder`, prints which files would go where (new EOTW subcategories + sensitive items routed to finance/kids). No DB writes, no blob uploads. |
| `npx tsx --env-file=.env.local scripts/import-bug-out.ts --execute` | Run the import for real. Creates EOTW subcategories, uploads ~600 files to Vercel Blob, inserts a note + file row for each. Idempotent — safe to re-run after a crash; skips files whose `(target, title)` already exists. |
| `npx tsx --env-file=.env.local scripts/convert-bug-out-to-entries.ts` | **Dry-run** the post-import cleanup. Walks every note in End-of-the-World, generates a polished entry title from the attached file's filename, prints a sample so you can eyeball the cleanup. No changes. |
| `npx tsx --env-file=.env.local scripts/convert-bug-out-to-entries.ts --execute` | Convert each note (with an attached file) into a `document` entry of the same category/subcategory, re-bind the file to the entry, and delete the source note. Idempotent — once a note is converted there's nothing left to convert on re-run. |
| `npx tsx --env-file=.env.local scripts/export-passwords.ts` | Generate a printable HTML "emergency backup" of every credential-bearing entry (logins, banks, cards, identities). Decrypts on the fly. Output lands in `exports/` (gitignored). Open in Chrome → Print → Save as PDF, then delete the HTML. Add `--with-notes` to also include note bodies. |
| `npx tsx --env-file=.env.local scripts/reset-password.ts <email>` | Reset a user's password and print a random replacement. Refuses to touch a superuser unless you pass `--i-know`. Pass an explicit second arg to set a specific password instead of generating one. Tell the user to sign in and change it from Settings. |

### Vercel CLI (optional — install with `npm i -g vercel`)

| Command | Why |
|---|---|
| `vercel login` | One-time auth on this machine. |
| `vercel env ls` | List env vars set on the project. Confirms `ENCRYPTION_KEY`, `DATABASE_URL`, `RESEND_API_KEY`, etc. are wired. |
| `vercel logs` | Stream deployed function logs (your `console.log` calls show here). |
| `vercel logs --follow` | Continuous tail. Ctrl+C to stop. |

---

## Neon SQL Editor (https://console.neon.tech → cobb-vault → SQL Editor)

### Verify encryption (after running `npm run encrypt:existing`)

```sql
-- Did the password column get encrypted?
SELECT id, title, password,
       LENGTH(password) AS pw_len,
       password LIKE 'enc:v1:%' AS is_encrypted
FROM "entry"
WHERE password IS NOT NULL AND password <> ''
LIMIT 10;
```
Expect `is_encrypted = true` and `pw_len` ~70+ on every row.

```sql
-- Same check for note bodies
SELECT id, title, LENGTH(content) AS len, content LIKE 'enc:v1:%' AS encrypted
FROM "note" WHERE content <> '' LIMIT 10;

-- And letter bodies
SELECT id, recipient_name, title, LENGTH(body) AS len, body LIKE 'enc:v1:%' AS encrypted
FROM "letter" WHERE body <> '' LIMIT 10;
```

### Find entries by title (titles stay plaintext)

```sql
SELECT id, title, type, username, created_at
FROM "entry"
WHERE title ILIKE '%testpw%';
```
Use this to confirm a specific entry was saved, before checking its encrypted fields.

### Schema inspection

```sql
-- All tables in this DB
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;

-- Columns of a specific table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'entry'
ORDER BY ordinal_position;

-- Row counts per table
SELECT 'entry' AS t, COUNT(*) FROM "entry"
UNION ALL SELECT 'note', COUNT(*) FROM "note"
UNION ALL SELECT 'letter', COUNT(*) FROM "letter"
UNION ALL SELECT 'user', COUNT(*) FROM "user"
UNION ALL SELECT 'message', COUNT(*) FROM "message"
ORDER BY t;
```

### User & role management

```sql
-- See all family accounts and their roles
SELECT id, name, email, role, created_at
FROM "user"
ORDER BY created_at;

-- Promote someone to superuser (e.g., Heather)
UPDATE "user" SET role='superuser' WHERE email='heather@example.com';

-- Demote someone back to member
UPDATE "user" SET role='member' WHERE email='someone@example.com';

-- Count entries per user
SELECT u.name, u.email, COUNT(e.id) AS entry_count
FROM "user" u LEFT JOIN "entry" e ON e.created_by = u.id
GROUP BY u.id ORDER BY entry_count DESC;
```

### Letter release flag (dead-man's-switch testing)

```sql
-- See current state
SELECT * FROM "letter_release";

-- Manually release the letters NOW (for testing — kids will see their letters)
INSERT INTO "letter_release" (released_at, released_by, notes)
VALUES (NOW(), (SELECT id FROM "user" WHERE role='superuser' LIMIT 1), 'manual test release');

-- Lock them back up (delete the row)
DELETE FROM "letter_release";
```

### Drop the demo `playing_with_neon` table (Neon's getting-started sample)

```sql
DROP TABLE IF EXISTS playing_with_neon;
```

### Find a specific letter

```sql
-- Letters by recipient slug
SELECT id, title, length(body) AS body_len, file_name, created_at
FROM "letter"
WHERE recipient_name = 'tadan'
ORDER BY created_at DESC;
```

### Read messages between two users

```sql
SELECT m.id, fu.name AS sender, tu.name AS recipient,
       length(m.body) AS body_len,
       m.body LIKE 'enc:v1:%' AS encrypted,
       m.created_at, m.read_at
FROM "message" m
JOIN "user" fu ON fu.id = m.from_user_id
JOIN "user" tu ON tu.id = m.to_user_id
ORDER BY m.created_at DESC
LIMIT 20;
```

---

## Vercel Dashboard (https://vercel.com → cobbvault)

### Environment variables

**Path:** Settings → Environment Variables

Required vars:

| Variable | Where it goes | What it does |
|---|---|---|
| `DATABASE_URL` | Production, Preview, Development | Neon Postgres connection string. |
| `AUTH_SECRET` (or `NEXTAUTH_SECRET`) | All environments | Signs NextAuth JWT cookies. Generate with `node -e "console.log(...randomBytes(32).toString('hex'))"`. |
| `ENCRYPTION_KEY` | All environments | At-rest encryption key. Generate with `randomBytes(32).toString('base64')`. **Same value as `.env.local`.** |
| `BLOB_READ_WRITE_TOKEN` | All environments | Vercel Blob credentials (auto-set if you use the Blob integration). |
| `RESEND_API_KEY` | All environments | For dead-man's-switch emails (next session). |
| `NEXT_PUBLIC_APP_NAME` | Optional | Override the app's display name (default "Cobb Family Vault"). |
| `NEXT_PUBLIC_DEMO_MODE` | Don't set on prod | If `true`, shows a /demo route. Leave unset for the family vault. |

After adding/editing any env var: **redeploy** (Settings → Deployments → ⋯ on latest → Redeploy). Env changes don't apply to existing builds.

### Logs

**Path:** Deployments → click the latest deployment → Logs tab.
- Shows runtime `console.log` from server actions and API routes.
- Letters created and files uploaded log timestamped lines (audit trail). Filter by "letter saved" or "file uploaded".

### Domain

**Path:** Settings → Domains.
- Default: `cobbvault.vercel.app`
- Custom domain (e.g., `thecobbvault.com`) — add domain, configure DNS as instructed.

### Cron jobs (for the dead-man's-switch later)

**Path:** Settings → Cron Jobs (or `vercel.json` in the repo).
- Add `{"path": "/api/cron/check-release", "schedule": "0 8 * * *"}` to run daily at 8am.

---

## Common workflows

### "I changed the schema, what now?"

```
npm run db:push                                    # apply to Neon
git add src/lib/db/schema.ts
git commit -m "Schema: add foo column to bar"
git push origin master                             # Vercel auto-deploys
```

If you ran the schema push against your local `.env.local` DB AND prod uses the same Neon branch, you're done. If they're separate branches, also push to the prod branch by temporarily swapping `DATABASE_URL` and re-running `npm run db:push`.

### "I want to test the letter release locally"

```sql
-- In Neon SQL editor:
INSERT INTO "letter_release" (released_at, released_by, notes)
VALUES (NOW(), (SELECT id FROM "user" WHERE role='superuser' LIMIT 1), 'testing');
```
Log in as a non-Lance family member → /letters → their card now shows content. To re-lock:
```sql
DELETE FROM "letter_release";
```

### "I need to verify encryption is working on prod"

1. In Vercel Dashboard, confirm `ENCRYPTION_KEY` is set.
2. In Neon SQL editor (verify you're on the prod branch — see top dropdown):
   ```sql
   SELECT password LIKE 'enc:v1:%' AS encrypted, COUNT(*)
   FROM "entry" WHERE password IS NOT NULL AND password <> ''
   GROUP BY 1;
   ```
   Expect a single row with `encrypted = true`.

### "I forgot my password and locked myself out"

```sql
-- Generate a bcrypt hash for a new password — easiest way:
-- run `node -e "require('bcryptjs').hash('NewPassword123', 10).then(h => console.log(h))"`
-- Then:
UPDATE "user" SET password_hash='$2a$10$...thehash...' WHERE email='lance.climb@gmail.com';
```

### "Something's broken on prod, where do I look?"

1. **Vercel Dashboard → Deployments → latest → Build Logs** — did the build fail?
2. **Vercel Dashboard → Logs** — runtime errors from server actions / API routes.
3. **Neon Dashboard → Monitoring** — DB connection / query errors.
4. **Browser DevTools → Console + Network** — client-side errors, 500 responses.

---

## Reference

- Repo: https://github.com/hoodlover/cobbvault
- Local dev URL: http://localhost:3000
- Production URL: (whatever Vercel assigns + custom domain)
- Neon project: cobb-vault (in LanceInvoicer org)
- Vercel project: cobbvault (in your account)
