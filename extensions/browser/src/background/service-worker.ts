// Manifest V3 service worker. The brains of the extension:
//
//   • Routes messages from the content script (getCredentials)
//     and the popup (getStatus / unpair)
//   • Owns the credential cache (5-minute TTL, per registrable
//     domain, lives in chrome.storage.session so it disappears on
//     browser shutdown)
//   • Hits the vault's /api/clients/* endpoints
//
// No DOM access here — service workers run sandboxed. UI-side concerns
// (form fill, popup rendering) live in the content/ and popup/ entries.

import {
  ApiError,
  getCredentials,
  getMe,
  logUsage,
  saveCredential,
  searchCredentials,
  updateCredentialPassword,
  type Credential,
} from '../lib/api'
import { clearPairing, getSession, getToken, getVaultBaseUrl, setSession } from '../lib/storage'
import { PENDING_SAVE_TTL_MS, STORAGE_KEYS } from '../lib/config'
import type { Message, Response, SaveDraft, UpdateDraft } from '../lib/messages'

// Build the canonical /entries/<id>/edit URL on the paired vault so
// "Open in vault" buttons on the save banner / generator land the user
// straight on the editor for the freshly-saved credential. Strips any
// trailing slash so we don't end up with /entries//<id>.
async function buildEntryEditUrl(entryId: string): Promise<string> {
  const base = (await getVaultBaseUrl()).replace(/\/+$/, '')
  return `${base}/entries/${encodeURIComponent(entryId)}/edit`
}

const CACHE_TTL_MS = 5 * 60 * 1000

interface PendingSave {
  draft: SaveDraft
  domain: string
  expiresAt: number
}

async function getPendingSaves(): Promise<PendingSave[]> {
  const list = await getSession<PendingSave[]>(STORAGE_KEYS.pendingSaves)
  if (!Array.isArray(list)) return []
  const now = Date.now()
  // Drop expired ones lazily on every read.
  return list.filter((p) => p.expiresAt > now)
}

async function setPendingSaves(list: PendingSave[]): Promise<void> {
  await setSession(STORAGE_KEYS.pendingSaves, list)
  // Badge shows total pending across saves + updates so the user sees
  // one count whether the prompt is "Save" or "Update".
  const updates = await getSession<unknown[]>(STORAGE_KEYS.pendingUpdates)
  const updateCount = Array.isArray(updates) ? updates.length : 0
  await refreshBadge(list.length + updateCount)
}

async function upsertPendingSave(p: PendingSave): Promise<void> {
  const all = await getPendingSaves()
  // Replace any existing pending for the same domain+username, else
  // append. Keeps the list tight in the typical "user re-typed" case.
  const idx = all.findIndex(
    (e) => e.domain === p.domain && (e.draft.username ?? '') === (p.draft.username ?? ''),
  )
  if (idx >= 0) all[idx] = p
  else all.push(p)
  await setPendingSaves(all)
}

// ─── Pending updates — same shape + lifecycle as pending saves ────────────
interface PendingUpdate {
  draft: UpdateDraft
  domain: string
  expiresAt: number
}

async function getPendingUpdates(): Promise<PendingUpdate[]> {
  const list = await getSession<PendingUpdate[]>(STORAGE_KEYS.pendingUpdates)
  if (!Array.isArray(list)) return []
  const now = Date.now()
  return list.filter((p) => p.expiresAt > now)
}

async function setPendingUpdates(list: PendingUpdate[]): Promise<void> {
  await setSession(STORAGE_KEYS.pendingUpdates, list)
  await refreshBadge(list.length + (await getPendingSaves()).length)
}

async function upsertPendingUpdate(p: PendingUpdate): Promise<void> {
  const all = await getPendingUpdates()
  // One pending update per domain max — the user typed a password,
  // re-typed it, we keep only the latest attempt.
  const idx = all.findIndex((e) => e.domain === p.domain)
  if (idx >= 0) all[idx] = p
  else all.push(p)
  await setPendingUpdates(all)
}

async function removePendingUpdatesForDomain(domain: string): Promise<void> {
  const all = await getPendingUpdates()
  await setPendingUpdates(all.filter((p) => p.domain !== domain))
}

async function removePendingSavesForDomain(domain: string): Promise<void> {
  const all = await getPendingSaves()
  await setPendingSaves(all.filter((p) => p.domain !== domain))
}

