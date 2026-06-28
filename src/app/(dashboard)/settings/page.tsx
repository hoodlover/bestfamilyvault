import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc, eq } from 'drizzle-orm'
import { HelpPopout } from '@/components/ui/help-popout'
import { ProfileForm } from '@/components/ui/profile-form'
import { ChangePasswordForm } from '@/components/ui/change-password-form'
import { AvatarUpload } from '@/components/ui/avatar-upload'
import { SignOutButton } from '@/components/ui/sign-out-button'
import { AilencodeCredit } from '@/components/ui/cobb-banner'
import { OfflineCacheSettings } from '@/components/ui/offline-cache-settings'
import { VoiceMemoSettings } from '@/components/ui/voice-memo-settings'
import { GmailSyncSettings } from '@/components/ui/gmail-sync-settings'
import { getMyGmailLink } from '@/lib/actions/gmail-contacts'
import { LinkedDevicesSettings } from '@/components/ui/linked-devices-settings'
import { ExtensionDownloadCard } from '@/components/ui/extension-download-card'
import { listMyClientSessions } from '@/lib/actions/client-sessions'
import { getExtensionRelease } from '@/lib/actions/extension-release'
import { CalendarFeedSettings } from '@/components/ui/calendar-feed-settings'
import { ThemePicker } from '@/components/ui/theme-picker'
import { NotificationToggle } from '@/components/ui/notification-toggle'
import { FeatureModeSettings } from '@/components/ui/feature-mode-settings'
import { Bell, Calendar, Laptop, Mail, Shield, User, Camera, CloudDownload, Mic, Sparkles } from 'lucide-react'
import Link from 'next/link'

