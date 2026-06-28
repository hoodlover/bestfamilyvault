// Lightweight title-only search across the user's accessible entries.
// Used by the new-entry form to surface existing similar entries
// BEFORE the user accidentally creates a duplicate.
//
// Query: ?q=netflix&limit=5
// Returns: { matches: [{ id, title, type, category }] }

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, ilike, isNull, or } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, categories } from '@/lib/db/schema'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10) || 5, 20)
  if (q.length < 2) return NextResponse.json({ matches: [] })

  const rows = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      categoryId: entries.categoryId,
    })
    .from(entries)
    .where(and(
      ilike(entries.title, `%${q}%`),
      isSuperuser ? undefined : eq(entries.isPrivate, false),
      or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      isNull(entries.parentEntryId),
    ))
    .limit(limit)

  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories)
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  return NextResponse.json({
    matches: rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      category: catName.get(r.categoryId) ?? null,
    })),
  })
}
