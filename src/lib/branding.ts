// Single source of truth for the user-visible app name. Driven by env so the
// same codebase can ship under different branding (real vault vs. public demo).
// Defaults preserve current behavior on existing deployments that haven't set
// the env vars.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Best Family Vault'
export const APP_SHORT_NAME = process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? 'Family Vault'
export const APP_TAGLINE = process.env.NEXT_PUBLIC_APP_TAGLINE ?? 'Family secrets, safely kept.'
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0'

export function getDisplayVersion() {
  return APP_VERSION
}
