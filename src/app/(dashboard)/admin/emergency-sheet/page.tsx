import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { and, asc, eq, or } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronLeft, FileText } from 'lucide-react'
import { decryptEntries } from '@/lib/crypto'
import { EmergencySheetTagToggles } from '@/components/ui/emergency-sheet-tag-toggles'
import { EMERGENCY_SHEET_TAG } from '@/lib/emergency-sheet-tag'

export default async function EmergencySheetAdminPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  // Pull every login the user can see. The toggle on each row drives
  // whether that login appears in the printable emergency sheet.
  const loginRows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.type, 'login'),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
    .orderBy(asc(entries.title))

  // Decrypt first, then drop rows with no password. A login with no
  // stored password has nothing useful to render on the emergency
  // sheet (the row would print blank), so it should never be picker-
  // selectable in the first place. Lance was getting visual noise
  // from logins he'd added the username/URL for but never the
  // password — they cluttered the picker without ever being usable.
  const decrypted = decryptEntries(loginRows)
  const eligible = decrypted.filter((e) => typeof e.password === 'string' && e.password.trim() !== '')
  const skippedCount = decrypted.length - eligible.length

  const logins = eligible.map((e) => ({
    id: e.id,
    title: e.title,
    username: e.username,
    url: e.url,
    included: Array.isArray(e.tags) && e.tags.includes(EMERGENCY_SHEET_TAG),
  }))

  const includedCount = logins.filter((l) => l.included).length

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ChevronLeft size={14} /> back to admin
        </Link>
        <Link
          href="/now-what/emergency-sheet"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          <FileText size={14} />
          View / print sheet
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
          <FileText size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Emergency-sheet logins</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            Pick which logins surface on the printable emergency sheet at{' '}
            <Link href="/now-what/emergency-sheet" className="text-emerald-400 hover:text-emerald-300 underline">
              /now-what/emergency-sheet
            </Link>.
          </p>
        </div>
      </div>

      <p className="text-xs text-stone-500 mb-6 leading-relaxed">
        Checking a row adds the <code className="bg-stone-800 px-1 py-0.5 rounded text-stone-300">{EMERGENCY_SHEET_TAG}</code> tag to that login&rsquo;s entry; unchecking removes it.
        Banks, credit cards, and recurring bills are auto-included — only logins need curation. Currently{' '}
        <strong className="text-stone-200">{includedCount}</strong> of {logins.length} eligible logins are flagged.
        {skippedCount > 0 && (
          <>
            {' '}<span className="text-stone-600">({skippedCount} hidden — no password stored.)</span>
          </>
        )}
      </p>

      {logins.length === 0 ? (
        <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          No logins in the vault yet.
        </div>
      ) : (
        <EmergencySheetTagToggles logins={logins} />
      )}
    </div>
  )
}
