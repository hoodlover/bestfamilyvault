import { auth } from '@/lib/auth'
import { APP_NAME } from '@/lib/branding'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Wrench } from 'lucide-react'
import { CapabilitiesPrintButton } from '../admin/capabilities/print-button'

const SECTIONS = [
  {
    title: 'What this is',
    body: 'A private family organizer for passwords, documents, notes, recipes, recurring bills, contacts, messages, letters, time capsules, and end-of-life planning. It runs as a web app, can be installed on a phone, and has companion autofill clients for browsers and Android.',
  },
  {
    title: 'How access works',
    body: 'The vault uses roles, invitation links, and per-item privacy controls. Shared items are available to the family. Personal items stay owner-only. Private/admin areas are reserved for the people assigned to maintain the vault.',
  },
  {
    title: 'What stays sealed',
    body: 'Family Letters and Time Capsules keep their contents quiet until their release rules say otherwise. The mechanics stay in place for future setup, but this starter copy does not include personal letter content or family-specific release wording.',
  },
  {
    title: 'Automation',
    body: 'The app can surface recurring bills, calendar dates, stale planning answers, card expirations, file imports, statement parsing, receipt capture, and reminders. Those automations become useful as real records are added.',
  },
  {
    title: 'AI helpers',
    body: 'AI is used in focused places: OCR for cards and receipts, document questions, recipe cleanup, Ask the Vault, and planning suggestions. Results should be reviewed before treating them as authoritative.',
  },
  {
    title: 'Clean-slate note',
    body: 'This project has been separated from its original family data. Use the clean-slate reset script only after confirming the local database target, then seed neutral demo records for friends to explore.',
  },
]

export default async function UnderTheHoodPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          href="/guide"
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ChevronLeft size={16} />
          Back to guide
        </Link>
        <CapabilitiesPrintButton />
      </div>

      <header className="mb-8">
        <div className="flex items-center gap-3 text-emerald-300">
          <Wrench size={22} />
          <p className="text-xs uppercase tracking-[0.24em]">Under the hood</p>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-stone-100">{APP_NAME}</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-400">
          A neutral technical overview for anyone who wants to understand what the vault does without reading the source.
        </p>
      </header>

      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded-xl border border-stone-800 bg-stone-900/50 p-4">
            <h2 className="text-base font-semibold text-stone-100">{section.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
