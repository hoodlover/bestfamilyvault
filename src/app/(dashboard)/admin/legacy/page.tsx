import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function LegacyPlanPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser') redirect('/admin')

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">

      <header className="mt-4 mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-stone-100 flex items-center gap-3 flex-wrap">
          <span className="text-3xl">⚰️</span>
          Dead Man&apos;s Switch — design review
          <HelpPopout
            title="Dead Man's Switch"
            sections={[
              {
                heading: 'What it will do',
                tips: [
                  { title: 'Auto-release on absence', description: 'After the owner has been signed in zero times for N days, sealed letters + capsules auto-unlock for their recipients.' },
                  { title: 'Trustee override', description: 'A small group of trusted people can independently confirm and force-release earlier than the timer.' },
                  { title: 'Offline backup', description: 'A sealed paper envelope with a master key kept offline. Belt-and-suspenders.' },
                ],
              },
              {
                heading: 'Status',
                tips: [
                  { title: 'Not wired up yet', description: 'This page is a reference / design doc. The trigger code lives in the schema but doesn\'t run yet.' },
                  { title: 'Review + iterate', description: 'Edit the doc with your thoughts; finalize the design before flipping it on in prod.' },
                ],
              },
            ]}
          />
        </h1>
        <p className="text-sm text-stone-400 mt-2 max-w-prose">
          Reference document so you can review the plan before we build it.
          Nothing on this page is wired up yet — the trigger that releases
          letters is intentionally manual until you sign off on this design.
        </p>
      </header>

      <div className="space-y-8 text-stone-200 leading-relaxed">
        <Section title="The problem we&rsquo;re solving">
          <p>
            The owner may write 1&ndash;2 letters per recipient per year, intended for them to
            read after you&rsquo;re gone. The letters need to stay sealed while you&rsquo;re
            alive — even recipients can&rsquo;t open their own folders until the trigger fires.
            The system needs to detect your death (or strong evidence of it) and
            release the letters automatically, while not falsely triggering if
            you&rsquo;re traveling, hospitalized, or just busy.
          </p>
        </Section>

        <Section title="Current state (today, post-deploy)">
          <ul className="list-disc list-outside pl-6 space-y-1.5">
            <li>The <code className="text-emerald-300">letter_release</code> table exists. Its <code className="text-emerald-300">releasedAt</code> column starts as <code>NULL</code>.</li>
            <li>The <code className="text-emerald-300">/letters</code> page checks that flag. While it&rsquo;s <code>NULL</code> or in the future, only you (superuser) see letter content. Family see sealed cards with counts.</li>
            <li>There is <strong>no automated trigger</strong> yet. The only way to flip the flag right now is a manual SQL update in the Neon console.</li>
          </ul>
        </Section>

        <Section title="Layer 1 — Inactivity heartbeat (35 / 60 / 90 day cadence)">
          <p>
            The app already records <code className="text-emerald-300">user.updatedAt</code> on each login. A daily Vercel cron job evaluates how long it&rsquo;s been since you last logged in:
          </p>
          <ul className="list-disc list-outside pl-6 space-y-1.5 mt-3">
            <li><strong>Day 35 of inactivity:</strong> first warning email with a one-click link that resets the timer.</li>
            <li><strong>Day 60:</strong> second warning to you AND a heads-up email to your trusted contacts. You can still reset.</li>
            <li><strong>Day 90:</strong> auto-flip — <code className="text-emerald-300">letterRelease.releasedAt = now()</code>. Family sees their letters next time they log in.</li>
          </ul>
          <p className="mt-3">
            Each warning email also offers a one-click <em>extend by 90 days</em> button if you know you&rsquo;ll be off-grid for a while.
          </p>
        </Section>

        <Section title="Layer 2 — Trusted-contact override (manual)">
          <p>
            For unexpected death, the inactivity timer takes too long. You designate <strong>3&ndash;5 trusted contacts</strong> ahead of time (a partner, sibling, close friend, lawyer, etc.). Each gets a unique unguessable URL like:
          </p>
          <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs overflow-x-auto mt-2">
{`https://familyvault.example/release/contact-a/Hh7-q2K8s9v-bX4mwL3
https://familyvault.example/release/contact-b/Mk2-pq8R3-vBnW7-aL9d
https://familyvault.example/release/contact-c/S4r-Y9pX-jR2-wN8m-K7`}
          </pre>
          <p className="mt-3">
            They click → confirm in a stark page → it counts as one vote. When <strong>≥ 2 distinct trusted contacts have voted within 30 days</strong> AND you haven&rsquo;t logged in for 7+ days AND you haven&rsquo;t cancelled their votes, the release flag flips.
          </p>
          <p className="mt-3">
            <strong>You get an email instantly</strong> when anyone votes. You can cancel votes by clicking the email&rsquo;s veto link or from a banner that appears on your dashboard. While you&rsquo;re alive and reachable, no false trigger can stick.
          </p>
        </Section>

        <Section title="Layer 3 — Sealed envelope with executor (offline)">
          <p>
            Belt and suspenders. The master encryption key (once Tier 2 ships) is also written on paper and given to your lawyer or executor. They hand it to the designated person on death certificate. Independent of the app entirely. If everything else fails (Vercel down, Resend down, both trusted contacts unreachable, your account deleted), the family still has access.
          </p>
          <p className="mt-3 text-amber-300">
            <strong>Recommendation:</strong> do this part today, on paper, regardless of what we build. The app is a redundant safety net, not the authoritative key holder.
          </p>
        </Section>

        <Section title="Engineering scope (Session B, after Tier 2)">
          <ul className="list-disc list-outside pl-6 space-y-1.5">
            <li>New tables: <code className="text-emerald-300">trustedContact</code> (id, name, email, token, createdBy) and <code className="text-emerald-300">releaseVote</code> (id, contactId, votedAt, cancelledAt).</li>
            <li>Public route <code className="text-emerald-300">/release/[contactId]/[token]</code> — no auth, just token lookup. Stark confirm page.</li>
            <li>Admin UI to add/remove trusted contacts and pick the threshold.</li>
            <li>Resend integration (you already have <code>RESEND_API_KEY</code> in <code>.env.local</code>).</li>
            <li>Vercel cron at <code className="text-emerald-300">/api/cron/check-release</code> (config in <code>vercel.json</code>) that runs daily and evaluates inactivity + votes.</li>
            <li>Banner on your dashboard surfacing pending votes you can cancel.</li>
          </ul>
        </Section>

        <Section title="What this design does NOT solve">
          <ul className="list-disc list-outside pl-6 space-y-1.5">
            <li><strong>Coordinated attack:</strong> 2+ trusted contacts conspiring against you. Mitigation is choosing them carefully — there&rsquo;s no technical fix for &ldquo;your family conspires to declare you dead.&rdquo;</li>
            <li><strong>Incapacitation while alive</strong> (dementia, long coma): the inactivity timer would still fire after 90 days. That may or may not be what you want — some people want letters released when they can no longer write new ones. Ask yourself which you prefer.</li>
            <li><strong>Hostile server access:</strong> if someone steals the <code>ENCRYPTION_KEY</code> AND has DB access, they can decrypt letters regardless of the release flag. Tier 2 + good ops hygiene mitigates this.</li>
          </ul>
        </Section>

        <p className="text-xs text-stone-500 italic pt-4 border-t border-stone-800">
          This document lives at <code>/admin/legacy</code> and is editable by checking the source at <code>src/app/(dashboard)/admin/legacy/page.tsx</code>.
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg md:text-xl font-semibold text-stone-100 mb-2">{title}</h2>
      <div className="text-sm md:text-[15px]">{children}</div>
    </section>
  )
}
