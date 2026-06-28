// Nested capability inventory rendered as bullet → number → letter
// hierarchy. Server component; data lives in sections.ts so a future
// "next feature" addition is a one-file edit.
//
// Print-friendly: the @media print rules below hide the back link +
// print button, drop colored backgrounds, and force single-column
// layout so the saved PDF is clean.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { SECTIONS, type BulletNode } from './sections'
import { CapabilitiesPrintButton } from './print-button'

function countLeaves(nodes: BulletNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (!node.children || node.children.length === 0) n += 1
    else n += countLeaves(node.children)
  }
  return n
}

// Recursive renderer. Depth 0 → list-disc (bullets),
// depth 1 → list-decimal (1, 2, 3), depth 2+ → list-[lower-alpha]
// (a, b, c). Going deeper than 3 levels stays on letters but indents.
function BulletList({ nodes, depth = 0 }: { nodes: BulletNode[]; depth?: number }) {
  const listClass =
    depth === 0
      ? 'list-disc marker:text-stone-500'
      : depth === 1
        ? 'list-decimal marker:text-stone-500'
        : 'list-[lower-alpha] marker:text-stone-500'
  const sizeClass = depth === 0 ? 'text-sm' : 'text-sm'

  return (
    <ul className={`${listClass} ${sizeClass} pl-6 space-y-1`}>
      {nodes.map((node, i) => (
        <li key={i} className="text-stone-300 leading-snug">
          <span>{node.text}</span>
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

export default async function CapabilitiesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    redirect('/dashboard')
  }

  const totalLeaves = SECTIONS.reduce((n, s) => n + countLeaves(s.bullets), 0)

  return (
    <div className="capabilities-page p-4 md:p-8 max-w-3xl mx-auto">
      {/* Print-only stylesheet triggered via the Print/PDF button;
          browser's "Save as PDF" destination produces the file. */}
      <style>{`
        @media print {
          @page { margin: 0.6in; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .capabilities-page { color: #000 !important; max-width: none !important; padding: 0 !important; }
          .capabilities-page h1, .capabilities-page h2, .capabilities-page li, .capabilities-page p, .capabilities-page span { color: #000 !important; }
          .capabilities-page section { break-inside: avoid; page-break-inside: avoid; }
          .capabilities-page .section-title { background: none !important; border-bottom: 1px solid #444 !important; color: #000 !important; }
          .capabilities-page ul, .capabilities-page ol { color: #000 !important; }
          .capabilities-page .marker\\:text-stone-500 { color: #000 !important; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ChevronLeft size={14} /> back to admin
        </Link>
        <CapabilitiesPrintButton />
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
          <Sparkles size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Capabilities</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            Everything Family Vault can do — {SECTIONS.length} sections · {totalLeaves} leaf items
          </p>
        </div>
      </div>

      <p className="text-xs text-stone-500 mb-8 leading-relaxed no-print">
        Grouped by feature area as you&rsquo;d think about it (not by where the code lives). Bullet → number → letter
        hierarchy. Use the Print button above to save as PDF — the printable view drops the back link, recolors text
        for paper, and forces single-column.
      </p>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="section-title text-sm font-semibold text-emerald-300 uppercase tracking-wider mb-3 border-b border-stone-800 pb-1">
              {section.title}
            </h2>
            <BulletList nodes={section.bullets} />
          </section>
        ))}
      </div>
    </div>
  )
}
