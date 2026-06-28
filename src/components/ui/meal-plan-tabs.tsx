// Top-of-screen segmented nav linking the four meal-planning screens —
// Recipes (browse), This week (the builder), Grocery (active shopping
// list), and Quick-pick (staples grid). Lance flagged that bouncing
// between these four felt disconnected; a persistent nav at the top of
// each one stitches the area together.
//
// Mobile-only on the busier pages (/meal-plan, /meal-plan/grocery)
// because their existing desktop headers already cross-link. On the
// recipes page the nav shows at every breakpoint, since /recipes has
// no other reference back to the planner.
//
// Server-rendered <Link>s, not buttons + JS — works without hydration on
// the page that's being initially served, and a tap navigates fully.

import Link from 'next/link'
import { clsx } from 'clsx'

// Inline style for the "active" pill. Uses the per-theme accent CSS
// variables directly so the color renders regardless of which Tailwind
// utility chunks happen to be cached by the user's PWA — Lance was
// seeing cached CSS without the latest bg-emerald-*/shadow-emerald-*
// rules, and the active pill was rendering unstyled. Inline styles are
// part of the HTML payload, no CSS lookup required.
const activePillStyle: React.CSSProperties = {
  backgroundColor: 'rgb(var(--accent-500))',
  color: 'white',
  boxShadow:
    '0 0 0 2px rgb(var(--accent-300) / 0.65), 0 4px 14px rgb(var(--accent-400) / 0.45)',
}

export type MealPlanTab = 'recipes' | 'plan' | 'grocery' | 'quick'

const TABS: { id: MealPlanTab; label: string; href: string }[] = [
  { id: 'recipes', label: 'Recipes', href: '/recipes' },
  { id: 'plan', label: 'This week', href: '/meal-plan' },
  { id: 'grocery', label: 'Grocery', href: '/meal-plan/grocery' },
  { id: 'quick', label: 'Quick-pick', href: '/meal-plan/quick-pick' },
]

interface Props {
  /** Which tab to mark active. */
  active: MealPlanTab
  /** Pass true to render on every breakpoint (recipes page). Defaults to
   *  mobile-only since /meal-plan and /meal-plan/grocery have their own
   *  busy desktop headers already. */
  alwaysShow?: boolean
}

export function MealPlanTabs({ active, alwaysShow = false }: Props) {
  return (
    <nav
      aria-label="Recipes & meal plan sections"
      className={clsx(
        // Horizontal scroll on narrow viewports so four pills don't wrap
        // into two lines on a phone. inline-flex keeps the pill row sized
        // to its content; overflow-x-auto enables the scroll when needed.
        'flex items-center gap-1 p-0.5 mb-5 rounded-full bg-stone-900/60 border border-stone-700/40 overflow-x-auto',
        alwaysShow ? '' : 'md:hidden',
      )}
    >
      {TABS.map((t) => (
        <Tab key={t.id} href={t.href} label={t.label} isActive={t.id === active} />
      ))}
    </nav>
  )
}

function Tab({ href, label, isActive }: { href: string; label: string; isActive: boolean }) {
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={clsx(
        'shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition',
        !isActive && 'text-stone-400 hover:text-stone-100',
      )}
      style={isActive ? activePillStyle : undefined}
    >
      {label}
    </Link>
  )
}
