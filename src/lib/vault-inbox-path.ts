import 'server-only'
import fs from 'node:fs'

// Single source of truth for the local Vault File Drop folder. Imported by
// the sync server action AND by the import page (server component) so the UI
// can grey out the "Sync now" button when we're not on the machine that
// actually has the folder.
//
// server-only: this touches node:fs and must never end up in a client bundle.
export const VAULT_INBOX_PATH = String.raw`C:\Users\lance\Documents\Vault File Drop`

/**
 * True only on the local Windows machine that has the drop folder. The
 * deployed (Linux/Vercel) server can't reach it, so syncing there is
 * impossible and the button is disabled.
 */
export function isVaultInboxAvailable(): boolean {
  return process.platform === 'win32' && fs.existsSync(VAULT_INBOX_PATH)
}
