'use client'

import { useEffect, useState } from 'react'

interface Props {
  firstName: string
}

// Time-of-day greeting computed from the viewer's local clock. Renders a stable
// fallback during SSR/initial paint so there's no hydration mismatch and no
// layout flash.
export function GuideWelcome({ firstName }: Props) {
  const [greeting, setGreeting] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const h = new Date().getHours()
      let g: string
      if (h < 5) g = `Hope you're having a peaceful late night, ${firstName}.`
      else if (h < 12) g = `Hope you're having a wonderful morning, ${firstName}.`
      else if (h < 17) g = `Hope your afternoon is going well, ${firstName}.`
      else if (h < 21) g = `Hope you're having a lovely evening, ${firstName}.`
      else g = `Hope you're having a quiet night, ${firstName}.`
      setGreeting(g)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [firstName])

  return (
    <p className="text-emerald-300/90 text-base md:text-lg italic leading-relaxed">
      {greeting ?? `Welcome, ${firstName}.`}
    </p>
  )
}
