'use client'

import { useState } from 'react'
import { updateProfile } from '@/lib/actions/settings'
import { PhoneField, SsnField } from './copyable-fields'

interface Props {
  currentName: string
  /** ISO YYYY-MM-DD or '' if not set. */
  currentDateOfBirth: string
  currentPhone?: string
  currentAddress?: string
  currentSsn?: string
  currentDriversLicense?: string
  /** ISO YYYY-MM-DD or '' — added v264 so the Family Info popout has a
   *  real source for the "DL exp" field. */
  currentDriversLicenseExpiry?: string
  currentPassport?: string
  /** ISO YYYY-MM-DD or '' — added v264; only set for parents. The
   *  Family Info popout reads this for the "Anniversary" row on
   *  Lance + Heather. */
  currentAnniversary?: string
}

export function ProfileForm({
  currentName,
  currentDateOfBirth,
  currentPhone = '',
  currentAddress = '',
  currentSsn = '',
  currentDriversLicense = '',
  currentDriversLicenseExpiry = '',
  currentPassport = '',
  currentAnniversary = '',
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await updateProfile(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Display Name</label>
        <input
          name="name"
          required
          defaultValue={currentName}
          className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Birthday <span className="text-stone-500 font-normal">(drives the dashboard banner)</span>
          </label>
          <input
            name="dateOfBirth"
            type="date"
            defaultValue={currentDateOfBirth}
            className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Anniversary <span className="text-stone-500 font-normal">(parents only)</span>
          </label>
          <input
            name="anniversary"
            type="date"
            defaultValue={currentAnniversary}
            className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
      </div>

      <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3 text-xs text-emerald-100">
        Filling these in is optional, but it makes future ID, account, and paperwork entries much faster.
        New forms can prefill them and you can still override anything.
      </div>

      <PhoneField name="phone" defaultValue={currentPhone} />

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Address</label>
        <textarea
          name="address"
          rows={3}
          defaultValue={currentAddress}
          className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition resize-y"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SsnField name="ssn" defaultValue={currentSsn} />
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Driver&rsquo;s License #</label>
          <input
            name="driversLicense"
            defaultValue={currentDriversLicense}
            className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          Driver&rsquo;s License expires <span className="text-stone-500 font-normal">(surfaces on the Family Info popout)</span>
        </label>
        <input
          name="driversLicenseExpiry"
          type="date"
          defaultValue={currentDriversLicenseExpiry}
          className="w-full sm:max-w-xs px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Passport #</label>
        <input
          name="passport"
          defaultValue={currentPassport}
          className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">
          Profile updated.
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="py-2 px-5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 text-white text-sm font-medium rounded-lg transition"
      >
        {loading ? 'Saving...' : 'Save'}
      </button>
    </form>
  )
}
