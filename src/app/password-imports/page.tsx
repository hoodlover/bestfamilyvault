import { PublicInfoPage } from '@/components/ui/public-info-page'
import { PASSWORD_IMPORT_SOURCES } from '@/lib/password-import-sources'

const statusLabel = {
  supported: 'Supported',
  limited: 'Limited',
  manual: 'Manual check',
  avoid: 'Do not promise',
}

export default function PasswordImportsPage() {
  return (
    <PublicInfoPage
      eyebrow="Password imports"
      title="Import Passwords From Another Keeper"
      intro="Start here before exporting passwords. CSV files are plain text, so the app should guide people carefully and tell them when an import is not realistic."
      updated="June 28, 2026"
      sections={[
        {
          title: 'Golden rule',
          body: (
            <p>
              Export on a trusted device, import immediately, verify a few important logins, then delete
              the CSV from Downloads, trash, cloud sync folders, and email.
            </p>
          ),
        },
        {
          title: 'Known sources',
          body: (
            <div className="space-y-3">
              {PASSWORD_IMPORT_SOURCES.map((source) => (
                <article key={source.name} className="rounded-lg border border-stone-800 bg-stone-950/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-stone-100">{source.name}</h3>
                    <span className="rounded-full border border-emerald-700/50 px-2 py-0.5 text-[11px] uppercase tracking-wide text-emerald-200">
                      {statusLabel[source.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-stone-300">{source.bestPath}</p>
                  <p className="mt-1 text-xs text-stone-500">{source.notes}</p>
                  <a href={source.sourceUrl} className="mt-2 inline-block text-xs text-emerald-300 hover:text-emerald-200">
                    Official source
                  </a>
                </article>
              ))}
            </div>
          ),
        },
      ]}
    />
  )
}
