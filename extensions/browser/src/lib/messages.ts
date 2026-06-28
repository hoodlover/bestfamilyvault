// Typed message bus between the content script, the popup, and the
// background service worker. Chrome's runtime.sendMessage is
// untyped; this gives us one place to nail down the shape so a
// content script asking for credentials can't disagree with what
// the worker returns.

import type { Credential } from './api'

export type { Credential }

export interface SaveDraft {
  username: string | null
  password: string
  url: string
  title: string
}

// Captured when the user types a password that DOESN'T match the saved
// one for an existing credential on this domain+username. Candidates
// are the matching entries (more than one is rare — same username on
// two BofA accounts, say — but we hand both back and let the banner
// show a picker).
export interface UpdateDraft {
  password: string
  url: string
  domain: string
  candidates: { id: string; title: string; username: string | null; passwordHint: string }[]
}

export type Message =
  | { type: 'getCredentials'; domain: string }
  | { type: 'logUsage'; entryId: string; domain: string; action: 'fill' | 'view' }
  | { type: 'getStatus' }
  | { type: 'unpair' }
  // Inline / direct save (used by the popup if we ever surface a save
  // there). Performs the API call and returns. Content script no
  // longer uses this directly — it goes through proposeSave so the
  // request survives page navigation.
  | { type: 'saveCredential'; draft: SaveDraft }
  // Content script: "the user just submitted a form with a new
  // password. Stash it; I'm probably about to be destroyed by
  // navigation." SW persists in storage.session, sets badge.
  | { type: 'proposeSave'; draft: SaveDraft; domain: string }
  // Content script asks on every page load: "any pending saves for
  // this domain?" SW returns the most recent unexpired one.
  | { type: 'getPendingSave'; domain: string }
  // Content script confirms / dismisses the prompt.
  | { type: 'confirmSave'; domain: string }
  | { type: 'dismissPendingSave'; domain: string }
  // Content script asks the SW for its tab's TOP URL/title/hostname.
  // Critical when the script is running inside a cross-origin iframe —
  // the page's own location is the iframe's, but the trust boundary
  // for credential matching is the top frame's origin. SW pulls these
  // from the message sender's tab record.
  | { type: 'getTabContext' }
  // Manual lock from popup — clears bearer + cached credentials. User
  // re-pairs to unlock.
  | { type: 'lock' }
  // Free-text search across the user's logins (popup search box).
  | { type: 'searchCredentials'; q: string }
  // Update flow — mirror of save, used when the user typed a NEW
  // password for an EXISTING credential (domain+username match,
  // password differs). proposeUpdate stashes the draft so it survives
  // navigation, confirmUpdate picks one candidate and PATCHes its
  // password.
  | { type: 'proposeUpdate'; draft: UpdateDraft }
  | { type: 'getPendingUpdate'; domain: string }
  | { type: 'confirmUpdate'; domain: string; credentialId: string }
  | { type: 'dismissPendingUpdate'; domain: string }
  // Popup quick-create shortcuts. SW builds vault-base + path and opens
  // it in a new tab. Path is a relative URL like "/entries/new?type=login"
  // so the popup doesn't need to know the user's paired vault host.
  | { type: 'openVaultPath'; path: string }

export interface CredentialsResponse {
  credentials: Credential[]
  error?: string
}

export interface StatusResponse {
  paired: boolean
  userName: string | null
}

export interface PendingSaveResponse {
  draft: SaveDraft | null
}

export interface PendingUpdateResponse {
  draft: UpdateDraft | null
}

export interface TabContextResponse {
  topUrl: string
  topTitle: string
  topHostname: string
}

// Successful save responses optionally carry the created entry's id and
// canonical URL on the vault, so the content script can offer an
// "Open in vault" link without having to know the vault's base URL.
export interface OkResponse {
  ok: true
  entryId?: string
  entryUrl?: string
}

export type Response =
  | CredentialsResponse
  | StatusResponse
  | PendingSaveResponse
  | PendingUpdateResponse
  | TabContextResponse
  | OkResponse
  | { error: string }
