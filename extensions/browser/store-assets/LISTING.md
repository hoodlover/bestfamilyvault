# Chrome Web Store listing — Family Vault Autofill

This folder is everything you need to submit the unlisted listing.
Privacy-policy URL is **`https://bestfamilyvault.vercel.app/extension`** —
that page already covers what data is collected, where it lives, and
the user-controlled retention story.

---

## Listing fields (paste into the Web Store dashboard)

### Item name (max 75 chars)

```
Family Vault Autofill
```

### Summary / short description (max 132 chars)

```
Autofill saved logins from your private Family Vault on any website. Capture new passwords on signup with one click.
```

### Detailed description (no hard limit, ~16k chars)

```
Family Vault Autofill is a private password assistant that
talks only to your own Family Vault — a self-hosted family
password manager. There are no third-party servers, no analytics,
no telemetry, no ads.

What it does

  • Detects login forms on any website and offers to fill them with
    your saved usernames + passwords.
  • Notices when you type a fresh password the vault doesn't know
    about and offers to capture it on form submit. The save prompt
    persists across the post-submit redirect, so you can confirm it
    on the next page if you didn't catch it the first time.
  • Generates strong 20-character passwords on demand when you focus
    an empty password field on a signup form.
  • Search every saved login from the toolbar popup, copy username
    or password to the clipboard with one click, or fill the active
    tab.
  • Lock with one tap — clears the bearer token + cached credentials.
    Re-pair from the vault to come back.

Pairing

The extension never stores your master password and doesn't have a
master password of its own. Pairing uses a 6-digit code generated
from inside your vault (Settings → Autofill — Linked Devices). You
paste the code into the extension's options page once; it gets a
long-lived bearer token in exchange. Revoke any browser, anytime,
from the same Linked Devices panel.

How your data is protected

  • Passwords are encrypted at rest in your vault's own Postgres
    database with AES-256-GCM. The extension never sees a plaintext
    password it didn't fetch on demand.
  • The extension caches credentials per-domain for 5 minutes in
    chrome.storage.session — cleared on every browser restart, and
    instantly when you tap Lock.
  • Bearer tokens are stored in chrome.storage.sync (encrypted by
    Chrome) and are SHA-256 hashed before they ever land in the
    vault's database. The plaintext token is shown to the extension
    once at pair time and then never again.
  • All API calls use Authorization: Bearer; no cookies, no
    cross-site request risk.

Phishing protections

  • Domain matching uses the Public Suffix List (eTLD+1), so
    netflix.com and login.netflix.com share entries but unrelated
    sites don't.
  • Top-frame URL check — credential lookups always reference the
    tab's top-level URL, so a malicious nested iframe can't trick
    the extension into filling the parent's vault entries.
  • Cross-origin form action check — if a form's action attribute
    points to a different domain than the page, the extension
    refuses to autofill and shows a warning.
  • Punycode / IDN homograph guard — autofill is disabled outright
    on hostnames that contain xn-- labels.
  • All injected UI lives inside a closed Shadow DOM, so strict-CSP
    sites (banks, government) work correctly and page scripts
    can't reach the widget internals.

Built for families

This extension exists to serve a single self-hosted family vault.
It's not a password-as-a-service. It's not for sale. There's no
upsell. The whole codebase is open and inspectable, including the
service that backs it.

If you don't run a Family Vault, this extension does nothing
for you — it has nothing to talk to. To set one up, the project
README on GitHub has the deploy instructions.

Source: https://github.com/hoodlover/bestfamilyvault
Help & install guide: https://bestfamilyvault.vercel.app/extension
Privacy policy: https://bestfamilyvault.vercel.app/extension
```

### Category

`Productivity`

### Language

`English (United States)`

### Visibility

`Unlisted` — invisible to public search, anyone with the share link
can install. Right call for a family tool.

### Privacy practices form

