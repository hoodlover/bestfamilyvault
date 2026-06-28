'use client'

// Click → copies a shell command to the clipboard, shows a "Copied!"
// confirmation, and (optionally) reveals the command inline so the user
// can hand-copy if the Clipboard API was blocked. Pattern matches the
// remote-mode VaultInboxSyncPanel button.

import { useState } from 'react'
import { Clipboard, ClipboardCheck } from 'lucide-react'

interface Props {
  /** Shell command to copy. Pasted as-is — keep it a single line that
   *  works in the user's default shell (PowerShell on Windows). */
  command: string
  /** Button label shown before copying. */
  label: string
  /** Optional hint shown beneath the button, e.g. "paste in PowerShell". */
  hint?: string
  className?: string
}

export function CopyCommandButton({ command, label, hint, className }: Props) {
  const [copied, setCopied] = useState(false)
  const [reveal, setReveal] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API blocked (non-secure context, permissions denied) —
      // reveal the command so the user can hand-copy.
      setReveal(true)
      setCopied(false)
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleCopy}
        title={hint}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 rounded-lg transition no-print"
      >
        {copied ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}
        {copied ? 'Copied!' : label}
      </button>
      {(reveal || copied) && (
        <div className="mt-2 rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2 max-w-xl">
          {hint && (
            <p className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
              {hint}
            </p>
          )}
          <pre className="overflow-auto whitespace-pre-wrap text-xs text-emerald-300 font-mono break-all">{command}</pre>
        </div>
      )}
    </div>
  )
}