async function refreshBadge(count: number): Promise<void> {
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) })
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' })
  } else {
    await chrome.action.setBadgeText({ text: '' })
  }
}

interface CachedCreds {
  credentials: Credential[]
  fetchedAt: number
}

async function getCachedCredentials(domain: string): Promise<Credential[] | null> {
  const key = STORAGE_KEYS.credCachePrefix + domain
  const cached = await getSession<CachedCreds>(key)
  if (!cached) return null
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null
  return cached.credentials
}

async function setCachedCredentials(domain: string, credentials: Credential[]): Promise<void> {
  const key = STORAGE_KEYS.credCachePrefix + domain
  await setSession(key, { credentials, fetchedAt: Date.now() } satisfies CachedCreds)
}

async function fetchCredentials(domain: string): Promise<Credential[]> {
  const token = await getToken()
  if (!token) return []
  const cached = await getCachedCredentials(domain)
  if (cached) return cached
  try {
    const fresh = await getCredentials(domain)
    await setCachedCredentials(domain, fresh)
    return fresh
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Token revoked or invalid — clear local pairing so the popup
      // prompts the user to re-pair.
      await clearPairing()
    }
    throw err
  }
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse: (r: Response) => void) => {
  // sendResponse must be invoked async — return true to keep the
  // channel open while we await stuff.
  ;(async () => {
    try {
      if (msg.type === 'getTabContext') {
        // sender.tab is set when the content script messaged us. Its
        // .url and .title reflect the TAB's top-level page even if the
        // content script is running in a nested iframe. That's exactly
        // what we want for credential-match trust decisions.
        const url = sender.tab?.url ?? ''
        const title = sender.tab?.title ?? ''
        let hostname = ''
        try { hostname = new URL(url).hostname } catch { /* ignore */ }
        sendResponse({ topUrl: url, topTitle: title, topHostname: hostname })
        return
      }
      if (msg.type === 'lock') {
        // Hard lock — wipe everything. User has to re-pair to come back.
        await clearPairing()
        await chrome.storage.session.clear()
        await refreshBadge(0)
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'getCredentials') {
        // Prefer the tab's top-frame URL/hostname over whatever the
        // sender claimed. Falls back to msg.domain when the sender is
        // the popup (no tab context).
        const topUrl = sender.tab?.url
        let domain = msg.domain
        if (topUrl) {
          try { domain = new URL(topUrl).hostname } catch { /* keep msg.domain */ }
        }
        const credentials = await fetchCredentials(domain)
        sendResponse({ credentials })
        return
      }
      if (msg.type === 'searchCredentials') {
        const q = msg.q.trim()
        if (!q) {
          sendResponse({ credentials: [] })
          return
        }
        try {
          const credentials = await searchCredentials(q)
          sendResponse({ credentials })
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) await clearPairing()
          sendResponse({ credentials: [], error: err instanceof Error ? err.message : 'search failed' })
        }
        return
      }
      if (msg.type === 'logUsage') {
        await logUsage({ entryId: msg.entryId, domain: msg.domain, action: msg.action })
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'saveCredential') {
        const { draft } = msg
        const created = await saveCredential({
          title: draft.title,
          username: draft.username,
          password: draft.password,
          url: draft.url,
        })
        // Bust cache so the next page-load fetch sees the new entry.
        try {
          const domain = new URL(draft.url).hostname
          await chrome.storage.session.remove(STORAGE_KEYS.credCachePrefix + domain)
        } catch { /* invalid URL, skip cache bust */ }
        const entryUrl = await buildEntryEditUrl(created.id)
        sendResponse({ ok: true, entryId: created.id, entryUrl })
        return
      }
      if (msg.type === 'proposeSave') {
        // Stash the draft. The content script that sent us this is
        // about to be destroyed by form-submit navigation; we'll
        // surface the prompt again on the next page load.
        await upsertPendingSave({
          draft: msg.draft,
          domain: msg.domain,
          expiresAt: Date.now() + PENDING_SAVE_TTL_MS,
        })
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'getPendingSave') {
        const all = await getPendingSaves()
        // Any unexpired pending save for this domain is fair game.
        // If multiple, return the most recent (largest expiresAt).
        const matching = all
          .filter((p) => p.domain === msg.domain)
          .sort((a, b) => b.expiresAt - a.expiresAt)
        sendResponse({ draft: matching[0]?.draft ?? null })
        // Re-persist the pruned list (in case some expired during read).
        await setPendingSaves(all)
        return
      }
      if (msg.type === 'confirmSave') {
        const all = await getPendingSaves()
        const match = all.find((p) => p.domain === msg.domain)
        if (!match) {
          sendResponse({ error: 'No pending save for this domain.' })
          return
        }
        const created = await saveCredential({
          title: match.draft.title,
          username: match.draft.username,
          password: match.draft.password,
          url: match.draft.url,
        })
        await removePendingSavesForDomain(msg.domain)
        try {
          await chrome.storage.session.remove(STORAGE_KEYS.credCachePrefix + msg.domain)
        } catch { /* ignore */ }
        const entryUrl = await buildEntryEditUrl(created.id)
        sendResponse({ ok: true, entryId: created.id, entryUrl })
        return
      }
      if (msg.type === 'dismissPendingSave') {
        await removePendingSavesForDomain(msg.domain)
        sendResponse({ ok: true })
        return
      }
      // ─── Update flow ────────────────────────────────────────────────
      if (msg.type === 'proposeUpdate') {
        // Stash the pending update — same lifecycle as proposeSave so
        // the prompt survives form-submit navigation.
        await upsertPendingUpdate({
          draft: msg.draft,
          domain: msg.draft.domain,
          expiresAt: Date.now() + PENDING_SAVE_TTL_MS,
        })
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'getPendingUpdate') {
        const all = await getPendingUpdates()
        const matching = all
          .filter((p) => p.domain === msg.domain)
          .sort((a, b) => b.expiresAt - a.expiresAt)
        sendResponse({ draft: matching[0]?.draft ?? null })
        // Re-persist the pruned list so expired entries don't accrue.
        await setPendingUpdates(all)
        return
      }
      if (msg.type === 'confirmUpdate') {
        const all = await getPendingUpdates()
        const match = all.find((p) => p.domain === msg.domain)
        if (!match) {
          sendResponse({ error: 'No pending update for this domain.' })
          return
        }
        // Verify the chosen id is one of the candidates we proposed.
        // Otherwise the page could trick the SW into PATCHing an arbitrary
        // credential.
        const chosen = match.draft.candidates.find((c) => c.id === msg.credentialId)
        if (!chosen) {
          sendResponse({ error: 'Credential not among proposed candidates.' })
          return
        }
        try {
          await updateCredentialPassword(chosen.id, match.draft.password)
        } catch (err) {
          sendResponse({
            error: err instanceof Error ? err.message : 'Update failed.',
          })
          return
        }
        await removePendingUpdatesForDomain(msg.domain)
        // Cache bust so the next fetch sees the updated password.
        try {
          await chrome.storage.session.remove(STORAGE_KEYS.credCachePrefix + msg.domain)
        } catch { /* ignore */ }
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'dismissPendingUpdate') {
        await removePendingUpdatesForDomain(msg.domain)
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'getStatus') {
        const token = await getToken()
        if (!token) {
          sendResponse({ paired: false, userName: null })
          return
        }
        try {
          const me = await getMe()
          sendResponse({ paired: true, userName: me.userName })
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            await clearPairing()
          }
          sendResponse({ paired: false, userName: null })
        }
        return
      }
      if (msg.type === 'unpair') {
        await clearPairing()
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'openVaultPath') {
        // Quick-create shortcut from the popup's empty-search state.
        // Build base + sanitized path; refuse anything that tries to
        // jump to a different origin or use a non-http(s) scheme.
        const base = (await getVaultBaseUrl()).replace(/\/+$/, '')
        const path = typeof msg.path === 'string' && msg.path.startsWith('/') ? msg.path : '/'
        await chrome.tabs.create({ url: `${base}${path}` })
        sendResponse({ ok: true })
        return
      }
      sendResponse({ error: 'Unknown message type.' })
    } catch (err) {
      sendResponse({ error: err instanceof Error ? err.message : 'Service worker error.' })
    }
  })()
  return true
})

// First-install / browser-startup: nothing to bootstrap. The popup or
// content script triggers everything on demand.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[bestfamilyvault] extension installed')
})
