# Family Vault — Browser Extension

Manifest V3 extension that detects login forms on any website, asks the
vault for matching credentials by registrable domain, and fills them.

## Build + load

```bash
cd extensions/browser
npm install
npm run build
```

In Chrome / Edge: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `extensions/browser/dist/`.

In Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on** → pick any file inside `dist/`.

## Pairing

1. Open the vault → **Settings → Autofill — Linked Devices** → tap
   **Pair new device**. A 6-digit code displays.
2. Click the extension's toolbar icon → **Pair this browser**, OR open
   `chrome://extensions` → Family Vault → **Extension options**.
3. Enter the 6-digit code + a device name. Click **Pair**.
4. Token is stored in `chrome.storage.sync` so it carries to every
   Chrome instance signed into the same Google account.

## Local dev against `http://localhost:3000`

The extension defaults to the production vault URL. To point it at your
local dev server, open the options page and set **Vault URL** to
`http://localhost:3000`. Restart the extension (toggle off + on in
`chrome://extensions`) so the cached service-worker fetch picks up the
new origin.

You'll also need to add the extension's local origin to
`CLIENT_EXT_ORIGINS` in your local `.env.local`. Find the extension's
ID in `chrome://extensions` (under the extension's name when loaded
unpacked). Then set:

```
CLIENT_EXT_ORIGINS=chrome-extension://<id-from-chrome-extensions>
```

Restart `npm run dev` so Next.js picks up the env var.

## Production deploy notes

After publishing the extension:

1. Once it has a stable Web Store ID, set `CLIENT_EXT_ORIGINS` on Vercel
   to include `chrome-extension://<store-id>` (and the Firefox / Edge
   variants if you publish to them).
2. Bump the manifest `host_permissions` if the vault moves to a custom
   domain.

## File map

```
src/
  background/service-worker.ts   – runs in the background, owns the
                                   credential cache + API calls
  content/autofill.ts            – injected into every page; detects
                                   login forms, draws fill widgets
  popup/popup.tsx                – toolbar popup UI (React)
  options/options.tsx            – settings / pairing UI (React)
  lib/api.ts                     – typed fetch wrapper (Bearer auth)
  lib/storage.ts                 – chrome.storage.sync helpers
  lib/messages.ts                – typed runtime.sendMessage shapes
  lib/config.ts                  – default vault URL + storage keys
public/
  manifest.json                  – Manifest V3
  icons/                         – 16/48/128 placeholder icons
popup.html                       – popup entry; vite outputs flat to
                                   dist/popup.html
options.html                     – options entry; vite outputs flat to
                                   dist/options.html
```

## Limitations / known gaps (v1)

- **No auto-submit after fill.** Form gets filled, user clicks Sign In.
- **No password generator.**
- **Field detection is heuristic** — looks for `input[type="password"]`
  + the nearest preceding text/email input. Sites with weird custom
  inputs (banking OTP, multi-step flows) may not get a fill widget.
- **Phishing risk: loose domain matching.** A lookalike domain that
  shares an eTLD+1 with a real entry would surface that credential.
  Mitigation in v2: per-entry exact-URL flag.
