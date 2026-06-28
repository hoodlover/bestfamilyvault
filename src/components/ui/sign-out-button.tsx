'use client'

import { signOut } from 'next-auth/react'

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-stone-800 hover:bg-red-900/30 border border-stone-700 hover:border-red-800/50 text-stone-400 hover:text-red-400 font-medium rounded-xl transition"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/cobb/icons/system/sign_out.png" width={28} height={28} alt="" className="h-7 w-7 object-contain" />
      Sign out
    </button>
  )
}