When the dashboard asks "what user data does this extension handle?",
check exactly these:

  ☑ Authentication information   — bearer token (only your own vault)
  ☑ Personally identifiable info — usernames you saved
  ☑ Web history                  — registrable domain of pages, only
                                   to look up matching credentials
  ☐ Personal communications      (no)
  ☐ Health information           (no)
  ☐ Financial / payment info     (no — passwords aren't "payment info"
                                  in CWS terms; they're auth info)
  ☐ Location                     (no)
  ☐ Web content                  (no — we never read page contents
                                  beyond the password field & form)

**Single purpose** field:
> Autofill the user's saved logins from their own self-hosted Best
> Family Vault, and capture new logins on signup.

**Permission justifications** (Chrome will ask per-permission):

  • `storage` — bearer token + cached credentials list
  • `activeTab` + `scripting` — let the popup fill the focused tab's
    form on a one-click action by the user
  • `host_permissions: https://bestfamilyvault.vercel.app/*` — the only
    host the extension talks to (vault API)
  • `<all_urls>` content script — needed to detect login forms on
    arbitrary websites; no page content is read or transmitted
    beyond the password field's value when the user explicitly saves

---

## Required assets

| Slot | Size | Format | Status |
|------|------|--------|--------|
| Item icon | 128×128 | PNG, alpha | ✅ `../public/icons/128.png` |
| Small promo tile | 440×280 | PNG/JPG, no alpha | ✅ `small-promo-440x280.png` |
| Screenshot 1 | 1280×800 *or* 640×400 | PNG/JPG, no alpha | ⏳ see SCREENSHOT 1 below |
| Screenshot 2 | 1280×800 *or* 640×400 | PNG/JPG, no alpha | ⏳ see SCREENSHOT 2 below |
| Screenshot 3 | 1280×800 *or* 640×400 | PNG/JPG, no alpha | ⏳ see SCREENSHOT 3 below |

Marquee promo (1400×560) is optional and only used by Google for
featured listings — skip for unlisted.

### How to capture screenshots (Windows)

  1. Resize the browser window to a 1280×800 viewport. The easiest
     trick: open DevTools → toggle device toolbar (Ctrl+Shift+M) →
     pick "Responsive" → enter `1280 × 800` → click the kebab menu →
     "Capture screenshot". Or run a vanilla 1280×800 maximized
     window and snip.
  2. Save each as `screenshot-N.png` in this folder.
  3. PNG is fine. No alpha, no transparency.

### Screenshot 1 — "Autofill on a real login form"

Open any non-sensitive site you have a vault entry for (a streaming
service or news site is great — avoid anything that screams
phishing-bait, e.g. a real bank). The frame should show:

  • The site's login form
  • The green `🔑 Fill from vault` pill anchored under the password
    field
  • The site's URL bar visible

Caption suggestion: **"One-tap fill on any login form."**

### Screenshot 2 — "Save banner on signup"

Sign up on a site the vault doesn't yet know about. Submit the form.
Capture the moment the save banner is visible top-right with the
pending entry's title and email. (Use a throwaway `+test` email so
nothing real ends up in the screenshot.)

Caption suggestion: **"Save new logins on submit, no copy-paste."**

### Screenshot 3 — "Toolbar popup with search"

Click the extension icon. Type a partial match (`net` for Netflix,
say) into the search box. The frame should show the popup with the
matching list, copy buttons visible, and the icon + Connected-as
header at the top.

Caption suggestion: **"Search every saved login. Copy or fill from
the toolbar."**

---

## Submission checklist

  ☐ Pay the one-time $5 developer registration fee (per Google
    account; if you've registered before for any other extension,
    skip).
  ☐ Zip `extensions/browser/dist/` (only the built files, NOT the
    src/ tree) and upload it as the package.
  ☐ Upload icon, small promo, 3 screenshots from this folder.
  ☐ Paste the listing copy from the top of this file into the
    dashboard fields.
  ☐ Set visibility to `Unlisted`.
  ☐ Set the privacy-policy URL to `https://bestfamilyvault.vercel.app/extension`.
  ☐ Fill the privacy-practices form per the table above.
  ☐ Submit for review. Typical turnaround for unlisted extensions:
    1–3 business days.
  ☐ When approved, copy the share link and DM it to family members.

---

## Post-launch

  • Set `CLIENT_EXT_ORIGINS` on Vercel to include the published
    extension's `chrome-extension://<store-id>` so CORS lets the
    real installs through. The unpacked-load IDs that worked during
    development won't match the published store ID.
  • Bump the version in `extensions/browser/public/manifest.json`
    on every published change. The dashboard rejects re-uploads
    with the same version.
  • If you ever need to push an emergency update, the dashboard
    button is "Submit update". Same review queue, similar timeline.
