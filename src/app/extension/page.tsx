import Link from 'next/link'
import Image from 'next/image'
import {
  KeyRound,
  ShieldCheck,
  Sparkles,
  RefreshCcw,
  Eye,
  HelpCircle,
} from 'lucide-react'
import { APP_NAME, APP_SHORT_NAME } from '@/lib/branding'

// Public help / install / privacy page for the autofill extension.
// Doubles as the privacy-policy URL in the Chrome Web Store listing,
// so it MUST be reachable without auth.

export const metadata = {
  title: `${APP_NAME} Autofill — Install & Help`,
  description: `Install the ${APP_NAME} browser extension to autofill saved passwords on any site, and capture new logins as you sign up.`,
}

export default function ExtensionPage() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <div className="max-w-3xl mx-auto px-4 py-10 md:py-14">
        {/* Hero */}
        <header className="text-center mb-12">
          <div className="flex justify-center mb-4">
            <Image
              src="/icons/cobb/icons/system/vault_extension.png"
              alt={APP_NAME}
              width={128}
              height={128}
              className="rounded-2xl shadow-xl shadow-black/40"
              priority
            />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-stone-100 mb-2">
            {APP_NAME} Autofill
          </h1>
          <p className="text-stone-400 max-w-xl mx-auto">
            One click to fill saved passwords on any site. One tap to save new ones as
            you sign up. Family-only — your data never leaves the vault.
          </p>
        </header>

        {/* Install */}
        <Section icon={<Sparkles className="text-emerald-400" size={20} />} title="Install">
          <ol className="space-y-4 text-sm">
            <Step n={1}>
              On a desktop browser (Chrome, Edge, Brave, Arc, or any Chromium build),
              open <Mono>chrome://extensions</Mono>.
            </Step>
            <Step n={2}>
              Toggle <strong>Developer mode</strong> on (top-right corner).
            </Step>
            <Step n={3}>
              Click <strong>Load unpacked</strong> and pick the{' '}
              <Mono>extensions/browser/dist/</Mono> folder from the vault repo.
            </Step>
            <Step n={4}>
              Pin the vault icon so it&rsquo;s always visible: click the puzzle-piece
              icon in your toolbar, then the pushpin next to <em>{APP_NAME} Autofill</em>.
            </Step>
          </ol>
          <Note>
            Once we publish to the Chrome Web Store, this becomes a single
            click-to-install link. For now, the unpacked-load path keeps things in the family.
          </Note>
        </Section>

        {/* Pair */}
        <Section icon={<KeyRound className="text-amber-300" size={20} />} title="Pair the extension">
          <ol className="space-y-4 text-sm">
            <Step n={1}>
              Open the vault, then go to{' '}
              <Link href="/settings" className="text-emerald-400 hover:text-emerald-300 underline">
                Settings → Autofill — Linked Devices
              </Link>
              .
            </Step>
            <Step n={2}>
              Tap <strong>Pair new device</strong>. A 6-digit code appears for 10 minutes.
            </Step>
            <Step n={3}>
              Right-click the vault icon in your browser toolbar →{' '}
              <strong>Options</strong> (or <Mono>chrome://extensions</Mono> → {APP_SHORT_NAME} →{' '}
              <em>Extension options</em>).
            </Step>
            <Step n={4}>
              Enter the 6-digit code, give your browser a name (&ldquo;Home laptop
              Chrome&rdquo;), click <strong>Pair</strong>.
            </Step>
          </ol>
          <Note>
            The browser stores its bearer token in <Mono>chrome.storage.sync</Mono>, so
            signing into Chrome with the same Google account on another machine carries
            the pairing over. To revoke a browser, head back to Linked Devices and tap
            Revoke — its token stops working immediately.
          </Note>
        </Section>

        {/* How it works */}
        <Section icon={<RefreshCcw className="text-sky-300" size={20} />} title="Daily use">
          <ul className="space-y-3 text-sm">
            <Bullet
              label="Fill"
              body={
                <>
                  When you land on a login page, a small green{' '}
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-900/60 border border-emerald-600/40 rounded text-xs">
                    🔑 Fill from vault
                  </span>{' '}
                  pill appears under each password field. Click it → username and
                  password drop in.
                </>
              }
            />
            <Bullet
              label="Save"
              body={
                <>
                  Type a fresh password the vault doesn&rsquo;t know about and submit
                  the form. A &ldquo;Save to {APP_SHORT_NAME}?&rdquo; banner appears
                  top-right. The prompt persists across the form-submit redirect, so
                  even if the page navigates, you can still confirm on the next page.
                </>
              }
            />
            <Bullet
              label="Dismiss"
              body={
                <>
                  Click the <Mono>×</Mono> on the green pill to hide all autofill
                  widgets for that page. They come back on the next page load.
                </>
              }
            />
            <Bullet
              label="Revoke"
              body={
                <>
                  In <Link href="/settings" className="text-emerald-400 hover:text-emerald-300 underline">Settings → Linked Devices</Link>{' '}
                  tap Revoke next to any browser to cut its access.
                </>
              }
            />
          </ul>
        </Section>

        {/* Troubleshooting */}
        <Section icon={<HelpCircle className="text-stone-300" size={20} />} title="Troubleshooting">
          <dl className="space-y-4 text-sm">
            <Trouble
              q="The green pill never appears."
              a="Either no entry in the vault matches this site (open Settings → Linked Devices to confirm pairing), or the field is unusual (heavily customized inputs sometimes evade detection). Right-click the field, Inspect — if it isn't an <input type='password'>, the extension intentionally skips it to avoid filling the wrong thing."
            />
            <Trouble
              q="I clicked Save and got 'Failed: Not paired to vault.'"
              a="The bearer token was rejected — usually because the device was revoked, or the vault host changed. Open the extension's Options page and re-pair with a fresh code from Settings → Linked Devices."
            />
            <Trouble
              q="Toolbar badge shows a number."
              a="That's the count of pending save prompts. Click the icon (or revisit the site you were just on) to confirm or dismiss them. They auto-expire after 5 minutes."
            />
            <Trouble
              q="Local development — extension talks to localhost:3000."
              a="Open the extension's Options page → set Vault URL to http://localhost:3000 → reload the extension. Add chrome-extension://<your-id> to CLIENT_EXT_ORIGINS in .env.local so CORS lets it through."
            />
          </dl>
        </Section>

        {/* Privacy */}
        <Section icon={<ShieldCheck className="text-emerald-400" size={20} />} title="Privacy">
          <div className="text-sm space-y-3 text-stone-300">
            <p>
              The extension only ever talks to <strong>your</strong> {APP_NAME}
              instance. There are no third-party servers, no analytics, no telemetry,
              no ads.
            </p>
            <p>
              <strong>What gets sent:</strong> the registrable domain of whatever page
              you&rsquo;re looking at, plus your bearer token in the{' '}
              <Mono>Authorization</Mono> header. The vault returns matching credentials
              for that domain. Nothing else leaves your browser without your action.
            </p>
            <p>
              <strong>Where data lives:</strong> in the vault&rsquo;s Postgres database
              (Neon). Passwords are encrypted at rest with AES-256-GCM using a key only
              the vault server knows. The extension never stores plaintext passwords —
              it pulls them on demand and the cache (5 minute TTL) sits in{' '}
              <Mono>chrome.storage.session</Mono>, cleared on browser close.
            </p>
            <p>
              <strong>Permissions used:</strong> <Mono>storage</Mono> (token + cache),{' '}
              <Mono>activeTab</Mono> + <Mono>scripting</Mono> (so the popup can fill the
              focused tab&rsquo;s form on click), and host permissions for the vault
              URL only.
            </p>
            <p>
              <strong>You control everything:</strong> revoke a browser&rsquo;s access
              from Linked Devices, delete an entry, or sign out — all from the vault.
              No support email, no account closure form: this is a family tool you own
              outright.
            </p>
          </div>
        </Section>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-stone-800 text-center text-xs text-stone-500 space-y-2">
          <p>
            <Link href="/dashboard" className="hover:text-stone-300 transition">
              Back to vault
            </Link>{' '}
            ·{' '}
            <Link href="/settings" className="hover:text-stone-300 transition">
              Linked Devices
            </Link>
          </p>
          <p>{APP_NAME} — for the family, by the family.</p>
        </footer>
      </div>
    </div>
  )
}

// ─── Building blocks ────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10 rounded-2xl border border-stone-800 bg-stone-900/40 p-5 md:p-6">
      <h2 className="flex items-center gap-2 text-lg md:text-xl font-semibold text-stone-100 mb-4">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 mt-0.5 h-6 w-6 rounded-full bg-emerald-700/30 border border-emerald-600/50 text-emerald-300 text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}

function Bullet({ label, body }: { label: string; body: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 mt-0.5 px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded bg-stone-800 text-stone-300 border border-stone-700">
        {label}
      </span>
      <span className="pt-0.5 text-stone-300">{body}</span>
    </li>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-2 text-xs text-stone-400 bg-stone-950/60 border border-stone-800 rounded-lg p-3">
      <Eye size={14} className="shrink-0 mt-0.5 text-stone-500" />
      <span>{children}</span>
    </div>
  )
}

function Trouble({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-semibold text-stone-200">{q}</dt>
      <dd className="mt-1 text-stone-400">{a}</dd>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-0.5 text-xs bg-stone-800 border border-stone-700 rounded text-stone-200">
      {children}
    </code>
  )
}
