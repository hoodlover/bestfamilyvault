'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, notes, categories, subcategories } from '@/lib/db/schema'
import { decryptEntries, decryptNotes } from '@/lib/crypto'
import { and, or, eq, asc } from 'drizzle-orm'

// Returns a plaintext snapshot of everything the current user can see in the
// app. Called by the Settings page; the response is encrypted client-side
// with a user-supplied PIN before persisting to IndexedDB. We do NOT ship
// the at-rest encryption key — that stays on the server.
//
// Visibility rules mirror /dashboard and /categories/[slug] exactly:
//   - superuser: bypasses isPrivate (Private Vault), but NOT isPersonal
//   - everyone: sees only their own personal items + shared family items
// (isPersonal is strictly owner-only — Lance's call after the kids became
// adults. The Private Vault is the superuser-only space.)

export interface OfflineSnapshotPayload {
  generatedAt: string
  user: { name: string | null; email: string | null; role: string }
  categories: { id: string; name: string; slug: string; sortOrder: number }[]
  subcategories: { id: string; categoryId: string; name: string; sortOrder: number }[]
  entries: Array<{
    id: string
    type: string
    title: string
    categoryId: string | null
    subcategoryId: string | null
    isPersonal: boolean
    isPrivate: boolean
    username: string | null
    password: string | null
    url: string | null
    bankName: string | null
    accountType: string | null
    accountNumber: string | null
    routingNumber: string | null
    cardholderName: string | null
    cardNetwork: string | null
    cardNumber: string | null
    expiryDate: string | null
    cvv: string | null
    firstName: string | null
    lastName: string | null
    dateOfBirth: string | null
    ssn: string | null
    passport: string | null
    driversLicense: string | null
    phone: string | null
    noteContent: string | null
  }>
  notes: Array<{
    id: string
    title: string
    content: string
    categoryId: string | null
    subcategoryId: string | null
    isPersonal: boolean
    isPrivate: boolean
  }>
}

export async function fetchOfflineSnapshot(): Promise<OfflineSnapshotPayload> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in.')

  const userId = session.user.id
  const role = session.user.role
  const isSuperuser = role === 'superuser'

  const entriesFilter = and(
    or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
    isSuperuser ? undefined : eq(entries.isPrivate, false)
  )

  const notesFilter = and(
    or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
    isSuperuser ? undefined : eq(notes.isPrivate, false)
  )

  const [allCats, allSubs, rawEntries, rawNotes] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    db.select().from(subcategories).orderBy(asc(subcategories.sortOrder)),
    db.select().from(entries).where(entriesFilter),
    db.select().from(notes).where(notesFilter),
  ])

  const decryptedEntries = decryptEntries(rawEntries)
  const decryptedNotes = decryptNotes(rawNotes)

  return {
    generatedAt: new Date().toISOString(),
    user: { name: session.user.name ?? null, email: session.user.email ?? null, role },
    categories: allCats.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, sortOrder: c.sortOrder,
    })),
    subcategories: allSubs.map((s) => ({
      id: s.id, categoryId: s.categoryId, name: s.name, sortOrder: s.sortOrder,
    })),
    entries: decryptedEntries.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      categoryId: e.categoryId,
      subcategoryId: e.subcategoryId,
      isPersonal: e.isPersonal,
      isPrivate: e.isPrivate,
      username: e.username,
      password: e.password,
      url: e.url,
      bankName: e.bankName,
      accountType: e.accountType,
      accountNumber: e.accountNumber,
      routingNumber: e.routingNumber,
      cardholderName: e.cardholderName,
      cardNetwork: e.cardNetwork,
      cardNumber: e.cardNumber,
      expiryDate: e.expiryDate,
      cvv: e.cvv,
      firstName: e.firstName,
      lastName: e.lastName,
      dateOfBirth: e.dateOfBirth,
      ssn: e.ssn,
      passport: e.passport,
      driversLicense: e.driversLicense,
      phone: e.phone,
      noteContent: e.noteContent,
    })),
    notes: decryptedNotes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      categoryId: n.categoryId,
      subcategoryId: n.subcategoryId,
      isPersonal: n.isPersonal,
      isPrivate: n.isPrivate,
    })),
  }
}
