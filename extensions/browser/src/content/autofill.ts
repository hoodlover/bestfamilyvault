// Content script that runs on every page (matches: <all_urls>). It:
//
//   1. On document_idle, walks the DOM looking for login-shaped forms
//      (a password input + the nearest preceding text/email input).
//   2. Asks the service worker if the vault has matching credentials
//      for the page's registrable domain.
//   3. If yes, attaches a small floating "fill" button to each
//      password field. Clicking it offers a list to pick from; pick
//      one and the username + password fields fill.
//
// All injected UI lives in a closed Shadow DOM root attached to a
// single host element. That isolates our styles from the page (no
// CSP-strict bank's policy breaks us, no clobbering of host CSS),
// and keeps page scripts from poking our internals.
//
// Trust model:
//   - We use the TAB's top-frame URL for credential matching, not
//     the script's own location. A nested iframe on a malicious page
//     should not be able to convince us to fill the parent's vault
//     entries.
//   - We refuse to fill when the form's `action` attribute points to
//     a different absolute origin than the page (POST-elsewhere
//     phishing).
//   - We refuse on Punycode (xn--) hostnames since these are the
//     classic homograph-attack vector. The user gets a visible warn.
//
// Heuristic field detection is purposely conservative — we look for
// `<input type="password">` elements that are visible and editable,
// then climb DOM siblings to find the nearest preceding text/email
// input as the username. Sites with weird custom inputs (bank one-
// time-code generators, etc.) won't get autofill widgets, which is
// fine — better to miss than to fill the wrong field.

import type {
  Credential,
  CredentialsResponse,
  Message,
  Response,
  SaveDraft,
  TabContextResponse,
  UpdateDraft,
} from '../lib/messages'

// Skip injection on the vault itself + on chrome internal pages.
const SKIP_HOSTS = ['chrome://', 'chrome-extension://', 'about:', 'moz-extension://']
const skipped = SKIP_HOSTS.some((p) => location.href.startsWith(p))

let tabContext: TabContextResponse | null = null
let cachedCredentials: Credential[] | null = null
let dismissedForPage = false
const widgetByPasswordEl = new Map<HTMLInputElement, HTMLElement>()
// Track the last value the user typed into each password field, so we
// can offer to save it on submit. We only consider it "user-typed" if
// it didn't come from our autofill — `lastFilledByUs` records what we
// just filled so we can skip those.
const lastTypedByPasswordEl = new WeakMap<HTMLInputElement, string>()
const lastFilledByUs = new WeakMap<HTMLInputElement, string>()
const watchingForms = new WeakSet<HTMLFormElement>()
let saveBannerOpen = false
let updateBannerOpen = false

// ─── Shadow DOM root ────────────────────────────────────────────────────────
//
// One host element + one closed shadow root holds all our injected UI.
// Removing the host wipes everything (used by the × dismiss). Styles are
// scoped to the shadow root so the page can't reach in to restyle us
// and we can't leak styles into the page.

let shadowRoot: ShadowRoot | null = null

function getShadow(): ShadowRoot {
  if (shadowRoot) return shadowRoot
  const host = document.createElement('div')
  host.setAttribute('data-cobbvault-host', '1')
  // The host has zero size; widgets inside use position:fixed (viewport
  // coords) so they don't depend on the host's layout.
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 0',
    'height: 0',
    'z-index: 2147483647',
    'pointer-events: none',
  ].join(';')
  document.documentElement.appendChild(host)
  shadowRoot = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = SHADOW_CSS
  shadowRoot.appendChild(style)
  return shadowRoot
}

