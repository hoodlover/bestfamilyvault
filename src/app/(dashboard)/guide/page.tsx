import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { GuideWelcome } from '@/components/ui/guide-welcome'

type Role = 'superuser' | 'admin' | 'member' | 'readonly'

interface RoleInfo {
  label: string
  badge: string
  body: string
}

const ROLE_COPY: Record<Role, RoleInfo> = {
  superuser: {
    label: 'Superuser',
    badge: 'border-purple-600/50 bg-purple-950/30 text-purple-200',
    body: 'You see everything in the family vault and the Admin Vault, plus you run the Admin panel. The one thing you can’t see: items another family member marked Personal. That’s their corner — even you don’t get a key.',
  },
  admin: {
    label: 'Admin',
    badge: 'border-emerald-600/50 bg-emerald-950/30 text-emerald-200',
    body: 'You can read and edit the shared vault, send invites, and tidy categories. Admin Vault and other family members’ Personal items stay invisible to you.',
  },
  member: {
    label: 'Member',
    badge: 'border-amber-600/50 bg-amber-950/30 text-amber-200',
    body: 'Read everything in the shared vault, add your own stuff. Anything you mark Personal is invisible to everyone else. That’s the deal.',
  },
  readonly: {
    label: 'Read-only',
    badge: 'border-stone-600/50 bg-stone-800/40 text-stone-300',
    body: 'You can browse and read but can’t add or edit. Hit the Request Upgrade option in the menu under your photo when you’re ready for write access.',
  },
}

