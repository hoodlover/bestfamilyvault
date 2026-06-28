import Link from 'next/link'
import { Download, KeyRound, Laptop, Package, Sparkles } from 'lucide-react'
import type { ExtensionRelease } from '@/lib/actions/extension-release'
import { APP_NAME } from '@/lib/branding'

interface Props {
  release: ExtensionRelease | null
}

// Card shown above the Linked Devices list. Bundles three things into one
// hand-off:
//   1) one-click download of the latest blob-hosted extension zip
//   2) optional: export passwords from Chrome and import into the vault
//   3) the four Load-Unpacked steps a family member runs on their device
//
// Designed so Lance can say "open Settings → Autofill, follow the steps"
// to anyone on the family and they're set up end-to-end in a few minutes.
export function ExtensionDownloadCard({ release }: Props) {
  if (!release) {
    return (
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-200/90">
        <p className="font-medium mb-1">No extension build published yet.</p>
        <p className="text-xs text-amber-200/70 leading-relaxed">
          Build the extension and run <code className="px-1 py-0.5 bg-stone-900/60 rounded">npm run publish:extension</code> from the repo root to make it downloadable here.
        </p>
      </div>
    )
  }

  const sizeKb = (release.sizeBytes / 1024).toFixed(1)
  const uploaded = new Date(release.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <details className="group rounded-xl border border-emerald-800/40 bg-emerald-950/10 open:bg-stone-900/40 open:border-stone-700/60 transition">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 shrink-0">
          <Package size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-stone-100">Install on a new device</div>
          <div className="text-[11px] text-stone-500">
            v{release.version} · {sizeKb} KB · published {uploaded}
          </div>
        </div>
        <Sparkles size={14} className="text-emerald-400 shrink-0 group-open:rotate-180 transition-transform" />
      </summary>

      <div className="px-4 pb-5 pt-2 space-y-5 text-sm">

        {/* Step 1: download */}
        <NumberedStep n={1} title="Download the extension">
          <p className="text-stone-300 mb-3">
            Download the zip below to whatever device you&rsquo;re setting up — your MacBook, a new
            PC, anywhere Chrome (or Edge, Brave, Arc) runs.
          </p>
          <a
            href="/api/extension/download"
            download={release.filename}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition shadow-md"
          >
            <Download size={15} />
            Download {release.filename}
          </a>
        </NumberedStep>

        {/* Step 2: optional Chrome import */}
        <NumberedStep n={2} title="Bring over passwords already saved in Chrome (optional)">
          <p className="text-stone-300 mb-2">
            If the person you&rsquo;re setting up has logins saved in Chrome already, export them
            once and the vault picks them all up.
          </p>
          <ol className="space-y-1.5 text-xs text-stone-400 list-decimal list-inside mb-3 marker:text-stone-600">
            <li>
              Open <Mono>chrome://password-manager/settings</Mono> in Chrome on the device that has the saved passwords.
            </li>
            <li>
              Scroll to <strong>Export passwords</strong> → click <strong>Download file</strong> →
              enter the macOS / Windows account password → save the CSV.
            </li>
            <li>
              Sign into the vault as the family member those passwords belong to (important — entries
              land in whoever is signed in).
            </li>
            <li>
              Open <Link href="/import" className="text-emerald-400 hover:text-emerald-300 underline">/import</Link> →
              drop the CSV → on the mapper, set <em>name</em> → <strong>Title</strong>, <em>url</em> → <strong>URL</strong>,
              {' '}<em>username</em> → <strong>Username</strong>, <em>password</em> → <strong>Password</strong>,
              {' '}<em>note</em> → <strong>Notes</strong> → Import.
            </li>
            <li className="text-amber-300/90">
              Delete the exported CSV from disk afterwards — it&rsquo;s plaintext passwords.
            </li>
          </ol>
          <p className="text-[11px] text-stone-500 italic">
            Skip this step if you&rsquo;re just setting up another browser for someone whose vault is already populated.
          </p>
        </NumberedStep>

        {/* Step 3: install */}
        <NumberedStep n={3} title="Load it into Chrome">
          <ol className="space-y-1.5 text-xs text-stone-400 list-decimal list-inside marker:text-stone-600">
            <li>Unzip the file you just downloaded. Remember where the unzipped folder lives.</li>
            <li>
              Open a new tab and go to <Mono>chrome://extensions</Mono>.
            </li>
            <li>
              Toggle <strong>Developer mode</strong> on (top-right corner).
            </li>
            <li>
              Click <strong>Load unpacked</strong> → pick the unzipped folder.
            </li>
            <li>
              Click the puzzle-piece icon in the Chrome toolbar → pin <em>{APP_NAME} Autofill</em> so its icon stays visible.
            </li>
          </ol>
          <div className="mt-3 flex gap-2 text-[11px] text-stone-500 bg-stone-950/60 border border-stone-800 rounded-lg p-2.5">
            <Laptop size={13} className="shrink-0 mt-0.5 text-stone-500" />
            <span>
              Same steps work in Edge (<Mono>edge://extensions</Mono>), Brave (<Mono>brave://extensions</Mono>),
              and other Chromium browsers.
            </span>
          </div>
        </NumberedStep>

        {/* Step 4: pair */}
        <NumberedStep n={4} title="Pair the extension with the vault">
          <p className="text-stone-300 mb-2">
            Use the <strong>Pair new device</strong> button just below this card to get a 6-digit code,
            then enter it in the extension&rsquo;s Options page on the new device.
          </p>
          <div className="flex gap-2 text-[11px] text-stone-500 bg-stone-950/60 border border-stone-800 rounded-lg p-2.5">
            <KeyRound size={13} className="shrink-0 mt-0.5 text-stone-500" />
            <span>
              The pairing token is per-device, so a Mac browser and a PC browser show up as two
              separate Linked Devices — revoke either independently any time.
            </span>
          </div>
        </NumberedStep>

      </div>
    </details>
  )
}

function NumberedStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-100 mb-2">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-700/30 border border-emerald-600/50 text-emerald-300 text-xs font-bold">
          {n}
        </span>
        {title}
      </h3>
      <div className="pl-8">{children}</div>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-0.5 text-[11px] bg-stone-800 border border-stone-700 rounded text-stone-200">
      {children}
    </code>
  )
}