const SHADOW_CSS = `
  * { box-sizing: border-box; }
  .cv-toast {
    pointer-events: auto;
    position: fixed;
    bottom: 16px;
    right: 16px;
    background: #052e1a;
    color: #ecfdf5;
    border: 1px solid #10b981;
    border-radius: 999px;
    padding: 8px 14px 8px 16px;
    font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    display: inline-flex;
    align-items: center;
    gap: 12px;
    max-width: 360px;
  }
  .cv-toast .undo {
    background: transparent;
    color: #6ee7b7;
    border: none;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    padding: 0;
  }
  .cv-toast .undo:hover { color: #ecfdf5; text-decoration: underline; }
  .cv-pill, .cv-picker, .cv-banner, .cv-warn {
    pointer-events: auto;
    font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #ecfdf5;
  }
  .cv-pill {
    position: fixed;
    background: #064e3b;
    border: 1px solid #10b981;
    border-radius: 8px;
    padding: 4px 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .cv-pill .label { cursor: pointer; }
  .cv-pill .x {
    cursor: pointer;
    opacity: 0.7;
    padding: 0 4px;
    border-left: 1px solid #10b981;
    margin-left: 2px;
    font-size: 14px;
    line-height: 1;
  }
  .cv-pill .x:hover { opacity: 1; }
  .cv-warn {
    position: fixed;
    background: #422006;
    color: #fde68a;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 6px 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    max-width: 280px;
  }
  .cv-picker {
    position: fixed;
    background: #1c1917;
    color: #e7e5e4;
    border: 1px solid #57534e;
    border-radius: 8px;
    padding: 6px 0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    min-width: 200px;
    max-width: 320px;
  }
  .cv-picker .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    cursor: pointer;
  }
  .cv-picker .row:hover { background: #292524; }
  .cv-picker .row .title { font-weight: 600; color: #f5f5f4; }
  .cv-picker .row .meta { font-size: 11px; color: #a8a29e; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cv-picker .row .pw {
    font: 11px ui-monospace, Menlo, Consolas, monospace;
    background: #0c0a09;
    border: 1px solid #44403c;
    padding: 2px 6px;
    border-radius: 4px;
    color: #f0fdf4;
  }
  .cv-picker .row .eye {
    background: transparent;
    border: none;
    color: #a8a29e;
    cursor: pointer;
    padding: 0 2px;
    font: inherit;
  }
  .cv-picker .row .eye:hover { color: #f5f5f4; }
  .cv-picker .row .fillbtn {
    align-self: flex-end;
    background: #10b981;
    color: #052e1a;
    border: none;
    padding: 3px 10px;
    border-radius: 4px;
    font: 11px/1 inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .cv-picker .row .fillbtn:hover { background: #34d399; }
  .cv-banner {
    position: fixed;
    top: 16px;
    right: 16px;
    background: #1c1917;
    color: #fafaf9;
    border: 1px solid #10b981;
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    min-width: 280px;
    max-width: 360px;
  }
  .cv-banner .heading {
    font-weight: 600;
    margin-bottom: 8px;
    color: #ecfdf5;
  }
  .cv-banner .detail {
    opacity: 0.85;
    margin-bottom: 12px;
    word-break: break-word;
  }
  .cv-banner .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .cv-banner button {
    font: inherit;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .cv-banner .btn-dismiss {
    background: transparent;
    color: #d6d3d1;
    border: 1px solid #57534e;
  }
  .cv-banner .btn-save {
    background: #10b981;
    color: #052e1a;
    border: none;
    font-weight: 600;
    padding: 6px 14px;
  }
  .cv-banner button:disabled { opacity: 0.6; cursor: default; }
  .cv-pwgen {
    position: fixed;
    background: #1c1917;
    color: #fafaf9;
    border: 1px solid #10b981;
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .cv-pwgen .pw {
    font: 13px/1.2 ui-monospace, Menlo, Consolas, monospace;
    background: #0c0a09;
    border: 1px solid #44403c;
    border-radius: 6px;
    padding: 8px 10px;
    word-break: break-all;
    color: #f0fdf4;
  }
  .cv-pwgen .actions { display: flex; gap: 6px; justify-content: flex-end; }
  .cv-pwgen button {
    font: inherit;
    border: 1px solid #44403c;
    background: transparent;
    color: #d6d3d1;
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .cv-pwgen button:hover { background: #292524; color: #fafaf9; }
  .cv-pwgen button.use {
    background: #10b981;
    color: #052e1a;
    font-weight: 600;
    border-color: #10b981;
  }
  .cv-pwgen button.use:hover { background: #34d399; }
  .cv-pwgen button.save {
    background: #047857;
    color: #ecfdf5;
    font-weight: 600;
    border-color: #047857;
  }
  .cv-pwgen button.save:hover { background: #059669; }
  .cv-pwgen .note {
    font-size: 11px;
    color: #a8a29e;
    line-height: 1.4;
  }
  .cv-pwgen .note a {
    color: #34d399;
    text-decoration: underline;
  }
  .cv-pwgen .note a:hover { color: #6ee7b7; }
`

// ─── Messaging ──────────────────────────────────────────────────────────────

async function ask(msg: Message): Promise<Response> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: Response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message ?? 'runtime error' })
      } else {
        resolve(response)
      }
    })
  })
}

async function loadTabContext(): Promise<void> {
  const res = await ask({ type: 'getTabContext' })
  if ('topUrl' in res && 'topHostname' in res) {
    tabContext = res
  }
}

function getTopHostname(): string {
  return tabContext?.topHostname || location.hostname
}

function getTopUrl(): string {
  return tabContext?.topUrl || location.href
}

function getTopTitle(): string {
  return tabContext?.topTitle || document.title || location.hostname
}

// ─── Security gates ─────────────────────────────────────────────────────────

function isPunycode(host: string): boolean {
  return host.split('.').some((label) => label.startsWith('xn--'))
}

/** Detect form action that POSTs cross-origin. We refuse to fill those. */
function getFormSubmissionHostname(form: HTMLFormElement | null): string | null {
  if (!form) return null
  const raw = form.getAttribute('action')
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) return null  // relative — same origin
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

// Common multi-segment public suffixes. We don't ship the full Public
// Suffix List in the content script — too heavy — but this list covers
// the ones an English-speaking family is likely to hit. Anything not
// matched here uses the default last-2-labels rule which is correct
// for *.com / *.net / *.org / *.io etc.
const MULTI_LABEL_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk', 'ltd.uk', 'plc.uk',
  'co.nz', 'net.nz', 'org.nz', 'gov.nz', 'ac.nz',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
  'co.kr', 'or.kr', 'go.kr',
  'com.br', 'org.br', 'gov.br',
])

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.')
  if (parts.length < 2) return host
  const last2 = parts.slice(-2).join('.')
  if (parts.length >= 3) {
    const last3 = parts.slice(-3).join('.')
    if (MULTI_LABEL_TLDS.has(last2)) return last3
  }
  return last2
}

