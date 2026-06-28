// "Everything this app can do" — plain-English guide for any family
// member. Different from /admin/capabilities (which is the technical
// inventory) in two ways:
//   - Reader-friendly language (no schema/cron/code talk)
//   - AI helpers folded into the section they work in
//
// Available to everyone (no role gate). Linked from /settings and
// from the existing /guide orientation page.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Sparkles, Wrench } from 'lucide-react'
import { SECTIONS, type BulletNode } from './sections'
import { CapabilitiesPrintButton } from '../../admin/capabilities/print-button'

function BulletList({ nodes, depth = 0 }: { nodes: BulletNode[]; depth?: number }) {
  const listClass =
    depth === 0
      ? 'list-disc marker:text-stone-500'
      : depth === 1
        ? 'list-decimal marker:text-stone-500'
        : 'list-[lower-alpha] marker:text-stone-500'

  return (
    <ul className={`${listClass} text-sm pl-6 space-y-1.5`}>
      {nodes.map((node, i) => (
        <li key={i} className="text-stone-300 leading-snug">
          {node.name ? (
            <>
              <strong className="text-stone-100 font-semibold">{node.name}</strong>
              {node.text && <span> — {node.text}</span>}
            </>
          ) : (
            <span>{node.text}</span>
          )}
          {node.children && node.children.length > 0 && (
            <div className="mt-1 mb-2">
              <BulletList nodes={node.children} depth={depth + 1} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export default async function EverythingGuidePage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="capabilities-page p-4 md:p-8 max-w-3xl mx-auto">
      <style>{`
        @media print {
          @page { margin: 0.6in; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .capabilities-page { color: #000 !important; max-width: none !important; padding: 0 !important; }
          .capabilities-page h1, .capabilities-page h2, .capabilities-page h3, .capabilities-page li, .capabilities-page p, .capabilities-page span { color: #000 !important; }
          .capabilities-page section { break-inside: avoid; page-break-inside: avoid; }
          .capabilities-page .section-title { background: none !important; border-bottom: 1px solid #444 !important; color: #000 !important; }
          .capabilities-page ul, .capabilities-page ol { color: #000 !important; }
          .capabilities-page .marker\\:text-stone-500 { color: #000 !important; }
          .capabilities-page .blurb { color: #333 !important; font-style: italic; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ChevronLeft size={14} /> back to settings
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/under-the-hood"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-sky-500/40 bg-sky-500/10 text-xs text-sky-200 hover:bg-sky-500/20 hover:border-sky-500/60 transition no-underline"
          >
            <Wrench size={11} />
            Why.
          </Link>
          <CapabilitiesPrintButton />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
          <Sparkles size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-100">What can I do here?</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            Everything Best Family Vault can do, in plain English.
          </p>
        </div>
      </div>

      <p className="text-xs text-stone-500 mb-8 leading-relaxed no-print">
        Skim the headings, click into anything you want to try. The Print button at top saves the whole guide as a PDF.
      </p>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="section-title text-base font-semibold text-emerald-300 mb-1 border-b border-stone-800 pb-1">
              {section.title}
            </h2>
            {section.blurb && (
              <p className="blurb text-sm text-stone-400 italic mb-3">{section.blurb}</p>
            )}
            <BulletList nodes={section.bullets} />
          </section>
        ))}
      </div>
    </div>
  )
}
