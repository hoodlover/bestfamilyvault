'use client'

// Vault detail-page field with optional reveal + copy actions. Renders
// as a two-row block:
//   ┌────────────────────────┐
//   │ LABEL          [👁][📋] │  ← icons aligned right
//   │ ••••                    │  ← value (dots or revealed)
//   └────────────────────────┘
// Previously the icons sat to the right of the value, but Lance asked
// for them on the label row so they don't shift horizontally when the
// value toggles between '••••' and the real digits — and so the icons
// stay aligned across stacked rows.

import { useState } from 'react'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'

interface SecretFieldProps {
  label: string
  value: string
  secret?: boolean
  copyable?: boolean
}

export function SecretField({ label, value, secret = false, copyable = false }: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleReveal() {
    setRevealed((r) => !r)
  }

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Always render exactly 4 dots when hidden — uniform across account
  // numbers, routing numbers, passwords, SSN, CVV. Previously the dot
  // count mirrored value.length which leaked length and made the detail
  // page feel cluttered with rows of 11-16 dots.
  const displayed = secret && !revealed ? '••••' : value
  const hasIcons = secret || copyable

  return (
    <div className="group">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{label}</label>
        {hasIcons && (
          // Buttons always visible on touch devices. On desktop they
          // sit at 50% opacity by default (still visible so the user
          // sees the affordance) and pop to 100% on row hover.
          <div className="flex items-center gap-1 opacity-100 md:opacity-50 md:group-hover:opacity-100 transition-opacity">
            {secret && (
              <button
                onClick={handleReveal}
                title={revealed ? 'Hide' : 'Reveal'}
                className="p-1 text-stone-500 hover:text-stone-300 rounded transition"
              >
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
            {copyable && (
              <button
                onClick={handleCopy}
                title="Copy"
                className="p-1 text-stone-500 hover:text-stone-300 rounded transition"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-1.5">
        <span className="text-stone-300 text-sm font-mono break-all">{displayed}</span>
      </div>
    </div>
  )
}