function isFormSafe(passwordEl: HTMLInputElement): boolean {
  const submitHost = getFormSubmissionHostname(passwordEl.form)
  if (!submitHost) return true
  // eTLD+1 match — chase.com homepage posting to secure.chase.com is
  // legitimate and common. Strict hostname equality was over-strict.
  return registrableDomain(submitHost) === registrableDomain(location.hostname.toLowerCase())
}

function showCrossDomainWarn(near: HTMLInputElement, submitHost: string) {
  const shadow = getShadow()
  const warn = document.createElement('div')
  warn.className = 'cv-warn'
  warn.textContent = `⚠ This form posts to ${submitHost}. Vault won't autofill — copy from the toolbar instead.`
  positionFixed(warn, near)
  shadow.appendChild(warn)
  setTimeout(() => warn.remove(), 4000)
}

function showPunycodeWarn() {
  const shadow = getShadow()
  if (shadow.querySelector('[data-cv-punycode]')) return
  const warn = document.createElement('div')
  warn.className = 'cv-warn'
  warn.setAttribute('data-cv-punycode', '1')
  warn.style.top = '16px'
  warn.style.left = '50%'
  warn.style.transform = 'translateX(-50%)'
  warn.textContent = `⚠ Punycode hostname detected (${getTopHostname()}). Autofill disabled — verify the URL.`
  shadow.appendChild(warn)
  setTimeout(() => warn.remove(), 6000)
}

// ─── Field detection ────────────────────────────────────────────────────────

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const rect = el.getBoundingClientRect()
  // Real password inputs are big enough to show characters and be
  // clicked. Hidden 2FA / autofill-bait inputs are typically 0×0
  // (display:none) or tiny, so 30×12 catches them without being
  // too aggressive on real fields that responsive layouts shrink.
  if (rect.width < 30 || rect.height < 12) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) return false
  return true
}

function findUsernameForPassword(passwordEl: HTMLInputElement): HTMLInputElement | null {
  const form = passwordEl.form
  // Walk text/email/tel/username inputs that come BEFORE the password
  // in the DOM. Pick the closest visible one.
  const candidates = (form ?? document)
    .querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
  let best: HTMLInputElement | null = null
  for (const el of candidates) {
    if (!isVisible(el)) continue
    if (el.compareDocumentPosition(passwordEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = el // last one before the password wins
    }
  }
  return best
}

function findPasswordInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    .filter((el) => isVisible(el) && !el.disabled && !el.readOnly)
}

// ─── Pill widget ────────────────────────────────────────────────────────────

function makeWidget(passwordEl: HTMLInputElement, credentials: Credential[]): HTMLElement {
  const widget = document.createElement('div')
  widget.className = 'cv-pill'

  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = `🔑 ${credentials.length === 1 ? 'Fill from vault' : `${credentials.length} from vault`}`
  label.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const submitHost = getFormSubmissionHostname(passwordEl.form)
    if (submitHost && !isFormSafe(passwordEl)) {
      showCrossDomainWarn(passwordEl, submitHost)
      return
    }
    // Always open the picker showing each match's username and password
    // (password masked, with a per-row reveal toggle) — even for a single
    // match — so you can confirm you're filling the RIGHT credential before
    // it goes in. Silent auto-fill made it too easy to fill the wrong one
    // and get locked out.
    showPicker(passwordEl, credentials, true)
  })

  const dismiss = document.createElement('span')
  dismiss.className = 'x'
  dismiss.textContent = '×'
  dismiss.title = 'Hide vault autofill on this page'
  dismiss.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    dismissAllWidgets()
  })

  widget.appendChild(label)
  widget.appendChild(dismiss)
  return widget
}

function dismissAllWidgets() {
  dismissedForPage = true
  if (shadowRoot) {
    for (const node of shadowRoot.querySelectorAll('.cv-pill, .cv-picker')) node.remove()
  }
  observer.disconnect()
}

function maskPassword(pw: string): string {
  if (pw.length <= 6) return '•'.repeat(pw.length)
  return pw.slice(0, 2) + '•'.repeat(pw.length - 4) + pw.slice(-2)
}

function showPicker(
  passwordEl: HTMLInputElement,
  credentials: Credential[],
  revealEnabled: boolean,
) {
  const shadow = getShadow()
  const list = document.createElement('div')
  list.className = 'cv-picker'
  for (const c of credentials) {
    const row = document.createElement('div')
    row.className = 'row'

    const title = document.createElement('div')
    title.className = 'title'
    title.textContent = c.title
    row.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'meta'
    if (c.username) {
      const u = document.createElement('span')
      u.textContent = c.username
      meta.appendChild(u)
    }
    // Password preview — only when the option is on. Masked by default;
    // eye toggle reveals.
    if (revealEnabled && c.password) {
      const pwSpan = document.createElement('span')
      pwSpan.className = 'pw'
      pwSpan.textContent = maskPassword(c.password)

      const eye = document.createElement('button')
      eye.className = 'eye'
      eye.type = 'button'
      eye.title = 'Reveal password'
      eye.textContent = '👁'
      let revealed = false
      eye.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        revealed = !revealed
        pwSpan.textContent = revealed ? (c.password ?? '') : maskPassword(c.password ?? '')
        eye.textContent = revealed ? '🙈' : '👁'
      })

      meta.appendChild(pwSpan)
      meta.appendChild(eye)
    }
    row.appendChild(meta)

    const fillBtn = document.createElement('button')
    fillBtn.className = 'fillbtn'
    fillBtn.type = 'button'
    fillBtn.textContent = 'Fill'
    fillBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      list.remove()
      fillCredential(passwordEl, c)
    })
    row.appendChild(fillBtn)

    list.appendChild(row)
  }
  positionFixed(list, passwordEl)
  shadow.appendChild(list)
  // The picker lives in a CLOSED shadow root. Two checks for dismiss:
  // (1) composedPath().includes(list) — works in Chrome because Chrome
  // leaks the closed shadow internals through the path; (2) target
  // equals shadow host — the spec-compliant signal in Firefox/Safari
  // where composedPath truncates at the boundary. Without the host
  // check, picking on those browsers silently closes the picker before
  // the row's click handler had a chance to fill.
  const host = shadow.host
  const dismiss = (ev: Event) => {
    if (ev.target === host) return
    if (ev.composedPath().includes(list)) return
    list.remove()
    document.removeEventListener('click', dismiss, true)
  }
  setTimeout(() => document.addEventListener('click', dismiss, true), 0)
}

