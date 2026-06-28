'use client'

// Reusable form fields with auto-format on blur + a copy button on the
// right edge. Used wherever an SSN or phone number is collected — settings
// profile, new entry, edit entry. Keeps the formatter and copy UX in one
// place so all SSN/phone inputs in the app behave identically.

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { fmtSsn, fmtPhone } from '@/lib/format'

interface BaseProps {
  /** Form field name (passed through to the inner <input>). */
  name?: string
  defaultValue?: string
  /** Visible label above the input. */
  label?: string
  placeholder?: string
}

function CopyableInput({
  value,
  onChange,
  onBlur,
  name,
  label,
  placeholder,
  inputMode = 'numeric',
  maxLength,
}: {
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  name?: string
  label?: string
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url'
  maxLength?: number
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts — silently no-op.
    }
  }

  return (
    <div>
      {label && <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>}
      <div className="relative">
        <input
          type="text"
          name={name}
          value={value}
          inputMode={inputMode}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="w-full px-3 py-2.5 pr-11 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
        <button
          type="button"
          onClick={copy}
          disabled={!value}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'Copied' : 'Copy'}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-400 hover:text-emerald-400 disabled:opacity-40 disabled:hover:text-stone-400 transition"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  )
}

/**
 * SSN input. Reformats live during typing AND on blur (so a paste of raw
 * digits, or typing without the dashes, still lands as 000-00-0000).
 */
export function SsnField({ name = 'ssn', defaultValue = '', label = 'SSN', placeholder = '•••-••-••••' }: BaseProps) {
  const [value, setValue] = useState(() => fmtSsn(defaultValue))
  // No maxLength — the browser applies that BEFORE onChange runs, so a
  // paste that includes any leading text (e.g. "ssn: 123-45-6789") would
  // be silently truncated. The formatter strips non-digits and caps at 9
  // digits anyway, so paste-friendly input is safe.
  return (
    <CopyableInput
      name={name}
      label={label}
      placeholder={placeholder}
      value={value}
      onChange={(v) => setValue(fmtSsn(v))}
      onBlur={() => setValue((v) => fmtSsn(v))}
    />
  )
}

/**
 * Phone input. Reformats to 000.000.0000 — both on blur AND on every change,
 * so a paste like "(404) 654-7453" or "+1 404 654 7453" lands clean. The
 * previous version had a maxLength={12} cap that the browser applied
 * BEFORE onChange ran, silently truncating any pasted value longer than
 * 12 characters and dropping digits at the end.
 */
export function PhoneField({ name = 'phone', defaultValue = '', label = 'Phone', placeholder = '000.000.0000' }: BaseProps) {
  const [value, setValue] = useState(() => fmtPhone(defaultValue))
  return (
    <CopyableInput
      name={name}
      label={label}
      placeholder={placeholder}
      value={value}
      inputMode="tel"
      onChange={(v) => setValue(fmtPhone(v))}
      onBlur={() => setValue((v) => fmtPhone(v))}
    />
  )
}
