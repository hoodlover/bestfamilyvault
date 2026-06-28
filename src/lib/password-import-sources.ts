export interface PasswordImportSource {
  name: string
  status: 'supported' | 'limited' | 'manual' | 'avoid'
  bestPath: string
  notes: string
  sourceUrl: string
}

export const PASSWORD_IMPORT_SOURCES: PasswordImportSource[] = [
  {
    name: 'Google Password Manager / Chrome',
    status: 'supported',
    bestPath: 'Export passwords from Chrome, Android, or passwords.google.com as CSV.',
    notes: 'Good first target. CSV exports are designed for moving passwords to another manager.',
    sourceUrl: 'https://passwords.google/',
  },
  {
    name: 'Apple Passwords / iCloud Keychain',
    status: 'limited',
    bestPath: 'Use Apple Passwords/Safari export when available. iPhone export support exists in newer iOS flows; Mac export is still the safest fallback.',
    notes: 'Warn users not to waste time on old iPhone-only advice. If export is missing, use a Mac signed into the same Apple ID.',
    sourceUrl: 'https://support.apple.com/guide/iphone/export-passwords-iphf28f2e93e/ios',
  },
  {
    name: 'Bitwarden',
    status: 'supported',
    bestPath: 'Export an individual vault as CSV or JSON from the web app, extension, desktop, mobile, or CLI.',
    notes: 'CSV is easiest for login import. Organization-owned data may require admin export rights.',
    sourceUrl: 'https://bitwarden.com/help/export-your-data/',
  },
  {
    name: '1Password',
    status: 'limited',
    bestPath: 'Use the desktop app export. CSV generally covers login/password items; 1PUX covers richer 1Password data.',
    notes: 'Do not promise every secure document or passkey will come through a CSV import.',
    sourceUrl: 'https://support.1password.com/import/',
  },
  {
    name: 'LastPass',
    status: 'supported',
    bestPath: 'Export vault data as a generic CSV after account verification.',
    notes: 'The export may include passwords, notes, form fills, and Wi-Fi passwords, but the first app import should focus on login rows.',
    sourceUrl: 'https://support.lastpass.com/help/export-your-passwords-and-secure-notes-lp040004',
  },
  {
    name: 'Dashlane',
    status: 'supported',
    bestPath: 'Export CSV from Dashlane. Credential Exchange may also be available on newer Apple platforms.',
    notes: 'CSV is unencrypted. Delete it after import.',
    sourceUrl: 'https://support.dashlane.com/hc/en-us/articles/202625092-Export-your-Dashlane-data',
  },
  {
    name: 'Keeper',
    status: 'supported',
    bestPath: 'Export Keeper CSV. Keeper CSV supports folders, subfolders, shared folders, and custom fields.',
    notes: 'Shared/business vault exports may need the right admin permissions.',
    sourceUrl: 'https://docs.keeper.io/user-guides/export-and-reports/vault-export',
  },
  {
    name: 'NordPass',
    status: 'supported',
    bestPath: 'Use Settings, Import and export, Export items, then save the CSV.',
    notes: 'Test the CSV before deleting the source vault. Some exports may need cleanup if notes contain unusual formatting.',
    sourceUrl: 'https://support.nordpass.com/hc/en-us/articles/360007646477-How-to-export-passwords-from-NordPass',
  },
  {
    name: 'Browser saved passwords in Edge / Brave / Chromium',
    status: 'manual',
    bestPath: 'Use the browser password manager export if it offers CSV.',
    notes: 'Most Chromium browsers follow the Chrome pattern, but labels differ. If CSV export is not present, do not guess.',
    sourceUrl: 'https://support.google.com/chrome/answer/13068232',
  },
  {
    name: 'Passkeys',
    status: 'avoid',
    bestPath: 'Do not promise passkey import in the first version.',
    notes: 'Passkey portability is improving, but CSV password import is not the same as passkey migration.',
    sourceUrl: 'https://support.dashlane.com/hc/en-us/articles/202625092-Export-your-Dashlane-data',
  },
]