function setReactValue(el: HTMLInputElement, value: string) {
  // React's synthetic input listens via prototype setter. Setting
  // .value directly bypasses it and React-controlled inputs don't
  // see the change. Trick is to use the native setter then dispatch
  // an input event React picks up.
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (desc?.set) desc.set.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillCredential(passwordEl: HTMLInputElement, c: Credential) {
  const usernameEl = findUsernameForPassword(passwordEl)
  if (usernameEl && c.username) setReactValue(usernameEl, c.username)
  if (c.password) {
    // CRITICAL: mark "we filled this" BEFORE dispatching the input
    // event. setReactValue dispatches synchronously and our own
    // input listener checks lastFilledByUs immediately; if we set
    // it after, the listener sees nothing and records the autofilled
    // password as user-typed, which then triggers a phantom save
    // banner on the next page.
    lastFilledByUs.set(passwordEl, c.password)
    setReactValue(passwordEl, c.password)
  }
  passwordEl.focus()
  // Dismiss the green pill for this password field now that we've
  // filled it — leaving it there after a successful fill is just
  // noise. (It re-appears on next page load via the MutationObserver
  // if the field reappears, or via fresh refreshAndAttach on nav.)
  const widget = widgetByPasswordEl.get(passwordEl)
  if (widget) {
    widget.remove()
    widgetByPasswordEl.delete(passwordEl)
  }
  ask({
    type: 'logUsage',
    entryId: c.id,
    domain: getTopHostname(),
    action: 'fill',
  }).catch(() => { /* ignore */ })
}

function positionFixed(el: HTMLElement, anchor: HTMLInputElement) {
  const rect = anchor.getBoundingClientRect()
  // Place the widget to the RIGHT of the input, vertically aligned
  // with the field. Below-the-input lands in Chrome's passkey-prompt
  // zone on login pages, where the two UIs overlap. To-the-right
  // dodges that and matches how 1Password's overlay sits.
  // If there isn't room on the right, fall back to below.
  const widgetWidthEstimate = 185
  const widgetHeightEstimate = 26
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const wantsRightEdge = rect.right + widgetWidthEstimate + 8
  if (wantsRightEdge < viewportW) {
    el.style.left = `${rect.right + 6}px`
    el.style.top = `${Math.max(0, Math.min(viewportH - widgetHeightEstimate - 4, rect.top + Math.max(0, (rect.height - widgetHeightEstimate) / 2)))}px`
  } else {
    // Fall back: below the input, right-aligned and clipped.
    el.style.left = `${Math.max(0, rect.right - widgetWidthEstimate)}px`
    el.style.top = `${Math.min(viewportH - widgetHeightEstimate - 4, rect.bottom + 4)}px`
  }
}

function attachWidgets(credentials: Credential[]) {
  if (dismissedForPage) return
  if (isPunycode(getTopHostname())) {
    showPunycodeWarn()
    return
  }
  const shadow = getShadow()
  cachedCredentials = credentials

  // Fast path: per-entry "Auto-fill on load" flag. We only trip it when
  // there's exactly ONE matching credential for the domain — multi-match
  // ambiguity (Lance vs. Sydney's amazon.com) always defers to the
  // picker. Toast lets the user notice + undo if it filled the wrong
  // thing on a shared account.
  if (credentials.length === 1 && credentials[0].autofillOnLoad) {
    const only = credentials[0]
    const passwordEls = findPasswordInputs()
    let filledAny = false
    for (const passwordEl of passwordEls) {
      if (autofilledOnLoad.has(passwordEl)) continue
      fillCredential(passwordEl, only)
      autofilledOnLoad.add(passwordEl)
      filledAny = true
    }
    if (filledAny) showAutofilledToast(only)
    // Still watch the form for save/update flow on later re-types.
    for (const el of passwordEls) watchPasswordInput(el)
    return
  }

  for (const passwordEl of findPasswordInputs()) {
    if (!widgetByPasswordEl.has(passwordEl)) {
      const widget = makeWidget(passwordEl, credentials)
      positionFixed(widget, passwordEl)
      shadow.appendChild(widget)
      widgetByPasswordEl.set(passwordEl, widget)
    }
    watchPasswordInput(passwordEl)
  }
}

// Tracks password fields that already got a silent fill so the
// MutationObserver-driven re-attach doesn't keep slamming the same
// value into the field every DOM tick.
const autofilledOnLoad = new WeakSet<HTMLInputElement>()

function showAutofilledToast(c: Credential) {
  const shadow = getShadow()
  // Reuse any existing toast so consecutive fills don't stack.
  shadow.querySelector('.cv-toast')?.remove()
  const toast = document.createElement('div')
  toast.className = 'cv-toast'
  const text = document.createElement('span')
  text.textContent = `Filled ${c.title}${c.username ? ` (${c.username})` : ''} from vault`
  const undo = document.createElement('button')
  undo.textContent = 'Undo'
  undo.className = 'undo'
  undo.addEventListener('click', () => {
    // Clear whatever we just filled. Walk the same password elements
    // we filled and reset them; matching usernames cleared too.
    for (const passwordEl of findPasswordInputs()) {
      if (!autofilledOnLoad.has(passwordEl)) continue
      const usernameEl = findUsernameForPassword(passwordEl)
      if (usernameEl) setReactValue(usernameEl, '')
      lastFilledByUs.delete(passwordEl)
      setReactValue(passwordEl, '')
      autofilledOnLoad.delete(passwordEl)
    }
    toast.remove()
  })
  toast.appendChild(text)
  toast.appendChild(undo)
  shadow.appendChild(toast)
  // Auto-dismiss after 6s — long enough to notice + click, short enough
  // not to clutter the page.
  setTimeout(() => { toast.remove() }, 6000)
}

function watchAllPasswordInputsForSave() {
  for (const passwordEl of findPasswordInputs()) watchPasswordInput(passwordEl)
}

function watchPasswordInput(passwordEl: HTMLInputElement) {
  passwordEl.addEventListener('input', () => {
    const v = passwordEl.value
    if (!v) return
    if (lastFilledByUs.get(passwordEl) === v) return
    lastTypedByPasswordEl.set(passwordEl, v)
  })
  // Hint a "generate strong password" affordance when the user
  // focuses an empty password — but only on signup/reset forms.
  // A signup typically has 2+ password inputs (password + confirm),
  // and even single-password forms qualify if the vault has no
  // saved creds for this site (= probably a new signup). On a
  // login page where existing creds exist, we want the user filling
  // their saved password, not generating a new one.
  passwordEl.addEventListener('focus', () => {
    if (passwordEl.value.length > 0) return
    if (dismissedForPage) return
    if (isPunycode(getTopHostname())) return
    if (!shouldOfferGenerator(passwordEl)) return
    showGeneratorButton(passwordEl)
  })
  const form = passwordEl.form
  if (form && !watchingForms.has(form)) {
    watchingForms.add(form)
    form.addEventListener('submit', () => maybeOfferSave(passwordEl), { capture: true })
  }
}

function shouldOfferGenerator(passwordEl: HTMLInputElement): boolean {
  // No saved creds for this site → could be a new signup, generator
  // is welcome.
  if (!cachedCredentials || cachedCredentials.length === 0) return true
  // Existing creds exist. Only show generator if this is a multi-
  // password form (signup or password-reset), since single-password
  // forms with saved creds are virtually always plain login.
  const form = passwordEl.form
  if (!form) return false
  const visiblePasswords = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    .filter(isVisible).filter((el) => !el.disabled && !el.readOnly)
  return visiblePasswords.length >= 2
}

// ─── Password generator ─────────────────────────────────────────────────────

function generatePassword(length = 20): string {
  // Cryptographically random, ASCII-printable, with at least one of
  // each character class (lowers, uppers, digits, symbols). Symbol
  // set excludes characters that confuse copy-paste between zones.
  const lowers = 'abcdefghijklmnopqrstuvwxyz'
  const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const symbols = '!@#$%^&*-_=+?'
  const all = lowers + uppers + digits + symbols
  const required = [lowers, uppers, digits, symbols]
  const buf = new Uint32Array(length)
  crypto.getRandomValues(buf)
  const out: string[] = []
  for (let i = 0; i < length; i++) {
    const pool = i < required.length ? required[i] : all
    out.push(pool[buf[i] % pool.length])
  }
  // Shuffle so the required-class chars aren't always at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = (crypto.getRandomValues(new Uint32Array(1))[0]) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

let activeGenButton: HTMLElement | null = null

function showGeneratorButton(passwordEl: HTMLInputElement) {
  // Single button at a time, to avoid stacking on multi-password forms.
  activeGenButton?.remove()
  const shadow = getShadow()
  const btn = document.createElement('div')
  btn.className = 'cv-pill'
  btn.style.cursor = 'pointer'
  btn.textContent = '🎲 Generate strong password'
  btn.addEventListener('mousedown', (e) => {
    // mousedown so the password field doesn't blur before our handler.
    e.preventDefault()
    e.stopPropagation()
    btn.remove()
    activeGenButton = null
    showGeneratorPanel(passwordEl)
  })
  positionFixed(btn, passwordEl)
  shadow.appendChild(btn)
  activeGenButton = btn

  // Hide on blur (with a small delay so the click can register).
  const onBlur = () => setTimeout(() => {
    if (passwordEl.value.length > 0) btn.remove()
  }, 200)
  passwordEl.addEventListener('blur', onBlur, { once: true })
}

function showGeneratorPanel(passwordEl: HTMLInputElement) {
  const shadow = getShadow()
  const panel = document.createElement('div')
  panel.className = 'cv-pwgen'

  const display = document.createElement('div')
  display.className = 'pw'
  let pw = generatePassword(20)
  display.textContent = pw

  const actions = document.createElement('div')
  actions.className = 'actions'

  // Status / next-step row below the action buttons. Hidden until we
  // have something to say (e.g. "Saved! Open in vault to add details.")
  const note = document.createElement('div')
  note.className = 'note'
  note.style.display = 'none'

  // All action buttons use mousedown (with preventDefault) so the
  // password field doesn't blur before our handler fires — same pattern
  // as the generator pill above. preventDefault on mousedown also
  // suppresses the synthetic click, which is what we want here since
  // we're handling activation in mousedown directly.
  function bindMousedownAction(btn: HTMLButtonElement, fn: () => void | Promise<void>) {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      void fn()
    })
  }

  function fillInForm(value: string) {
    setReactValue(passwordEl, value)
    // Also fill any "confirm password" / second password input on the
    // same form so signup confirms match without manual re-typing.
    const form = passwordEl.form
    if (form) {
      for (const other of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
        if (other !== passwordEl && isVisible(other) && !other.disabled && !other.readOnly) {
          setReactValue(other, value)
        }
      }
    }
    // Remember we filled it so the input-listener on the field doesn't
    // mis-classify our value as user-typed and trigger a phantom save
    // banner on the next submit.
    lastFilledByUs.set(passwordEl, value)
  }

  const regen = document.createElement('button')
  regen.textContent = '↻ New'
  bindMousedownAction(regen, () => {
    pw = generatePassword(20)
    display.textContent = pw
  })

  const copy = document.createElement('button')
  copy.textContent = 'Copy'
  bindMousedownAction(copy, async () => {
    try {
      await navigator.clipboard.writeText(pw)
      copy.textContent = 'Copied!'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
    } catch {
      copy.textContent = 'Blocked'
      setTimeout(() => (copy.textContent = 'Copy'), 1600)
    }
  })

  const use = document.createElement('button')
  use.className = 'use'
  use.textContent = 'Use'
  bindMousedownAction(use, () => {
    fillInForm(pw)
    panel.remove()
  })

  // New Save button — fills the form AND saves the credential to the
  // vault straight away, so the user doesn't have to wait for form
  // submit (which often redirects to a different domain on signup and
  // either drops the prompt or saves it against the wrong host —
  // exactly what Lance hit on trilio.com).
  const save = document.createElement('button')
  save.className = 'save'
  save.textContent = 'Save'
  bindMousedownAction(save, async () => {
    save.disabled = true
    save.textContent = 'Saving…'
    fillInForm(pw)
    const usernameEl = findUsernameForPassword(passwordEl)
    const draft: SaveDraft = {
      username: usernameEl?.value?.trim() || null,
      password: pw,
      url: getTopUrl(),
      title: getTopTitle(),
    }
    const res = await ask({ type: 'saveCredential', draft })
    if ('ok' in res) {
      // Hide the action row; replace with a single "Open in vault" link
      // (when the SW handed back an entryUrl) plus a Done button to
      // close the panel.
      actions.innerHTML = ''
      note.style.display = 'block'
      if ('entryUrl' in res && res.entryUrl) {
        note.innerHTML = ''
        const saved = document.createElement('span')
        saved.textContent = '✓ Saved to vault. '
        const open = document.createElement('a')
        open.textContent = 'Open to add details →'
        open.href = res.entryUrl
        open.target = '_blank'
        open.rel = 'noopener noreferrer'
        note.appendChild(saved)
        note.appendChild(open)
      } else {
        note.textContent = '✓ Saved to vault.'
      }
      const done = document.createElement('button')
      done.textContent = 'Done'
      bindMousedownAction(done, () => panel.remove())
      actions.appendChild(done)
    } else {
      save.disabled = false
      save.textContent = 'Save'
      note.style.display = 'block'
      const err = 'error' in res ? res.error : 'Unknown error'
      note.textContent = `Save failed: ${err}`
    }
  })

  actions.appendChild(regen)
  actions.appendChild(copy)
  actions.appendChild(use)
  actions.appendChild(save)
  panel.appendChild(display)
  panel.appendChild(actions)
  panel.appendChild(note)
  positionFixed(panel, passwordEl)
  shadow.appendChild(panel)

  // Click-outside to dismiss. Two checks belt-and-suspenders: (1) the
  // standard composedPath().includes(panel) — which works in Chrome
  // because Chrome leaks the closed shadow internals through the path,
  // but is filtered out by spec-compliant browsers (Firefox, Safari);
  // and (2) target equals the shadow host — which is the spec-compliant
  // way to detect "click was inside our closed shadow" since the event
  // target re-targets to the host once it crosses the boundary.
  const host = shadow.host
  setTimeout(() => {
    const dismiss = (ev: Event) => {
      if (ev.target === host) return
      if (ev.composedPath().includes(panel)) return
      panel.remove()
      document.removeEventListener('click', dismiss, true)
    }
    document.addEventListener('click', dismiss, true)
  }, 0)
}

