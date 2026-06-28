'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Send, KeyRound, FileText } from 'lucide-react'
import { HelpPopout } from '@/components/ui/help-popout'

interface Match {
  id: string
  kind: 'entry' | 'note'
  title: string
  href: string
  category?: string
  why: string
}

export default function AskVaultPage() {
  const searchParams = useSearchParams()
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [rephrasal, setRephrasal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  // Pick up ?q= from the URL on mount + auto-run. Lets the dashboard
  // hero search land directly into results.
  useEffect(() => {
    const initial = searchParams.get('q')?.trim()
    if (initial) {
      setQ(initial)
      runAsk(initial)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runAsk(question: string) {
    setBusy(true)
    setError(null)
    setMatches([])
    setRephrasal(null)
    try {
      const res = await fetch('/api/ask-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setMatches(data.matches ?? [])
        setRephrasal(data.rephrasal ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setHasSearched(true)
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (!question) return
    await runAsk(question)
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <header className="mb-6 md:mb-8">
        <h1 className="flex items-center gap-2 text-2xl md:text-3xl font-bold text-stone-100">
          <img src="/icons/cobb/icons/brands/claude2.png" width={32} height={32} alt="" className="object-contain rounded" />
          Ask the vault
          <HelpPopout
            title="Ask the vault"
            sections={[
              {
                heading: 'How to use it',
                tips: [
                  { title: 'Plain English', description: '"What\'s the Wi-Fi password at the cabin?" or "When does the Mercedes registration expire?" — Claude searches for the right entry and quotes it.' },
                  { title: 'Cross-cutting questions', description: '"Which credit cards have annual fees?" — Claude reads multiple entries and summarizes.' },
                  { title: 'Citations', description: 'Every answer points to the specific entry / note it pulled from so you can verify.' },
                ],
              },
              {
                heading: 'Privacy + limits',
                tips: [
                  { title: 'Only what you can see', description: 'Claude only sees entries / notes / files visible to your role. Private items stay private from non-superusers.' },
                  { title: 'No vault data trains models', description: 'Anthropic API doesn\'t train on this traffic per their no-training policy. Vault content stays in the call.' },
                  { title: 'No remembering', description: 'Each question is independent — no chat history is kept on the server.' },
                ],
              },
              {
                heading: 'When to use Search instead',
                tips: [
                  { title: 'Specific phrase lookup', description: 'If you already know the keyword (e.g. an account number), /search is instant and free; /ask is slower + costs an API call.' },
                ],
              },
            ]}
          />
        </h1>
        <p className="text-sm text-stone-400 mt-1">
          Plain-English search — Claude looks across every entry and note you can see and points to the best matches.
        </p>
      </header>

      <form onSubmit={ask} className="mb-6">
        <div className="relative">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Where do we keep the cabin keys? What's the WiFi password? When does the AAA membership renew?"
            disabled={busy}
            autoFocus
            className="w-full px-4 py-3 pr-28 bg-stone-900 border border-stone-700 rounded-xl text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 disabled:opacity-60 text-base"
          />
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition shadow"
          >
            {busy ? (
              <>
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                Thinking…
              </>
            ) : (
              <>
                <Send size={13} />
                Ask
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-stone-500 mt-2 leading-relaxed">
          Tip: ask the way you&rsquo;d ask a person. <em>&ldquo;What was that vet bill from last June?&rdquo;</em> works better than keyword soup.
        </p>
      </form>

      {error && (
        <div className="mb-4 rounded-xl border border-red-700/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {rephrasal && (
        <p className="mb-4 text-xs text-stone-500 italic">Looking for: {rephrasal}</p>
      )}

      {hasSearched && !busy && matches.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-stone-700 bg-stone-900/40 p-8 text-center text-sm text-stone-500">
          Nothing matched. Try rephrasing — sometimes &ldquo;the netflix one&rdquo; works better than the precise word.
        </div>
      )}

      <div className="space-y-3">
        {matches.map((m) => (
          <Link
            key={`${m.kind}:${m.id}`}
            href={m.href}
            className="block rounded-xl border border-stone-700 bg-stone-900/50 hover:bg-stone-900 hover:border-emerald-700/40 p-4 transition group"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-800 shrink-0">
                {m.kind === 'entry' ? (
                  <KeyRound size={16} className="text-emerald-300" />
                ) : (
                  <FileText size={16} className="text-amber-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold text-stone-100 group-hover:text-white transition truncate">{m.title}</h3>
                  {m.category && (
                    <span className="text-[10px] uppercase tracking-wider text-stone-500">
                      {m.category}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-stone-400 leading-relaxed">{m.why}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
