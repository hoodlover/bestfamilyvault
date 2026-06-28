'use client'

import { useState, useTransition } from 'react'
import { FolderInput, RefreshCw, ClipboardCheck, Clipboard } from 'lucide-react'
import { syncVaultInboxNow } from '@/lib/actions/vault-inbox'

// PowerShell one-liner — chains cd + the npm script so the user pastes once
// and runs once. `;` works in both 5.1 and 7; `&&` is unavailable in 5.1.
const REMOTE_SYNC_COMMAND = 'cd C:\\Projects\\cobbvault; npm run import:inbox'

export function VaultInboxSyncPanel({ available = true }: { available?: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [ok, setOk] = useState<boolean | null>(null)
  // Remote-mode UX: when the button is clicked from a server that can't
  // actually run the sync (deployed Vercel, mobile PWA, etc.), we copy the
  // terminal command to the clipboard and surface a visible block of what
  // was copied. `copied` flashes the icon for 2s so the user has feedback.
  const [copied, setCopied] = useState(false)

  function runSync() {
    setMessage(null)
    setOutput(null)
    setOk(null)
    startTransition(async () => {
      const res = await syncVaultInboxNow()
      setOk(res.ok)
      setMessage(res.message)
      setOutput(trimOutput(res.output ?? ''))
    })
  }

  async function copySyncCommand() {
    try {
      await navigator.clipboard.writeText(REMOTE_SYNC_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail in non-secure contexts / older browsers.
      // Leave the visible command block so the user can hand-copy.
      setCopied(false)
    }
  }

  const handleClick = available ? runSync : copySyncCommand

  return (
    <section className="mb-8 rounded-xl border border-stone-800 bg-stone-900/45 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-600/20 bg-emerald-600/10">
            <FolderInput size={20} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-stone-100">Vault File Drop</h2>
            <p className="mt-0.5 text-xs text-stone-400">
              Drop PDFs or images into <span className="text-stone-300">C:\Users\lance\Documents\Vault File Drop</span>.
            </p>
            {!available && (
              <p className="mt-1 text-xs text-amber-400/90">
                Remote view — tap to copy the terminal command, then paste in PowerShell on the PC with the folder. (Auto-imports each night either way.)
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          title={available ? undefined : 'Copy the terminal command to your clipboard'}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {available ? (
            <>
              <RefreshCw size={14} className={isPending ? 'animate-spin' : ''} />
              {isPending ? 'Syncing...' : 'Sync now'}
            </>
          ) : copied ? (
            <>
              <ClipboardCheck size={14} />
              Copied!
            </>
          ) : (
            <>
              <Clipboard size={14} />
              Copy sync command
            </>
          )}
        </button>
      </div>

      {/* Remote mode: show the command block beneath so the user has a
          visual fallback if the Clipboard API was blocked (non-secure
          context, permissions denied, etc.). Available mode just keeps
          this hidden — the inline sync output below is enough. */}
      {!available && (
        <div className="mt-3 rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
            Run this in PowerShell
          </p>
          <pre className="overflow-auto whitespace-pre-wrap text-xs text-emerald-300 font-mono">{REMOTE_SYNC_COMMAND}</pre>
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2">
          <p className={ok ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>{message}</p>
          {output && <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs text-stone-400">{output}</pre>}
        </div>
      )}
    </section>
  )
}

function trimOutput(value: string) {
  const lines = value.split(/\r?\n/).filter(Boolean)
  return lines.slice(-24).join('\n')
}
