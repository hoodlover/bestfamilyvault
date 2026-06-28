import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  console.log('Running migration...')

  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "image_original" text`
  console.log('✓ user.image_original')

  await sql`
    DO $$ BEGIN
      CREATE TYPE "upgrade_request_status" AS ENUM ('pending', 'handled', 'dismissed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `
  console.log('✓ upgrade_request_status enum')

  await sql`
    CREATE TABLE IF NOT EXISTS "upgrade_request" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "message" text DEFAULT '' NOT NULL,
      "requested_role" "role",
      "status" "upgrade_request_status" DEFAULT 'pending' NOT NULL,
      "handled_by" text,
      "handled_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `
  console.log('✓ upgrade_request table')

  await sql`
    DO $$ BEGIN
      ALTER TABLE "upgrade_request" ADD CONSTRAINT "upgrade_request_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `
  await sql`
    DO $$ BEGIN
      ALTER TABLE "upgrade_request" ADD CONSTRAINT "upgrade_request_handled_by_user_id_fk"
        FOREIGN KEY ("handled_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `
  console.log('✓ upgrade_request foreign keys')

  console.log('Migration complete.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