const roleBadge: Record<string, { label: string; className: string }> = {
  superuser: { label: 'Superuser', className: 'text-emerald-400 bg-emerald-950/30 border-emerald-800/50' },
  admin: { label: 'Admin', className: 'text-purple-400 bg-purple-900/30 border-purple-700/50' },
  member: { label: 'Member', className: 'text-blue-400 bg-blue-900/30 border-blue-700/50' },
  readonly: { label: 'Read-only', className: 'text-stone-400 bg-stone-700/30 border-stone-600/50' },
}

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .then((r) => r[0])

  if (!user) redirect('/login')

  const badge = roleBadge[user.role] ?? roleBadge.member
  const isSuperuser = user.role === 'superuser'
  let profile: {
    imageOriginal: string | null
    dateOfBirth: Date | null
    phone: string | null
    address: string | null
    ssn: string | null
    driversLicense: string | null
    driversLicenseExpiry: string | null
    passport: string | null
    anniversary: string | null
    themeAccent: string
  } = {
    imageOriginal: null,
    dateOfBirth: null,
    phone: null,
    address: null,
    ssn: null,
    driversLicense: null,
    driversLicenseExpiry: null,
    passport: null,
    anniversary: null,
    themeAccent: 'forest',
  }
  try {
    const row = await db
      .select({
        imageOriginal: users.imageOriginal,
        dateOfBirth: users.dateOfBirth,
        phone: users.phone,
        address: users.address,
        ssn: users.ssn,
        driversLicense: users.driversLicense,
        driversLicenseExpiry: users.driversLicenseExpiry,
        passport: users.passport,
        anniversary: users.anniversary,
        themeAccent: users.themeAccent,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .then((r) => r[0])
    if (row) profile = row
  } catch (err) {
    console.warn('[settings] profile optional-column query failed:', err instanceof Error ? err.message : err)
  }

  // Gmail link state for the sync panel — soft-fail so a missing
  // gmail_link table on a stale prod doesn't crash the whole settings
  // page. Falls back to "not linked".
  let gmailLink: Awaited<ReturnType<typeof getMyGmailLink>> = {
    linked: false,
    gmailEmail: null,
    syncFrequency: 'manual',
    lastSyncedAt: null,
  }
  try {
    gmailLink = await getMyGmailLink()
  } catch (err) {
    console.warn('[settings] getMyGmailLink failed (gmail_link table missing?):', err instanceof Error ? err.message : err)
  }

  // Same pattern for client_session — degrade gracefully if migration
  // hasn't run yet.
  let linkedDevices: Awaited<ReturnType<typeof listMyClientSessions>> = []
  try {
    linkedDevices = await listMyClientSessions()
  } catch (err) {
    console.warn('[settings] listMyClientSessions failed (client_session table missing?):', err instanceof Error ? err.message : err)
  }

  const extensionRelease = await getExtensionRelease()

  // Existing calendar token (Phase 2). null until generated.
  let existingCalendarToken: string | null = null
  try {
    const row = await db
      .select({ calendarToken: users.calendarToken })
      .from(users)
      .where(eq(users.id, session.user.id))
      .then((r) => r[0])
    existingCalendarToken = row?.calendarToken ?? null
  } catch (err) {
    console.warn('[settings] calendar token lookup failed:', err instanceof Error ? err.message : err)
  }

  // Pull family members for the voice-memo panel — superuser only.
  let voiceMemoMembers: Array<{
    id: string
    name: string | null
    email: string | null
    hasImage: boolean
    updatedAt: number
    hasVoiceMemo: boolean
  }> = []
  if (isSuperuser) {
    // Two queries: a base fetch that always works, and a soft-fail
    // voiceMemoBlobUrl query for the new column. If the column doesn't
    // exist yet on prod, the panel still renders with hasVoiceMemo=false
    // for everyone — the user gets told to run db:push via the dashboard
    // warning rather than seeing this section blow up.
    const fam = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt))

    const hasMemo = new Map<string, boolean>()
    try {
      const memos = await db
        .select({ id: users.id, voiceMemoBlobUrl: users.voiceMemoBlobUrl })
        .from(users)
      for (const m of memos) hasMemo.set(m.id, !!m.voiceMemoBlobUrl)
    } catch (err) {
      console.warn('[settings] voiceMemoBlobUrl query failed — run `npm run db:push`.', err)
    }

    voiceMemoMembers = fam.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      hasImage: !!u.image,
      updatedAt: u.updatedAt.getTime(),
      hasVoiceMemo: hasMemo.get(u.id) ?? false,
    }))
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-stone-100 mb-1 flex items-center gap-2">
          <img src="/icons/cobb/icons/system/settings.png" width={72} height={72} alt="" className="object-contain rounded" />
          Settings
        </h1>
        <HelpPopout
          title="Settings"
          sections={[
            {
              heading: 'Profile',
              tips: [
                { title: 'Photo', description: 'Crop + zoom from any device. Avatar everywhere is a tiny round version. Voice memo (optional) attaches a short audio greeting to your profile.' },
                { title: 'Name + password', description: 'Change either at any time. Password resets generate a 1-hour link emailed to your address.' },
              ],
            },
            {
              heading: 'Devices + sync',
              tips: [
                { title: 'Linked devices', description: 'See where the vault is signed in. Revoke any session you don\'t recognize.' },
                { title: 'Gmail Contacts Sync', description: 'OAuth link to your Gmail. Pulls contacts into /contacts; two-way sync after that.' },
                { title: 'Calendar feed', description: 'Personal webcal:// URL you subscribe to in Apple/Google Calendar. Bills + renewals show in your calendar app.' },
                { title: 'Offline cache', description: 'Manage what the PWA caches for offline use. Clear if it gets stale.' },
              ],
            },
            {
              heading: 'Other knobs',
              tips: [
                { title: 'Request feature / upgrade', description: 'Send a request inside the app — no email required.' },
                { title: 'Role badge', description: 'Shows your role + email up top. If you need write access, use Request Upgrade.' },
              ],
            },
          ]}
        />
      </div>
      <p className="text-stone-400 text-sm mb-3">Manage your profile and account security.</p>

      {/* "What can I do here?" CTA — links to the plain-English guide
          everything-this-app-can-do. Surfaced at the top of Settings
          because every user lands on Settings at some point and this
          is the friendly answer to "wait, what does this thing
          actually do?" */}
      <Link
        href="/guide/everything"
        className="mb-6 inline-flex items-center justify-between w-full gap-3 px-4 py-3 rounded-xl border-2 border-green-400 bg-green-500/15 hover:bg-green-500/25 shadow-lg shadow-green-500/40 transition group"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Sparkles size={16} className="text-green-300 shrink-0" />
          <span className="text-sm font-semibold text-white">What can I do here?</span>
          <span className="text-xs text-green-200/80 truncate">— a plain-English tour of every feature</span>
        </span>
        <span className="text-green-200 text-sm shrink-0 group-hover:translate-x-0.5 transition">→</span>
      </Link>

      {/* Role badge */}
      <div className="flex items-center gap-2 mb-8 p-4 bg-stone-800/40 border border-stone-700/50 rounded-xl">
        <Shield size={16} className="text-stone-500" />
        <span className="text-sm text-stone-400">Your role:</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badge.className}`}>
          {badge.label}
        </span>
        <span className="ml-auto text-xs text-stone-600">{user.email}</span>
      </div>

      {/* Avatar */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Camera size={14} />
          Photo
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <AvatarUpload
            currentImage={user.image ? `/api/avatars/${user.id}?v=${user.updatedAt.getTime()}` : null}
            currentImageOriginal={profile.imageOriginal ? `/api/avatars/${user.id}?source=1&v=${user.updatedAt.getTime()}` : null}
            displayName={user.name ?? user.email ?? null}
          />
        </div>
      </section>

      {/* Profile */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <User size={14} />
          Profile
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <ProfileForm
            currentName={user.name ?? ''}
            currentDateOfBirth={profile.dateOfBirth ? profile.dateOfBirth.toISOString().slice(0, 10) : ''}
            currentPhone={profile.phone ?? ''}
            currentAddress={profile.address ?? ''}
            currentSsn={profile.ssn ?? ''}
            currentDriversLicense={profile.driversLicense ?? ''}
            currentDriversLicenseExpiry={profile.driversLicenseExpiry ?? ''}
            currentPassport={profile.passport ?? ''}
            currentAnniversary={profile.anniversary ?? ''}
          />
        </div>
      </section>

      {/* Password */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Shield size={14} />
          Change Password
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <ChangePasswordForm />
        </div>
      </section>

      {/* Theme picker — per-user accent color */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <span className="inline-block w-3.5 h-3.5 rounded-full bg-accent-500" aria-hidden />
          Theme
        </h2>
        <ThemePicker currentTheme={profile.themeAccent ?? 'forest'} />
      </section>

      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Sparkles size={14} />
          Vault Mode
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <FeatureModeSettings />
        </div>
      </section>

      {/* Gmail contacts sync */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Mail size={14} />
          Gmail Contacts Sync
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <GmailSyncSettings
            linked={gmailLink.linked}
            gmailEmail={gmailLink.gmailEmail}
            syncFrequency={gmailLink.syncFrequency}
            lastSyncedAt={gmailLink.lastSyncedAt}
          />
        </div>
      </section>

      {/* Autofill / linked devices */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Laptop size={14} />
          Autofill — Linked Devices
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6 space-y-5">
          <ExtensionDownloadCard release={extensionRelease} />
          <LinkedDevicesSettings initial={linkedDevices} />
        </div>
      </section>

      {/* Push reminders */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Bell size={14} />
          Reminders
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <NotificationToggle />
        </div>
      </section>

      {/* Calendar feed */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <Calendar size={14} />
          Calendar Feed
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <CalendarFeedSettings existingToken={existingCalendarToken} />
        </div>
      </section>

      {/* Offline access */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
          <CloudDownload size={14} />
          Offline Access
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <OfflineCacheSettings />
        </div>
      </section>

      {/* Voice memos (superuser-only) */}
      {isSuperuser && (
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">
            <Mic size={14} />
            Voice Memos for Family
          </h2>
          <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
            <VoiceMemoSettings members={voiceMemoMembers} />
          </div>
        </section>
      )}

      {/* Sign out — visible on mobile since sidebar is hidden */}
      <div className="mt-8 md:hidden">
        <SignOutButton />
      </div>

      <div className="mt-10 flex justify-center opacity-60">
        <AilencodeCredit size="lg" />
      </div>

    </div>
  )
}
