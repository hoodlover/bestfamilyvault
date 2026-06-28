// Vercel cron endpoint that re-seeds the demo DB on a schedule.
//
// Triple-gated against accidentally hitting your real DB:
//   1. DEMO_MODE env var must be "true"
//   2. Authorization header must match CRON_SECRET (Vercel adds this header
//      automatically when calling cron routes)
//   3. The seed function itself bails if DEMO_MODE isn't set
//
// Cron schedule lives in vercel.json.

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, notes, categories, users } from '@/lib/db/schema'
import { DEMO_PASSWORD, DEMO_USERS, CATEGORIES, ENTRIES, NOTES } from '@/lib/demo-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  // Triple gate
  if (process.env.DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'Demo mode is off.' }, { status: 403 })
  }

  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    await db.execute(sql`TRUNCATE TABLE
      "entry",
      "note",
      "file",
      "invite",
      "subcategory",
      "category",
      "session",
      "account",
      "verificationToken",
      "user"
      RESTART IDENTITY CASCADE`)

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
    const insertedUsers = await db
      .insert(users)
      .values(
        DEMO_USERS.map((u) => ({
          email: u.email,
          name: u.name,
          role: u.role,
          passwordHash,
        }))
      )
      .returning({ id: users.id, email: users.email })
    const ownerId = insertedUsers.find((u) => u.email === 'demo@bestfamilyvault.app')!.id

    const insertedCategories = await db
      .insert(categories)
      .values(
        CATEGORIES.map((c) => ({
          name: c.name,
          slug: c.slug,
          icon: c.icon,
          sortOrder: c.sortOrder,
          isDefault: true,
        }))
      )
      .returning({ id: categories.id, slug: categories.slug })
    const categoryBySlug = Object.fromEntries(insertedCategories.map((c) => [c.slug, c.id]))

    const inserted: Array<{ id: string; mergeKey?: string }> = []
    for (const e of ENTRIES) {
      const [row] = await db
        .insert(entries)
        .values({
          categoryId: categoryBySlug[e.category],
          type: e.type,
          title: e.title,
          username: e.username ?? null,
          password: e.password ?? null,
          url: e.url ?? null,
          noteContent: e.noteContent ?? null,
          bankName: e.bankName ?? null,
          accountType: e.accountType ?? null,
          accountNumber: e.accountNumber ?? null,
          routingNumber: e.routingNumber ?? null,
          cardholderName: e.cardholderName ?? null,
          cardNumber: e.cardNumber ?? null,
          expiryDate: e.expiryDate ?? null,
          cvv: e.cvv ?? null,
          cardNetwork: e.cardNetwork ?? null,
          firstName: e.firstName ?? null,
          lastName: e.lastName ?? null,
          dateOfBirth: e.dateOfBirth ?? null,
          ssn: e.ssn ?? null,
          isFavorite: e.isFavorite ?? false,
          isPrivate: false,
          isPersonal: false,
          createdBy: ownerId,
          updatedBy: ownerId,
        })
        .returning({ id: entries.id })
      inserted.push({ id: row.id, mergeKey: e.mergeKey })
    }

    const mergeKeys = new Set(inserted.map((i) => i.mergeKey).filter(Boolean) as string[])
    for (const key of mergeKeys) {
      const group = inserted.filter((i) => i.mergeKey === key)
      if (group.length < 2) continue
      const [master, ...children] = group
      for (const child of children) {
        await db.execute(sql`UPDATE entry SET parent_entry_id = ${master.id} WHERE id = ${child.id}`)
      }
    }

    await db.insert(notes).values(
      NOTES.map((n) => ({
        categoryId: categoryBySlug[n.category],
        title: n.title,
        content: n.content,
        isFavorite: n.isFavorite ?? false,
        isPrivate: false,
        isPersonal: false,
        createdBy: ownerId,
        updatedBy: ownerId,
      }))
    )

    return NextResponse.json({
      ok: true,
      reset: new Date().toISOString(),
      users: insertedUsers.length,
      categories: insertedCategories.length,
      entries: inserted.length,
      mergedGroups: mergeKeys.size,
      notes: NOTES.length,
    })
  } catch (e) {
    console.error('demo reset failed', e)
    return NextResponse.json({ error: 'Reset failed.', detail: String(e) }, { status: 500 })
  }
}
