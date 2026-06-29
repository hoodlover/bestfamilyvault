'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileKey,
  Home,
  Import,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'

type StepId = 'intro' | 'goals' | 'household' | 'details' | 'import' | 'finish'
type ThemeKey = 'gold' | 'emerald' | 'sky' | 'rose' | 'violet' | 'teal'

type OnboardingState = {
  goals: string[]
  vaultName: string
  ownerName: string
  email: string
  familyMembers: string
  address: string
  phone: string
  passwordManager: string
  importHelp: string[]
  firstFocus: string
}

const steps: Array<{ id: StepId; label: string; theme: ThemeKey }> = [
  { id: 'intro', label: 'Intro', theme: 'gold' },
  { id: 'goals', label: 'Goals', theme: 'emerald' },
  { id: 'household', label: 'People', theme: 'sky' },
  { id: 'details', label: 'Details', theme: 'rose' },
  { id: 'import', label: 'Import', theme: 'violet' },
  { id: 'finish', label: 'Prepare', theme: 'teal' },
]

const themes: Record<ThemeKey, {
  accent: string
  badge: string
  glow: string
  icon: string
  panel: string
  progress: string
  selected: string
  selectedIcon: string
  subtle: string
}> = {
  gold: {
    accent: 'text-amber-200',
    badge: 'border-amber-300/30 bg-amber-500/10 text-amber-100',
    glow: 'shadow-amber-950/30',
    icon: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    panel: 'border-amber-400/25 bg-amber-500/10',
    progress: 'bg-amber-400',
    selected: 'border-amber-400/70 bg-amber-400/10 text-amber-100',
    selectedIcon: 'text-amber-200',
    subtle: 'text-amber-100',
  },
  emerald: {
    accent: 'text-emerald-200',
    badge: 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100',
    glow: 'shadow-emerald-950/30',
    icon: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    panel: 'border-emerald-400/25 bg-emerald-500/10',
    progress: 'bg-emerald-500',
    selected: 'border-emerald-500/70 bg-emerald-500/10 text-emerald-100',
    selectedIcon: 'text-emerald-300',
    subtle: 'text-emerald-100',
  },
  sky: {
    accent: 'text-sky-200',
    badge: 'border-sky-300/30 bg-sky-500/10 text-sky-100',
    glow: 'shadow-sky-950/30',
    icon: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
    panel: 'border-sky-400/25 bg-sky-500/10',
    progress: 'bg-sky-400',
    selected: 'border-sky-400/70 bg-sky-400/10 text-sky-100',
    selectedIcon: 'text-sky-200',
    subtle: 'text-sky-100',
  },
  rose: {
    accent: 'text-rose-200',
    badge: 'border-rose-300/30 bg-rose-500/10 text-rose-100',
    glow: 'shadow-rose-950/30',
    icon: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    panel: 'border-rose-400/25 bg-rose-500/10',
    progress: 'bg-rose-400',
    selected: 'border-rose-400/70 bg-rose-400/10 text-rose-100',
    selectedIcon: 'text-rose-200',
    subtle: 'text-rose-100',
  },
  violet: {
    accent: 'text-violet-200',
    badge: 'border-violet-300/30 bg-violet-500/10 text-violet-100',
    glow: 'shadow-violet-950/30',
    icon: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
    panel: 'border-violet-400/25 bg-violet-500/10',
    progress: 'bg-violet-400',
    selected: 'border-violet-400/70 bg-violet-400/10 text-violet-100',
    selectedIcon: 'text-violet-200',
    subtle: 'text-violet-100',
  },
  teal: {
    accent: 'text-teal-200',
    badge: 'border-teal-300/30 bg-teal-500/10 text-teal-100',
    glow: 'shadow-teal-950/30',
    icon: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
    panel: 'border-teal-400/25 bg-teal-500/10',
    progress: 'bg-teal-400',
    selected: 'border-teal-400/70 bg-teal-400/10 text-teal-100',
    selectedIcon: 'text-teal-200',
    subtle: 'text-teal-100',
  },
}

const goalOptions = [
  'Passwords and logins',
  'Family documents',
  'Bills and recurring payments',
  'Emergency instructions',
  'Photos, receipts, and IDs',
  'Recipes and household notes',
]

const importOptions = [
  'Sticky Password',
  '1Password',
  'Bitwarden',
  'LastPass',
  'Apple Passwords',
  'Google Password Manager',
  'Chrome CSV',
  'Other / not sure',
]

const helpOptions = [
  'Import passwords',
  'Organize family categories',
  'Add important documents',
  'Set up emergency access',
  'Invite family members',
  'Install phone/browser tools',
]

