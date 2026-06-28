import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  console.log('Running migration...')

  await sql`
    CREATE TABLE IF NOT EXISTS "message" (
      "id" text PRIMARY KEY NOT NULL,
      "from_user_id" text NOT NULL,
      "to_user_id" text NOT NULL,
      "body" text NOT NULL,
      "read_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `
  console.log('✓ message table')

  await sql`
    DO $$ BEGIN
      ALTER TABLE "message" ADD CONSTRAINT "message_from_user_id_user_id_fk"
        FOREIGN KEY ("from_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `
  await sql`
    DO $$ BEGIN
      ALTER TABLE "message" ADD CONSTRAINT "message_to_user_id_user_id_fk"
        FOREIGN KEY ("to_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `
  console.log('✓ message foreign keys')

  await sql`CREATE INDEX IF NOT EXISTS "message_to_user_idx" ON "message" ("to_user_id")`
  await sql`CREATE INDEX IF NOT EXISTS "message_to_unread_idx" ON "message" ("to_user_id", "read_at")`
  console.log('✓ message indexes')

  console.log('Migration complete.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
