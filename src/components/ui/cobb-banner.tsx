'use client'

import Link from 'next/link'
import { AilienBrand } from './ailien-brand'

export function CobbBanner({ compact = false }: { compact?: boolean }) {
  const frameCls = compact
    ? 'inline-block max-w-full overflow-hidden rounded-2xl md:rounded-[1.75rem]'
    : 'inline-block max-w-full overflow-hidden rounded-2xl md:rounded-[2rem]'
  const imageCls = compact
    ? 'block h-auto max-h-32 max-w-full object-contain opacity-95'
    : 'block h-auto max-h-44 max-w-full object-contain opacity-95'

  return (
    <div className={compact ? 'mb-5 flex justify-center' : 'mb-6 flex justify-center md:mb-8'}>
      <span className={frameCls}>
        <img
          src="/icons/cobb/bigbanner.png"
          width={1200}
          height={260}
          alt=""
          className={imageCls}
        />
      </span>
    </div>
  )
}

interface AilencodeCreditProps {
  size?: 'sm' | 'lg'
}

export function AilencodeCredit({ size = 'sm' }: AilencodeCreditProps = {}) {
  const px = size === 'lg' ? 110 : 55
  const textCls = size === 'lg' ? 'text-base' : 'text-xs'
  return (
    <Link
      href="https://ailiencode.com"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-stone-900"
      title="Created with AIliencode.com"
    >
      <img src="/icons/cobb/ailencode-logo.png" width={px} height={px} alt="" className="object-contain rounded" />
      <AilienBrand className={textCls} />
    </Link>
  )
}