async function refreshAndAttach() {
  if (dismissedForPage) return
  const domain = getTopHostname()
  if (isPunycode(domain)) {
    // Don't even fetch — refuse on principle so we don't expose
    // credentials to a homograph site.
    showPunycodeWarn()
    cachedCredentials = []
    return
  }
  const res = await ask({ type: 'getCredentials', domain })
  const creds = ('credentials' in res && Array.isArray(res.credentials)) ? res.credentials : []
  if (creds.length > 0) {
    attachWidgets(creds)
  } else {
    cachedCredentials = []
    watchAllPasswordInputsForSave()
  }
  if ('error' in res && res.error) {
    console.warn('[cobbvault] getCredentials failed:', res.error)
  }
}

// ─── Save flow ──────────────────────────────────────────────────────────────

function maybeOfferSave(passwordEl: HTMLInputElement) {
  const password = lastTypedByPasswordEl.get(passwordEl) ?? passwordEl.value
  if (!password || password.length < 4) return
  // Identical to a saved password → nothing to do.
  if (cachedCredentials?.some((c) => c.password === password)) return
  const usernameEl = findUsernameForPassword(passwordEl)
  const username = usernameEl?.value?.trim() ?? null

  // Don't propose anything on a cross-origin POST form — same signal
  // that prevented us from filling makes any capture suspect.
  if (!isFormSafe(passwordEl)) return
  if (isPunycode(getTopHostname())) return

  // Update path: existing credential(s) match the typed username, but
  // the password differs. Previously this was a silent drop — now we
  // offer to update the matching entry. A picker handles the rare
  // multi-match case (two entries on the same domain sharing a
  // username).
  if (username && cachedCredentials) {
    const matches = cachedCredentials.filter(
      (c) => c.username === username && c.password !== password,
    )
    if (matches.length > 0) {
      const draft: UpdateDraft = {
        password,
        url: getTopUrl(),
        domain: getTopHostname(),
        candidates: matches.map((c) => ({
          id: c.id,
          title: c.title,
          username: c.username,
          passwordHint: maskPasswordHint(c.password ?? ''),
        })),
      }
      ask({ type: 'proposeUpdate', draft }).catch(() => { /* ignore */ })
      if (!updateBannerOpen) showUpdateBanner(draft)
      return
    }
  }

  const draft: SaveDraft = {
    username,
    password,
    url: getTopUrl(),
    title: getTopTitle(),
  }
  ask({ type: 'proposeSave', draft, domain: getTopHostname() }).catch(() => { /* ignore */ })
  if (!saveBannerOpen) showSaveBanner(draft)
}

