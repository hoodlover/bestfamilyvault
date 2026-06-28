'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  text: string
  /** Optional accessible label; defaults to "Copy". */
  label?: string
  className?: string
}

/** Small "copy to clipboard" button that flips to a check mark for ~1.5s on
 *  success. Use it next to any read-only field a user might want to paste
 *  elsewhere — note content, login URL, etc. */
export function CopyButton({ text, label = 'Copy', className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // navigator.clipboard.writeText can reject in non-secure contexts (HTTP).
      // Fall back to the legacy approach.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied!' : label}
      aria-label={label}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-700 text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition text-xs ${className}`}
    >
      {copied ? (
        <>
          <Check size={12} className="text-emerald-400" />
          Copied
        </>
      ) : (
        <>
          <Copy size={12} />
          Copy
        </>
      )}
    </button>
  )
}
