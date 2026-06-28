'use client'

// Dashboard birthday card. Shown when today's MM-DD matches either the
// signed-in user's DOB (your-birthday flavor) or someone else's in the
// family (family-birthday flavor). Two visual treatments because the user
// experiencing the day deserves the louder celebration.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Cake, PartyPopper } from 'lucide-react'

interface BirthdayMember {
  id: string
  firstName: string
  // Year-of-birth so we can show "You're 19 today, Sydney."
  yearOfBirth: number | null
}

interface Props {
  /** True if today is the signed-in user's birthday. */
  isYourBirthday: boolean
  /** Other family members whose birthday is today. */
  others: BirthdayMember[]
  /** First name of the signed-in user, for personalization. */
  yourFirstName: string
  /** Year-of-birth of the signed-in user (for the age, when isYourBirthday). */
  yourYearOfBirth: number | null
}

const CONFETTI_PIECES = 32

export function BirthdayBanner({ isYourBirthday, others, yourFirstName, yourYearOfBirth }: Props) {
  // Confetti runs once per dashboard mount on the user's own birthday. We
  // generate the seed positions on the client only so there's no SSR-vs-CSR
  // mismatch.
  const [confetti, setConfetti] = useState<{ x: number; delay: number; rot: number; color: string }[] | null>(null)
  useEffect(() => {
    if (!isYourBirthday) return
    const colors = ['#fb7185', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#f472b6']
    const timer = window.setTimeout(() => {
      setConfetti(
        Array.from({ length: CONFETTI_PIECES }, () => ({
          x: Math.random() * 100,
          delay: Math.random() * 0.8,
          rot: Math.random() * 360,
          color: colors[Math.floor(Math.random() * colors.length)],
        }))
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [isYourBirthday])

  const yourAge = useMemo(() => {
    if (!isYourBirthday || !yourYearOfBirth) return null
    return new Date().getFullYear() - yourYearOfBirth
  }, [isYourBirthday, yourYearOfBirth])

  if (!isYourBirthday && others.length === 0) return null

  if (isYourBirthday) {
    return (
      <div className="relative mb-6 rounded-2xl border border-pink-700/40 bg-gradient-to-br from-pink-950/40 via-amber-950/30 to-stone-900/60 p-5 md:p-6 overflow-hidden">
        {confetti && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="absolute top-0 block w-1.5 h-3"
                style={{
                  left: `${c.x}%`,
                  backgroundColor: c.color,
                  transform: `rotate(${c.rot}deg)`,
                  animation: `confetti-fall 5s linear ${c.delay}s 1`,
                }}
              />
            ))}
          </div>
        )}
        <div className="relative flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-900/40 border border-pink-700/60 shrink-0">
            <Cake size={22} className="text-pink-300" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-pink-300/80 font-semibold">
              Today
            </p>
            <h2 className="text-2xl md:text-3xl font-bold text-stone-50 mt-0.5">
              Happy birthday, {yourFirstName}.
            </h2>
            {yourAge !== null && (
              <p className="text-sm text-stone-400 mt-1">
                {yourAge} years on the planet. Hope it&rsquo;s a good one.
              </p>
            )}
            {others.length > 0 && (
              <p className="mt-3 text-sm text-stone-300">
                Also celebrating today: {others.map((o) => o.firstName).join(', ')}.
              </p>
            )}
          </div>
        </div>
        <style>{`
          @keyframes confetti-fall {
            0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
            100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
          }
        `}</style>
      </div>
    )
  }

  // Other-people-only flavor: smaller, friendly, with a nudge to send a message.
  const list = others.map((o) => o.firstName).join(', ')
  return (
    <div className="mb-6 rounded-2xl border border-amber-700/40 bg-gradient-to-br from-amber-950/30 via-stone-900/40 to-stone-900/60 p-4 md:p-5 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-900/40 border border-amber-700/50 shrink-0">
        <PartyPopper size={18} className="text-amber-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-400/80 font-semibold">Today is a birthday</p>
        <p className="text-sm md:text-base text-stone-100 mt-0.5">
          {others.length === 1
            ? `${list} is celebrating today.`
            : `${list} are all celebrating today.`}
          {' '}
          <Link href="/messages" className="text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline">
            Say something nice →
          </Link>
        </p>
      </div>
    </div>
  )
}
