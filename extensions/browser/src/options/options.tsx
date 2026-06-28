// Extension options page. Two jobs:
//   1. Pair this browser with the vault using the 6-digit code the user
//      gets from Settings → Linked Devices.
//   2. Override the vault base URL (for local dev against
//      http://localhost:3000).

import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { pairComplete } from '../lib/api'
import {
  clearPairing,
  getSync,
  getToken,
  getVaultBaseUrl,
  setPairing,
  setSync,
} from '../lib/storage'
import { STORAGE_KEYS } from '../lib/config'

function App() {
  const [paired, setPaired] = useState<boolean>(false)
  const [userName, setUserName] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('Chrome — this device')
  const [baseUrl, setBaseUrl] = useState('')
  const [revealInPicker, setRevealInPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const token = await getToken()
      setPaired(!!token)
      const u = await getSync<string | null>(STORAGE_KEYS.userName)
      setUserName(u ?? null)
      setBaseUrl(await getVaultBaseUrl())
      const reveal = await getSync<boolean>(STORAGE_KEYS.revealInPicker)
      setRevealInPicker(reveal === true)
    })()
  }, [])

  async function toggleReveal(next: boolean) {
    setRevealInPicker(next)
    await setSync(STORAGE_KEYS.revealInPicker, next)
  }

  async function pair() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await pairComplete({
        code: code.replace(/\D/g, '').slice(0, 6),
        name: name.trim() || 'Chrome — this device',
      })
      await setPairing({
        token: res.token,
        sessionId: res.sessionId,
        userName: res.userName,
      })
      setPaired(true)
      setUserName(res.userName)
      setSuccess(`Paired as ${res.userName ?? '(unknown)'}.`)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pair failed.')
    } finally {
      setBusy(false)
    }
  }

  async function unpair() {
    if (!confirm('Unpair this browser? You\'ll need a new code to autofill again.')) return
    await clearPairing()
    setPaired(false)
    setUserName(null)
    setSuccess('Unpaired.')
  }

  async function saveBaseUrl() {
    await setSync(STORAGE_KEYS.vaultBaseUrl, baseUrl.trim())
    setSuccess(`Vault URL set to ${baseUrl.trim()}.`)
  }

  return (
    <div className="container">
      <h1>Family Vault — Extension</h1>
      <p className="muted">
        Pair this browser to the vault to autofill saved logins on any
        website. Codes come from Settings → Linked Devices on the vault.
      </p>

      <h2>Pairing</h2>
      {paired ? (
        <>
          <p>Paired as <strong>{userName ?? '(unknown)'}</strong>.</p>
          <button className="ghost" onClick={unpair}>Unpair this browser</button>
        </>
      ) : (
        <>
          <label>6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoFocus
          />
          <div style={{ height: 12 }} />
          <label>Device name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Chrome — this laptop"
          />
          <div style={{ height: 12 }} />
          <button onClick={pair} disabled={busy || code.replace(/\D/g, '').length !== 6}>
            {busy ? 'Pairing…' : 'Pair'}
          </button>
        </>
      )}

      <h2>Picker behavior</h2>
      <p className="muted">
        When multiple credentials match a site (or even one match), the
        picker can show a password preview so you can verify before
        filling — useful for avoiding lockouts when an account has
        rotated through several passwords.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={revealInPicker}
          onChange={(e) => toggleReveal(e.target.checked)}
        />
        <span>Show password preview in picker (off = filename + username only)</span>
      </label>

      <h2>Vault URL</h2>
      <p className="muted">
        Set this if you're testing against a local dev vault. Default is the
        production deployment.
      </p>
      <div className="row">
        <div className="grow">
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://bestfamilyvault.vercel.app"
          />
        </div>
        <button className="ghost" onClick={saveBaseUrl}>Save</button>
      </div>

      {error && <p className="err">{error}</p>}
      {success && <p className="ok">{success}</p>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
