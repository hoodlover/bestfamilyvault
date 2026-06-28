import { clsx } from 'clsx'

interface Props {
  /** Append extra Tailwind classes to the wrapper. Set the base font size here. */
  className?: string
  /** Render `.com` after the brand name. Default true. */
  withTld?: boolean
}

/**
 * Lance's brand styled per spec:
 *   AI       — bold, red, ~4pt larger than the rest
 *   liencode.com — white, normal weight, baseline size
 *
 * Set the baseline size on the wrapper via className (e.g. `text-sm`, `text-base`).
 * The `AI` portion scales relative to that with em units so the size delta stays
 * consistent across contexts.
 */
export function AilienBrand({ className = '', withTld = true }: Props) {
  return (
    <span className={clsx('inline-flex items-baseline whitespace-nowrap leading-none', className)}>
      <span className="font-extrabold text-red-500 text-[1.35em] tracking-tight">AI</span>
      <span className="text-white">liencode{withTld && '.com'}</span>
    </span>
  )
}