export default async function GuidePage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = (session.user.role ?? 'readonly') as Role

  const fullName = (session.user.name ?? '').trim()
  const firstName = fullName.split(/\s+/)[0] || 'there'
  const roleInfo = ROLE_COPY[role] ?? ROLE_COPY.readonly

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">

      <header className="mt-4 mb-8 text-center">
        <div className="flex justify-center mb-3" aria-hidden="true">
          <Wrench size={14} className="text-stone-600" />
        </div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500 mb-3">For the family</p>
        <h1 className="text-3xl md:text-4xl font-bold text-stone-50 leading-tight">
          Best Family Vault
          <span className="block mt-1">Simply This List</span>
        </h1>
        <p className="mt-3 text-stone-400 text-base max-w-prose mx-auto">
          A little book for organizing the stuff that matters — passwords, bills, recipes, important papers, family. Read it in order, or jump to what you need.
        </p>
      </header>

      {/* Personal welcome card */}
      <section className="mb-8 rounded-2xl border border-emerald-700/40 bg-gradient-to-br from-emerald-950/40 via-stone-900/40 to-stone-900/60 p-5 md:p-6">
        <GuideWelcome firstName={firstName} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-stone-500">Your role:</span>
          <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold uppercase tracking-wider rounded-full border ${roleInfo.badge}`}>
            {roleInfo.label}
          </span>
        </div>
        <p className="mt-3 text-sm md:text-base text-stone-300 leading-relaxed">
          {roleInfo.body}
        </p>
      </section>

      {/* Pointer to the full inventory list. Keeps this page focused on
          the "how do I actually use it" walkthrough; the comprehensive
          feature roll-call lives at /guide/everything (linked from
          Settings too). */}
      <section className="mb-8 rounded-2xl border border-stone-700 bg-stone-900/50 p-4 md:p-5">
        <p className="text-sm text-stone-300 leading-relaxed">
          Looking for the <strong className="text-stone-100">full list</strong> of every feature in one place?
          That lives at <Link href="/guide/everything" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">What can I do here?</Link> — the cheat-sheet for everything the vault can do, in plain English.
        </p>
      </section>

      <div className="space-y-6">
        <Step n={1} title="Sign in">
          <p>
            Type your email and the password your vault admin gave you.
          </p>
          <p className="mt-2">
            Forgot it? Tap <em>Forgot password?</em> under the sign-in box. You’ll get an email with a reset link. The link works <strong>once</strong> and <strong>expires in an hour</strong>, so use it right away.
          </p>
        </Step>

        <Step n={2} title="The home screen — what you’re looking at">
          <p>
            After you sign in you land on the <Link href="/dashboard" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">home screen</Link>. It’s a wall of <strong>tiles</strong>. Each tile is a thing you can do — bills, recipes, family, photos, taxes, and so on. Tap one to go in.
          </p>
          <p className="mt-2">
            On your phone, the <strong>bottom of the screen</strong> always shows five buttons: <strong>Home, Find, Add, My Vault, Menu</strong>. Those follow you everywhere. If you ever feel lost, tap <strong>Home</strong> and you’re back where you started.
          </p>
        </Step>

        <Step n={3} title="Find something you already saved">
          <p>
            Tap <Link href="/search" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Find</Link> (the magnifying glass at the bottom). Type any part of what you’re looking for — the bank’s name, the doctor’s name, a phone number, anything. Matches show up as you type. Same idea as searching your email.
          </p>
          <p className="mt-2">
            On a computer, the search box lives in the sidebar on the left, and <kbd className="px-1.5 py-0.5 text-xs bg-stone-800 border border-stone-700 rounded">Ctrl-K</kbd> jumps straight to it.
          </p>
        </Step>

        <Step n={4} title="Save a password (the most common thing you’ll do)">
          <p>
            Tap the big <strong>+ Add</strong> button at the bottom of the phone, then pick <strong>Password</strong>. Type the website name (Netflix, Bank of America, your doctor’s portal), your username or email, and the password. Tap Save.
          </p>
          <p className="mt-2">
            Next time you forget it, just <Link href="/search" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Find</Link> the site name and the password is right there. Tap the eye icon to peek at it; tap the copy button to paste it where you need.
          </p>
        </Step>

        <Step n={5} title="Take a picture of an important card">
          <p>
            Got a driver’s license, Social Security card, Medicare card, passport, or insurance card? Add → <strong>Identity</strong> (or <strong>Document</strong> for paper things). Then tap <strong className="text-emerald-300">Scan with camera</strong>.
          </p>
          <p className="mt-2">
            Line the card up on the screen and snap. The app <strong>reads the card itself</strong> — name, number, expiry date — so you don’t have to type tiny numbers. Look it over, fix anything that’s wrong, save.
          </p>
        </Step>

        <Step n={6} title="Save your bank accounts and credit cards">
          <p>
            Add → <strong>Bank account</strong> or <strong>Credit card</strong>. Type the bank name, the account number, what kind (checking, savings, money market), and the customer-service phone number. That’s it — the card is in the vault.
          </p>
          <p className="mt-2">
            Credit cards have a <strong className="text-emerald-300">Scan card</strong> button too: point the camera at the front and it reads the number, expiry, and your name.
          </p>
          <p className="mt-2">
            Want to see every credit card and ID you’ve saved in one place? <Link href="/cards" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Cards</Link> shows them as a wall of tiles — the scan photo is the tile picture, so you spot the right one at a glance.
          </p>
          <p className="mt-2 text-xs text-stone-500">
            If you want statements to file themselves automatically, use the import-folder workflow. Dropped statements can land in the right account on their own.
          </p>
        </Step>

        <Step n={7} title="Write a note or make a checklist">
          <p>
            Add → <strong>Note</strong> for a blank page you can write anything on. The text autosaves every half-minute, so you can’t lose your typing. You can <strong>bold</strong> things, add bullets, or tick checkboxes. Everything you write lives on the <Link href="/notes" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Notes page</Link>.
          </p>
          <p className="mt-2">
            Add → <strong>To-do list</strong> if you just want a checklist. Today’s date is already the title and the cursor is in the typing box, so you can start right away. Hit Enter to drop the next blank row. Tick the boxes as you finish. All your lists live on the <Link href="/todos" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">To-do page</Link>.
          </p>
        </Step>

        <Step n={8} title="Track your monthly bills">
          <p>
            Open any bill you saved (Netflix, the cable bill, the power bill, your insurance) and tick the <strong>“Mark as recurring”</strong> box. Pick how much, how often (monthly or yearly), and when it’s next due.
          </p>
          <p className="mt-2">
            The vault will <strong>remind you 3 days before each one</strong> with a notification on your phone. The <Link href="/subscriptions" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Subscriptions page</Link> shows them all in a list with your monthly total — so you can finally see exactly what’s coming out every month. Want to see them on a month grid? <Link href="/calendar" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Calendar</Link> lays every bill and renewal out by date.
          </p>
        </Step>

        <Step n={9} title="Recipes, meal plans, and the grocery list">
          <p>
            Add → <strong>Recipe</strong> — three easy ways: <strong className="text-emerald-300">type it in</strong>, <strong className="text-emerald-300">paste a link</strong> from any cooking website, or <strong className="text-emerald-300">take a photo</strong> of a cookbook page. The app figures out the ingredients and steps for you. All your saved recipes live on the <Link href="/recipes" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Recipes page</Link>.
          </p>
          <p className="mt-2">
            When you’re ready to cook, tap <strong>Start recipe</strong> for <strong className="text-emerald-300">huge-text cooking mode</strong>. One step at a time, the screen stays on so it doesn’t blank while you’re stirring, and there’s a little speaker icon if you want it read out loud.
          </p>
          <p className="mt-2">
            <Link href="/meal-plan" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Meal Plan</Link> lets you pick recipes for the week. Tap <strong>Build shopping list</strong> and every ingredient lands on your <Link href="/meal-plan/grocery" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Grocery list</Link> — flour from three recipes becomes one line, not three. Add things that aren’t in a recipe (paper towels, eggs, snacks) and they stick around.
          </p>
        </Step>

        <Step n={10} title="Family phone numbers and addresses, fast">
          <p>
            On the <Link href="/dashboard" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">home screen</Link> tap the <strong>Family Info</strong> tile. A box pops up with every family member’s phone, email, birthday, address, and important card numbers — all on one page.
          </p>
          <p className="mt-2">
            Tap the little copy icon next to any phone number or email to copy it. Paste it into a text message, into your phone’s dialer, wherever. Tap <strong>View card</strong> on any person to see their full profile.
          </p>
          <p className="mt-2">
            Your whole address book lives on the <Link href="/contacts" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Contacts page</Link>. Each row has a Call / Text / Email button right there — one tap opens your phone, messages, or mail app.
          </p>
        </Step>

        <Step n={11} title="Send a message or a voice memo to family">
          <p>
            On the <Link href="/dashboard" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">home screen</Link>, there’s a row of family photos under <em>Family</em>. Tap anyone (except yourself) and a little chat opens. <strong>Type</strong> what you want to say, or tap the microphone to <strong className="text-emerald-300">record a voice memo</strong>. The full thread lives on the <Link href="/messages" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Messages page</Link>.
          </p>
          <p className="mt-2">
            They’ll see a red dot on their photo next time they open the app. They get an email too, so even if they’re not in the app, they’ll know.
          </p>
        </Step>

        <Step n={12} title="Letters and time capsules — for later">
          <p>
            <Link href="/letters" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Family Letters</Link>: write, record audio, or record a video letter for one family member or all. The vault holds onto them quietly.
          </p>
          <p className="mt-2">
            <Link href="/capsules" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Time Capsules</Link>: write a note, pick an unlock date (a year out, ten years out, whenever), and hit Seal. The vault hides it until that date — even from a database admin reading the back end. Nobody can peek early.
          </p>
          <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3">
            <p className="text-amber-200 font-semibold text-sm mb-1">When do letters get released?</p>
            <p className="text-amber-100/80 text-sm leading-relaxed">
              They auto-unlock if the owner has not signed in for a long time, or if a small group of trusted people confirms something happened. There can also be a paper envelope with a backup key kept offline. The point is simple: the letters are there when the family needs them.
            </p>
          </div>
        </Step>

        <Step n={13} title="“For when I’m gone” — the wizard">
          <p>
            <Link href="/now-what" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">I’m Dead, Now What?</Link> is a guided list of every question your family will need answered: where the will is, who your lawyer is, what insurance is in force, where the safe-deposit-box key lives, who handles the funeral.
          </p>
          <p className="mt-2">
            It walks you through them one at a time. Claude suggests answers based on stuff you’ve already saved in the vault — you just check, edit, and save. You can attach the actual document (a copy of the will, the IRA paperwork) right onto the answer.
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Topics that drift each year (taxes, insurance, brokerage) wear a “Yearly” pill — if an answer hasn’t been touched in over a year it goes red so it stands out. There’s a banner on the home dashboard that counts how many are overdue.
          </p>
        </Step>

        <Step n={14} title="Ask the vault a question">
          <p>
            Tap <strong>Ask</strong> at the top (or visit <Link href="/ask" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">/ask</Link>). Type a regular question, the way you’d ask a person:
          </p>
          <ul className="list-disc list-outside pl-6 mt-2 space-y-1">
            <li>“What’s the cabin Wi-Fi password?”</li>
            <li>“When does the Mercedes registration expire?”</li>
            <li>“Where’s our marriage license?”</li>
            <li>“Which credit cards have annual fees?”</li>
          </ul>
          <p className="mt-2">
            Claude searches across everything you can see in the vault and answers — with a link to <strong>exactly</strong> where the answer came from so you can verify.
          </p>
        </Step>

        <Step n={15} title="Reminders on your phone">
          <p>
            <Link href="/settings" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Settings</Link> → Reminders turns on phone notifications. The vault will ping you:
          </p>
          <ul className="list-disc list-outside pl-6 mt-2 space-y-1">
            <li><strong>3 days before</strong> each recurring bill is due.</li>
            <li>When a bank statement should be ready to drop in.</li>
            <li>When a credit card is about to expire.</li>
          </ul>
          <p className="mt-2">
            Want bills on your regular phone calendar too? <Link href="/settings" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Settings</Link> → Calendar Feed gives you a link to paste into Apple Calendar or Google Calendar — renewals show up next to your appointments. The <Link href="/calendar" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">in-app calendar</Link> shows the same dates with a one-tap “Mark handled” button.
          </p>
          <p className="mt-2">
            Every Sunday morning, an <strong>email digest</strong> lands in your inbox: what’s due this week, what’s about to expire, any bills whose price snuck up.
          </p>
        </Step>

        <Step n={16} title="Put it on your phone like a real app">
          <p>
            <strong>iPhone:</strong> tap the Share button at the bottom of Safari → <em>Add to Home Screen</em>. The vault gets its own icon, no more Safari address bar in the way.
          </p>
          <p className="mt-2">
            <strong>Android:</strong> a small <em>Install</em> banner pops up after you sign in — tap it. Same effect: a real app icon on your home screen.
          </p>
          <p className="mt-2 text-xs text-stone-500">
            On iPhone, “Add to Home Screen” is also required for the reminder pings in Step 15 to work.
          </p>
        </Step>

        <Step n={17} title="The “Favorite” heart (just for you)">
          <p>
            Anything you tick as a <strong>Favorite</strong> goes into <Link href="/my-vault" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">My Vault</Link> (the gold safe icon on the bottom nav) — your own greatest-hits list of stuff you open a lot.
          </p>
          <p className="mt-2">
            Your favorites are <strong className="text-emerald-300">just yours</strong>. If you favorite Netflix, nobody else sees a heart on theirs. Same the other way.
          </p>
        </Step>

        <Step n={18} title="Personal vs. shared — your locked corner">
          <p>
            When you save anything, you can tick <strong className="text-emerald-300">Personal (only you)</strong>. That item becomes invisible to everyone else, <strong>everyone included</strong>. Real lock. Not theater. Your Personal items also collect under <Link href="/my-vault" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">My Vault</Link>.
          </p>
          <p className="mt-2">
            Use it for whatever you want — a journal, a private wifi list, plans you’re not ready to share.
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Heads up: if you forget your password <strong>and</strong> lose the email you signed up with, your Personal stuff goes with you. The vault has no master key for those.
          </p>
        </Step>

        <Step n={19} title="When you’re stuck">
          <p>
            Every page has a small <strong className="text-emerald-300">?</strong> button at the top. Tap it for help on <em>that page</em> — what the buttons mean, what the icons do, where the hidden bits hide.
          </p>
          <p className="mt-2">
            For the full list of <strong>everything the vault can do</strong> in one place, tap <Link href="/guide/everything" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">What can I do here?</Link>. Or hop into <Link href="/settings" className="inline-flex items-center px-2 py-0.5 rounded-md border border-accent-500 bg-accent-500/30 text-stone-100 hover:bg-accent-500/45 transition no-underline">Settings</Link> → Request a Feature and write what you wish it did.
          </p>
        </Step>

        <Step n={20} title="Keep going">
          <p>
            Start with a few high-value records, then replace the sample data as you go. The vault gets more useful each time you add a real account, note, file, or reminder.
          </p>
          <p className="mt-2 text-xs text-stone-500 italic">
            Tip: use Favorites for the things you open often.
          </p>
        </Step>

        {/* "Just for you" — personalized to the signed-in family member. */}
        {role === 'superuser' ? (
          <div className="rounded-2xl border border-purple-700/40 bg-purple-950/20 p-5">
            <p className="text-purple-200 font-semibold text-sm mb-2">For superusers</p>
            <p className="text-stone-300 text-sm leading-relaxed">
              <Link href="/admin" className="text-purple-300 underline hover:text-purple-200">Admin panel</Link> + <Link href="/admin/legacy" className="text-purple-300 underline hover:text-purple-200">Dead Man’s Switch</Link> + <Link href="/vault" className="text-purple-300 underline hover:text-purple-200">Admin Vault</Link>.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-700/40 bg-gradient-to-br from-amber-950/30 to-stone-900/50 p-5 md:p-6">
            <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider mb-2">Just for you, {firstName}</p>
            <p className="text-stone-200 leading-relaxed">
              You’ve got one ability nobody else has: <strong className="text-emerald-300">your Personal items are yours alone.</strong> Use it for whatever you want — journal, private wifi list, plans you’re not ready to share. Real lock, not theater.
            </p>
          </div>
        )}

        <div className="pt-6 text-center text-xs text-stone-500 italic">
          Built with care for the families who need it.
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-800 bg-stone-900/50 p-5 md:p-6">
      <h2 className="flex items-center gap-3 text-lg md:text-xl font-bold text-stone-100 mb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 border border-accent-400 text-stone-950 text-sm font-bold shrink-0">
          {n}
        </span>
        {title}
      </h2>
      <div className="text-sm md:text-base text-stone-300 leading-relaxed pl-11">
        {children}
      </div>
    </section>
  )
}