// Hint shown next to each candidate in the update picker so the user can
// tell two same-username entries apart by old password. Mirrors the mask
// used by the autofill picker (first two + last two chars).
function maskPasswordHint(pw: string): string {
  if (!pw) return ''
  if (pw.length <= 4) return '•'.repeat(pw.length)
  return pw.slice(0, 2) + '••' + pw.slice(-2)
}

function showSaveBanner(draft: SaveDraft) {
  saveBannerOpen = true
  const shadow = getShadow()
  const banner = document.createElement('div')
  banner.className = 'cv-banner'

  const heading = document.createElement('div')
  heading.className = 'heading'
  heading.textContent = '🔑 Save to Family Vault?'

  const detail = document.createElement('div')
  detail.className = 'detail'
  detail.textContent = `${draft.title}${draft.username ? ` · ${draft.username}` : ''}`

  const buttons = document.createElement('div')
  buttons.className = 'buttons'

  const dismissBtn = document.createElement('button')
  dismissBtn.className = 'btn-dismiss'
  dismissBtn.textContent = 'Not now'
  dismissBtn.addEventListener('click', async () => {
    await ask({ type: 'dismissPendingSave', domain: getTopHostname() })
    closeBanner()
  })

  const saveBtn = document.createElement('button')
  saveBtn.className = 'btn-save'
  saveBtn.textContent = 'Save'
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving…'
    const res = await ask({ type: 'confirmSave', domain: getTopHostname() })
    if ('ok' in res) {
      heading.textContent = '✓ Saved to vault'
      detail.textContent = 'Add a category, attach a file, or rename it from the vault.'
      // Replace Save/Dismiss with an "Open in vault" link when the SW
      // handed back the entry URL. Otherwise just auto-close after a
      // beat. Previously this just announced "you can re-categorize it"
      // without giving the user any way to actually do that, so saved
      // entries felt like they vanished into thin air.
      buttons.innerHTML = ''
      if ('entryUrl' in res && res.entryUrl) {
        const open = document.createElement('button')
        open.className = 'btn-save'
        open.textContent = 'Open in vault →'
        const entryUrl = res.entryUrl
        open.addEventListener('click', () => {
          window.open(entryUrl, '_blank', 'noopener,noreferrer')
          closeBanner()
        })
        const closeBtn = document.createElement('button')
        closeBtn.className = 'btn-dismiss'
        closeBtn.textContent = 'Close'
        closeBtn.addEventListener('click', closeBanner)
        buttons.appendChild(closeBtn)
        buttons.appendChild(open)
      } else {
        setTimeout(closeBanner, 2200)
      }
    } else {
      saveBtn.disabled = false
      saveBtn.textContent = 'Save'
      const err = 'error' in res ? res.error : 'Unknown error'
      detail.textContent = `Failed: ${err}`
    }
  })

  buttons.appendChild(dismissBtn)
  buttons.appendChild(saveBtn)
  banner.appendChild(heading)
  banner.appendChild(detail)
  banner.appendChild(buttons)
  shadow.appendChild(banner)

  function closeBanner() {
    banner.remove()
    saveBannerOpen = false
  }
}

