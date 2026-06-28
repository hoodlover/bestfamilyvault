import Link from 'next/link'
import { APP_NAME } from '@/lib/branding'

interface Section {
  title: string
  body: React.ReactNode
}

interface PublicInfoPageProps {
  eyebrow: string
  title: string
  intro: string
  sections: Section[]
  updated?: string
}

export function PublicInfoPage({ eyebrow, title, intro, sections, updated }: PublicInfoPageProps) {
  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        <nav className="mb-8 flex flex-wrap items-center gap-3 text-sm text-stone-400">
          <Link href="/login" className="hover:text-stone-100">Sign in</Link>
          <span aria-hidden="true">/</span>
          <Link href="/about" className="hover:text-stone-100">About</Link>
          <span aria-hidden="true">/</span>
          <Link href="/privacy" className="hover:text-stone-100">Privacy</Link>
          <span aria-hidden="true">/</span>
          <Link href="/support" className="hover:text-stone-100">Support</Link>
        </nav>

        <header className="mb-8 border-b border-stone-800 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">{intro}</p>
          {updated && <p className="mt-3 text-xs text-stone-500">Last updated: {updated}</p>}
        </header>

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-xl border border-stone-800 bg-stone-900/55 p-4">
              <h2 className="text-base font-semibold text-stone-50">{section.title}</h2>
              <div className="mt-2 text-sm leading-6 text-stone-300">{section.body}</div>
            </section>
          ))}
        </div>

        <footer className="mt-10 border-t border-stone-800 pt-5 text-xs text-stone-500">
          {APP_NAME} is for private family organization. Keep your exported files and passwords secure.
        </footer>
      </div>
    </main>
  )
}
