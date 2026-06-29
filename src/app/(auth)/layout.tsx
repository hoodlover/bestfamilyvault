import { APP_NAME } from '@/lib/branding'
import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-gradient-to-br from-stone-900 via-stone-800 to-emerald-950 px-4 py-8 sm:py-0">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bestfamvault.png"
              alt={APP_NAME}
              width={1728}
              height={922}
              className="block h-auto w-full max-w-md mx-auto object-contain"
            />
          </div>
          {/* APP_NAME stays in the alt text so screen readers get the brand. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mainscene.png"
            alt=""
            width={1792}
            height={1024}
            className="block h-auto w-full max-w-md object-cover rounded-xl"
          />
        </div>
        {children}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-stone-500">
          <Link href="/about" className="hover:text-stone-300">About</Link>
          <Link href="/privacy" className="hover:text-stone-300">Privacy</Link>
          <Link href="/terms" className="hover:text-stone-300">Terms</Link>
          <Link href="/support" className="hover:text-stone-300">Support</Link>
        </div>
      </div>
    </div>
  )
}
