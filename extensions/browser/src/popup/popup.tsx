// Toolbar popup. Shows pairing status, the active tab's matching
// credentials, and a free-text search for everything else. Each row
// can fill the active tab, or copy the username / password directly.

import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message, Response } from '../lib/messages'
import type { Credential } from '../lib/api'

function ask(msg: Message): Promise<Response> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: Response) => resolve(response))
  })
}

function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [domain, setDomain] = useState<string>('')
  const [siteCreds, setSiteCreds] = useState<Credential[]>([])
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Credential[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initial bootstrap: status + per-site credentials.
  useEffect(() => {
    ;(async () => {
      const status = await ask({ type: 'getStatus' })
      if ('paired' in status) {
        setPaired(status.paired)
        setUserName(status.userName)
        if (!status.paired) {
          setLoading(false)
          return
        }
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const url = tab?.url ? new URL(tab.url) : null
      const host = url?.hostname ?? ''
      setDomain(host)
      if (host) {
        const res = await ask({ type: 'getCredentials', domain: host })
        if ('credentials' in res) setSiteCreds(res.credentials)
        else if ('error' in res) setError(res.error ?? null)
      }
      setLoading(false)
    })()
  }, [])

  // Debounced search.
  const searchTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(async () => {
      const res = await ask({ type: 'searchCredentials', q: query.trim() })
      if ('credentials' in res) {
        setSearchResults(res.credentials)
      } else {
        setSearchResults([])
      }
      setSearching(false)
    }, 250) as unknown as number
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [query])

  function fillAndClose(c: Credential) {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.id) return
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: ({ username, password }: { username: string | null; password: string | null }) => {
          const setVal = (el: HTMLInputElement, v: string) => {
            const proto = Object.getPrototypeOf(el)
            const desc = Object.getOwnPropertyDescriptor(proto, 'value')
            if (desc?.set) desc.set.call(el, v)
            else el.value = v
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          }
          const pwds = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
            .filter((el) => el.offsetParent != null && !el.disabled && !el.readOnly)
          if (pwds.length === 0) return
          const pwdEl = pwds[0]
          if (password) setVal(pwdEl, password)
          if (username) {
            const userInputs = Array.from(document.querySelectorAll<HTMLInputElement>(
              'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
            ))
            for (const el of userInputs) {
              if (el.compareDocumentPosition(pwdEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
                setVal(el, username)
              }
            }
          }
          pwdEl.focus()
        },
        args: [{ username: c.username, password: c.password }],
      })
      window.close()
    })
  }

  if (loading) {
    return (
      <>
        <Header />
        <div className="body"><div className="empty">Loading…</div></div>
      </>
    )
  }

  if (paired === false) {
    return (
      <>
        <Header subtitle="Not paired yet" />
        <div className="body">
          <p style={{ color: '#a8a29e', marginTop: 0, marginBottom: 14 }}>
            Open Family Vault on your computer or phone, head to{' '}
            <strong>Settings → Autofill — Linked Devices</strong>, and tap{' '}
            <strong>Pair new device</strong> for a 6-digit code.
          </p>
          <button className="primary" onClick={() => chrome.runtime.openOptionsPage()}>
            Pair this browser
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <Header
        subtitle={
          <>
            Connected as <strong>{userName ?? '(unknown)'}</strong>
            {domain ? <> · {domain}</> : null}
          </>
        }
      />

      <div className="body">
        <div className="search">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all logins…"
            type="search"
          />
        </div>

        {error && <div className="err">{error}</div>}

        {/* Site matches at top, hidden when actively searching */}
        {!query.trim() && (
          <>
            <div className="section-label">{domain || 'This site'}</div>
            {siteCreds.length === 0 ? (
              <div className="empty">No saved logins for this site.</div>
            ) : (
              <CredList creds={siteCreds} onFill={fillAndClose} />
            )}
          </>
        )}

        {/* Search results */}
        {query.trim() && (
          <>
            <div className="section-label">
              {searching ? 'Searching…' : `${searchResults?.length ?? 0} match${searchResults?.length === 1 ? '' : 'es'}`}
            </div>
            {searchResults?.length ? (
              <CredList creds={searchResults} onFill={fillAndClose} />
            ) : !searching ? (
              <>
                <div className="empty">No matches.</div>
                <CreatePills />
              </>
            ) : null}
          </>
        )}

        {/* Same shortcuts when looking at "This site" with no saved
            logins — quickest way to get from "I'm logged in but nothing
            here" to actually saving the credential. */}
        {!query.trim() && siteCreds.length === 0 && !loading && <CreatePills />}
      </div>

      <Footer
        onLock={async () => {
          await ask({ type: 'lock' })
          setPaired(false)
          setSiteCreds([])
          setSearchResults(null)
          setQuery('')
        }}
      />
    </>
  )
}

function Header({ subtitle }: { subtitle?: React.ReactNode }) {
  return (
    <div className="header">
      <img src={chrome.runtime.getURL('icons/48.png')} alt="" />
      <div className="titles">
        <h1>Family Vault</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
    </div>
  )
}

function Footer({ onLock }: { onLock: () => void }) {
  return (
    <div className="footer">
      <button className="ghost" onClick={() => chrome.runtime.openOptionsPage()}>
        Settings
      </button>
      <button className="ghost danger" onClick={onLock} title="Sign out of vault on this browser">
        Lock
      </button>
    </div>
  )
}

function CredList({ creds, onFill }: { creds: Credential[]; onFill: (c: Credential) => void }) {
  return (
    <div>
      {creds.map((c) => (
        <CredRow key={c.id} cred={c} onFill={() => onFill(c)} />
      ))}
    </div>
  )
}

function CredRow({ cred, onFill }: { cred: Credential; onFill: () => void }) {
  const display = useMemo(() => {
    if (cred.url) {
      try {
        return new URL(cred.url).hostname
      } catch { /* fall through */ }
    }
    return null
  }, [cred.url])

  return (
    <div className="row">
      <div className="info" onClick={onFill} title="Fill on the active tab">
        <div className="title">{cred.title}</div>
        <div className="username">
          {cred.username ?? <em>(no username)</em>}
          {display ? ` · ${display}` : ''}
        </div>
      </div>
      <div className="actions">
        {cred.username && <CopyButton label="user" value={cred.username} />}
        {cred.password && <CopyButton label="pass" value={cred.password} />}
      </div>
    </div>
  )
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`icon ${copied ? 'copied' : ''}`}
      title={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch { /* clipboard blocked */ }
      }}
    >
      {copied ? '✓' : label}
    </button>
  )
}

// Quick-create shortcuts shown when a search yields nothing (or the
// active site has no saved logins). Each pill opens the vault's "new"
// form in a new tab — popup auto-closes after dispatch since chrome
// closes the popup as soon as the user's focus shifts.
function CreatePills() {
  function open(path: string) {
    ask({ type: 'openVaultPath', path }).finally(() => window.close())
  }
  return (
    <div className="create-pills">
      <button type="button" className="pill" onClick={() => open('/entries/new?type=login')}>
        <span className="plus">+</span> Password
      </button>
      <button type="button" className="pill" onClick={() => open('/entries/new?type=app_login')}>
        <span className="plus">+</span> App
      </button>
      <button type="button" className="pill" onClick={() => open('/notes/new')}>
        <span className="plus">+</span> Note
      </button>
      <button type="button" className="pill" onClick={() => open('/entries/new')}>
        <span className="plus">+</span> Entry
      </button>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