const initialState: OnboardingState = {
  goals: ['Passwords and logins', 'Family documents'],
  vaultName: '',
  ownerName: '',
  email: '',
  familyMembers: '',
  address: '',
  phone: '',
  passwordManager: 'Other / not sure',
  importHelp: ['Import passwords', 'Organize family categories'],
  firstFocus: 'Passwords and logins',
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function OnboardingWizard() {
  const [stepIndex, setStepIndex] = useState(0)
  const [state, setState] = useState<OnboardingState>(initialState)
  const [preparing, setPreparing] = useState(false)

  const current = steps[stepIndex]
  const theme = themes[current.theme]
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100)

  const summary = useMemo(() => {
    const vaultName = state.vaultName.trim() || 'Best Family Vault'
    const memberCount = state.familyMembers
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean).length
    return { vaultName, memberCount }
  }, [state.familyMembers, state.vaultName])

  function update<K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  function next() {
    if (stepIndex < steps.length - 1) setStepIndex((index) => index + 1)
  }

  function back() {
    if (stepIndex > 0) setStepIndex((index) => index - 1)
  }

  function prepareVault() {
    setPreparing(true)
    try {
      window.localStorage.setItem('bestfamilyvault.onboarding', JSON.stringify(state))
      window.localStorage.setItem('bestfamilyvault.pendingVaultName', summary.vaultName)
      window.localStorage.setItem('bestfamilyvault.importSource', state.passwordManager)
    } catch {
      // localStorage is helpful, not required.
    }
    window.setTimeout(() => {
      window.location.assign('/login?onboarding=complete')
    }, 1800)
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <section className="grid min-h-screen lg:grid-cols-[0.95fr_1.05fr]">
        <aside className="relative hidden overflow-hidden bg-stone-900 lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mainscene.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-75"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-stone-950/75 via-stone-950/35 to-emerald-950/75" />
          <div className="relative flex h-full flex-col justify-between p-10">
            <Link href="/login" className="inline-flex w-fit items-center gap-2 text-sm text-stone-300 hover:text-white">
              <ArrowLeft size={16} />
              Sign in instead
            </Link>
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-950/45 px-3 py-1 text-xs font-medium text-emerald-100">
                <ShieldCheck size={14} />
                Private family setup
              </div>
              <h1 className="max-w-xl text-5xl font-semibold leading-tight tracking-normal">
                Create Your Best Family Vault
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-stone-200">
                We will shape the vault around your household, imports, documents, and emergency planning before you create the first account.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs text-stone-200">
              <MiniStat icon={<LockKeyhole size={16} />} label="Passwords" tone="text-amber-200" />
              <MiniStat icon={<FileKey size={16} />} label="Documents" tone="text-sky-200" />
              <MiniStat icon={<Users size={16} />} label="Family" tone="text-rose-200" />
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
          <div className="w-full max-w-3xl">
            <div className="mb-6 flex items-center justify-between gap-4 lg:hidden">
              <Link href="/login" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-stone-100">
                <ArrowLeft size={16} />
                Sign in
              </Link>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vaultlogo.png" alt="" className="h-10 w-10 rounded-lg object-contain" />
            </div>

            <div className="mb-5">
              <div className="mb-3 flex items-center justify-between text-xs text-stone-500">
                <span>{current.label}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
                <div className={`h-full rounded-full transition-all ${theme.progress}`} style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className={`rounded-2xl border bg-stone-900/75 p-5 shadow-2xl sm:p-7 ${theme.panel} ${theme.glow}`}>
              {current.id === 'intro' && (
                <StepShell
                  icon={<Sparkles size={22} />}
                  title="Create Your Best Family Vault"
                  copy="Start with the essentials. You can change all of this later."
                  theme={theme}
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <IntroTile icon={<LockKeyhole size={18} />} title="Passwords" copy="Bring in your logins and organize them by person." tone="amber" />
                    <IntroTile icon={<Home size={18} />} title="Household" copy="Name the people and places this vault protects." tone="sky" />
                    <IntroTile icon={<Import size={18} />} title="Imports" copy="Tell us what you use today so the next step is clear." tone="violet" />
                  </div>
                </StepShell>
              )}

              {current.id === 'goals' && (
                <StepShell
                  icon={<ShieldCheck size={22} />}
                  title="What do you want this vault to handle first?"
                  copy="Pick the areas that matter right away."
                  theme={theme}
                >
                  <ChoiceGrid
                    options={goalOptions}
                    selected={state.goals}
                    onToggle={(value) => update('goals', toggleValue(state.goals, value))}
                    theme={theme}
                  />
                </StepShell>
              )}

              {current.id === 'household' && (
                <StepShell
                  icon={<Users size={22} />}
                  title="Who is this vault for?"
                  copy="A simple roster helps shape starter categories and invite reminders."
                  theme={theme}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Vault name" value={state.vaultName} onChange={(value) => update('vaultName', value)} placeholder="The Johnson Family Vault" />
                    <Field label="Your name" value={state.ownerName} onChange={(value) => update('ownerName', value)} placeholder="Alex Johnson" />
                    <Field label="Email" type="email" value={state.email} onChange={(value) => update('email', value)} placeholder="alex@example.com" />
                    <Field label="First focus" value={state.firstFocus} onChange={(value) => update('firstFocus', value)} placeholder="Passwords, documents, emergency plan..." />
                  </div>
                  <TextArea
                    label="Family members or trusted people"
                    value={state.familyMembers}
                    onChange={(value) => update('familyMembers', value)}
                    placeholder={'Jordan - spouse\nMia - daughter\nSam - trusted contact'}
                  />
                </StepShell>
              )}

              {current.id === 'details' && (
                <StepShell
                  icon={<Home size={22} />}
                  title="Add the household basics"
                  copy="This becomes a starting point for emergency sheets, contacts, and identity records."
                  theme={theme}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Home address" value={state.address} onChange={(value) => update('address', value)} placeholder="Street, city, state" />
                    <Field label="Best phone number" value={state.phone} onChange={(value) => update('phone', value)} placeholder="(555) 123-4567" />
                  </div>
                  <p className="rounded-xl border border-stone-800 bg-stone-950/60 px-4 py-3 text-sm leading-6 text-stone-400">
                    Keep this light for now. The vault can later store IDs, insurance, vehicle records, subscriptions, and where-to-find-it notes.
                  </p>
                </StepShell>
              )}

              {current.id === 'import' && (
                <StepShell
                  icon={<Import size={22} />}
                  title="What are you moving from?"
                  copy="This helps the vault point you toward the right importer."
                  theme={theme}
                >
                  <div>
                    <label className="mb-2 block text-sm font-medium text-stone-300">Current password program</label>
                    <select
                      value={state.passwordManager}
                      onChange={(event) => update('passwordManager', event.target.value)}
                      className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2.5 text-stone-100 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
                    >
                      {importOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <ChoiceGrid
                    options={helpOptions}
                    selected={state.importHelp}
                    onToggle={(value) => update('importHelp', toggleValue(state.importHelp, value))}
                    theme={theme}
                  />
                </StepShell>
              )}

              {current.id === 'finish' && (
                <StepShell
                  icon={<Check size={22} />}
                  title={preparing ? 'Preparing your vault...' : 'Ready to prepare your vault'}
                  copy={preparing ? 'Building your starter plan and returning you to sign in.' : 'Review the starting shape. Your answers are saved on this device for the next setup steps.'}
                  theme={theme}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SummaryItem label="Vault" value={summary.vaultName} />
                    <SummaryItem label="People listed" value={summary.memberCount ? String(summary.memberCount) : 'Add later'} />
                    <SummaryItem label="First focus" value={state.firstFocus || 'Passwords and documents'} />
                    <SummaryItem label="Import source" value={state.passwordManager} />
                  </div>
                  {preparing && (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-800">
                      <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-500" />
                    </div>
                  )}
                </StepShell>
              )}

              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={back}
                  disabled={stepIndex === 0 || preparing}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-700 px-3 py-2 text-sm font-medium text-stone-300 transition hover:border-stone-500 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
                {current.id === 'finish' ? (
                  <button
                    type="button"
                    onClick={prepareVault}
                    disabled={preparing}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-70"
                  >
                    {preparing ? 'Preparing...' : 'Prepare my vault'}
                    <Sparkles size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                  >
                    Continue
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function MiniStat({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <div className={`mb-2 ${tone}`}>{icon}</div>
      <div className="font-medium">{label}</div>
    </div>
  )
}

function StepShell({
  icon,
  title,
  copy,
  children,
  theme,
}: {
  icon: React.ReactNode
  title: string
  copy: string
  children: React.ReactNode
  theme: (typeof themes)[ThemeKey]
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${theme.icon}`}>
          {icon}
        </div>
        <div>
          <h2 className={`text-2xl font-semibold tracking-normal ${theme.accent}`}>{title}</h2>
          <p className="mt-1 text-sm leading-6 text-stone-400">{copy}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

const introToneClasses = {
  amber: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
  sky: 'border-sky-400/25 bg-sky-500/10 text-sky-200',
  violet: 'border-violet-400/25 bg-violet-500/10 text-violet-200',
}

function IntroTile({ icon, title, copy, tone }: { icon: React.ReactNode; title: string; copy: string; tone: keyof typeof introToneClasses }) {
  return (
    <div className={`rounded-xl border bg-stone-950/60 p-4 ${introToneClasses[tone]}`}>
      <div className="mb-3">{icon}</div>
      <h3 className="text-sm font-semibold text-stone-100">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">{copy}</p>
    </div>
  )
}

function ChoiceGrid({
  options,
  selected,
  onToggle,
  theme,
}: {
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  theme: (typeof themes)[ThemeKey]
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const active = selected.includes(option)
        return (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            aria-pressed={active}
            className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
              active
                ? theme.selected
                : 'border-stone-800 bg-stone-950/50 text-stone-300 hover:border-stone-600'
            }`}
          >
            <span>{option}</span>
            {active && <Check size={16} className={`shrink-0 ${theme.selectedIcon}`} />}
          </button>
        )
      })}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-stone-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2.5 text-stone-100 placeholder-stone-600 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
      />
    </label>
  )
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-stone-300">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={5}
        className="w-full resize-none rounded-lg border border-stone-700 bg-stone-950 px-3 py-2.5 text-stone-100 placeholder-stone-600 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
      />
    </label>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-950/60 p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-stone-100">{value}</div>
    </div>
  )
}
