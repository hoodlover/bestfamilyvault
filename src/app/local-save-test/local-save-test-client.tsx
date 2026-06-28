'use client'

import { useState } from 'react'

type LocalSaveResponse = {
  ok: boolean
  dataDir?: string
  fileName?: string
  saved?: {
    message?: string
    savedAt?: string
    dataDir?: string
  } | null
  error?: string
}

export function LocalSaveTestClient() {
  const [result, setResult] = useState<LocalSaveResponse | null>(null)
  const [message, setMessage] = useState('Browser data can be cleared, but this file should remain.')
  const [status, setStatus] = useState('Checking save folder...')

  async function loadSaved() {
    setStatus('Checking save folder...')
    const response = await fetch('/api/local-save-test', { cache: 'no-store' })
    const data = (await response.json()) as LocalSaveResponse
    setResult(data)
    setStatus(data.ok ? 'Ready' : 'Could not read the save folder')
  }

  async function saveTest() {
    setStatus('Saving test file...')
    const response = await fetch('/api/local-save-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    const data = (await response.json()) as LocalSaveResponse
    setResult(data)
    setStatus(data.ok ? 'Saved to disk' : 'Save failed')
  }

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-8 text-stone-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <p className="vault-kicker">RailHelper local storage bridge</p>
          <h1 className="mt-3 text-3xl font-semibold">Save folder test</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">
            This writes a real JSON file into the folder selected during install. After saving,
            clear browser data, reopen this page, and load it again.
          </p>
        </div>

        <div className="vault-card rounded-lg p-5">
          <label className="block text-sm font-medium text-stone-200" htmlFor="local-message">
            Test message
          </label>
          <textarea
            id="local-message"
            className="mt-2 min-h-28 w-full rounded-md border border-stone-700 bg-stone-950 p-3 text-sm text-stone-100 outline-none focus:border-emerald-500"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-emerald-400"
              type="button"
              onClick={saveTest}
            >
              Save test file
            </button>
            <button
              className="rounded-md border border-stone-600 px-4 py-2 text-sm font-semibold text-stone-100 hover:border-stone-400"
              type="button"
              onClick={loadSaved}
            >
              Load saved file
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-stone-800 bg-black/30 p-5">
          <p className="text-sm font-semibold text-stone-200">{status}</p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div>
              <dt className="text-stone-500">Save folder</dt>
              <dd className="mt-1 break-all font-mono text-stone-100">
                {result?.dataDir ?? 'Not checked yet'}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Test file</dt>
              <dd className="mt-1 font-mono text-stone-100">
                {result?.fileName ?? 'Not checked yet'}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Last saved</dt>
              <dd className="mt-1 text-stone-100">
                {result?.saved?.savedAt ?? 'Nothing saved yet'}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Saved message</dt>
              <dd className="mt-1 whitespace-pre-wrap text-stone-100">
                {result?.saved?.message ?? result?.error ?? 'Nothing loaded yet'}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  )
}
