// Where the vault lives. Override via the options page if running
// against localhost in development. Stored in chrome.storage.local
// under VAULT_BASE_URL so it survives extension reloads.

export const DEFAULT_VAULT_BASE_URL = 'https://cobbvault.vercel.app'

export const STORAGE_KEYS = {
  vaultBaseUrl: 'VAULT_BASE_URL',
  bearerToken: 'BEARER_TOKEN',
  sessionId: 'SESSION_ID',
  userName: 'USER_NAME',
  // Domain → cached credentials list. Cleared on browser restart
  // (we put this in storage.session, not storage.sync).
  credCachePrefix: 'CRED_CACHE:',
  // Array of PendingSave objects awaiting user confirmation. Lives in
  // storage.session so it doesn't leak across browser restarts but
  // survives page navigation (the form-submit nav that kills the
  // inline banner). 5-minute expiry per entry.
  pendingSaves: 'PENDING_SAVES',
  // Same shape + TTL as pendingSaves, but for "user typed a new
  // password for a credential we already have under this domain +
  // username" — surfaces an Update banner instead of silently dropping
  // the keystroke.
  pendingUpdates: 'PENDING_UPDATES',
  // Boolean — when true, the in-page picker shows a password preview
  // (mask by default, eye-toggle to reveal) so the user can verify
  // they're about to fill the right credential before another wrong
  // attempt locks them out. Default false (off, more private).
  revealInPicker: 'REVEAL_IN_PICKER',
} as const

export const PENDING_SAVE_TTL_MS = 5 * 60 * 1000