async function checkPendingSave() {
  const res = await ask({ type: 'getPendingSave', domain: getTopHostname() })
  if ('draft' in res && res.draft && !saveBannerOpen) {
    showSaveBanner(res.draft as SaveDraft)
  }
}

async function checkPendingUpdate() {
  const res = await ask({ type: 'getPendingUpdate', domain: getTopHostname() })
  if ('draft' in res && res.draft && !updateBannerOpen) {
    showUpdateBanner(res.draft as UpdateDraft)
  }
}

function showUpdateBanner(draft: UpdateDraft) {
  updateBannerOpen = true
  const shadow = getShadow()
  const banner = document.createElement('div')
  banner.className = 'cv-banner'

  const heading = document.createElement('div')
  heading.className = 'heading'
  heading.textContent =
    draft.candidates.length === 1
      ? '🔑 Update saved password?'
      : `🔑 Update which password? (${draft.candidates.length} matches)`

  const detail = document.createElement('div')
  detail.className = 'detail'
  if (draft.candidates.length === 1) {
    const c = draft.candidates[0]
    detail.textContent = `${c.title}${c.username ? ` · ${c.username}` : ''} · was ${c.passwordHint}`
  } else {
    detail.textContent = 'Same username matches multiple saved entries. Pick which one to overwrite.'
  }

  const buttons = document.createElement('div')
  buttons.className = 'buttons'

  const dismissBtn = document.createElement('button')
  dismissBtn.className = 'btn-dismiss'
  dismissBtn.textContent = 'Not now'
  dismissBtn.addEventListener('click', async () => {
    await ask({ type: 'dismissPendingUpdate', domain: getTopHostname() })
    closeBanner()
  })

  function performUpdate(credentialId: string, btn: HTMLButtonElement) {
    btn.disabled = true
    btn.textContent = 'Saving…'
    ask({ type: 'confirmUpdate', domain: getTopHostname(), credentialId })
      .then((res) => {
        if ('ok' in res) {
          heading.textContent = '✓ Password updated'
          detail.textContent = 'Your vault entry has the new password.'
          buttons.remove()
          setTimeout(closeBanner, 2200)
        } else {
          btn.disabled = false
          btn.textContent = 'Update'
          const err = 'error' in res ? res.error : 'Unknown error'
          detail.textContent = `Failed: ${err}`
        }
      })
      .catch(() => {
        btn.disabled = false
        btn.textContent = 'Update'
        detail.textContent = 'Failed: messaging error'
      })
  }

  if (draft.candidates.length === 1) {
    const updateBtn = document.createElement('button')
    updateBtn.className = 'btn-save'
    updateBtn.textContent = 'Update'
    updateBtn.addEventListener('click', () => performUpdate(draft.candidates[0].id, updateBtn))
    buttons.appendChild(dismissBtn)
    buttons.appendChild(updateBtn)
  } else {
    // Multi-candidate picker — one button per candidate. Click a row to
    // commit that update; "Not now" still bails.
    const list = document.createElement('div')
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px;'
    for (const c of draft.candidates) {
      const row = document.createElement('button')
      row.className = 'btn-save'
      row.style.cssText = 'text-align:left;padding:6px 10px;width:100%;'
      row.textContent = `Update “${c.title}”${c.username ? ` · ${c.username}` : ''} (was ${c.passwordHint})`
      row.addEventListener('click', () => performUpdate(c.id, row))
      list.appendChild(row)
    }
    buttons.appendChild(dismissBtn)
    banner.appendChild(heading)
    banner.appendChild(detail)
    banner.appendChild(list)
    banner.appendChild(buttons)
    shadow.appendChild(banner)
    return
  }

  banner.appendChild(heading)
  banner.appendChild(detail)
  banner.appendChild(buttons)
  shadow.appendChild(banner)

  function closeBanner() {
    banner.remove()
    updateBannerOpen = false
  }
}

// ─── Bootstrap + reactivity ─────────────────────────────────────────────────

let scheduled = false
const observer = new MutationObserver(() => {
  if (dismissedForPage || scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    if (cachedCredentials && cachedCredentials.length > 0) {
      attachWidgets(cachedCredentials)
    } else {
      watchAllPasswordInputsForSave()
    }
  }, 250)
})

function repositionAll() {
  for (const [passwordEl, widget] of widgetByPasswordEl) {
    positionFixed(widget, passwordEl)
  }
}

if (!skipped) {
  // Sequence: tab context → credentials + pending save/update → observe.
  ;(async () => {
    await loadTabContext()
    await refreshAndAttach()
    await checkPendingSave()
    await checkPendingUpdate()
    observer.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener('resize', repositionAll)
    window.addEventListener('scroll', repositionAll, true)
  })()
}

// Suppress unused-variable lint on the type re-export.
type _Used = CredentialsResponse
