/**
 * One-time superuser bootstrap page.
 * Only works when NO superuser exists in the database.
 * Visit /setup after db:push + db:seed to create the first account.
 */
export const dynamic = 'force-dynamic'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { SetupForm } from '@/components/ui/setup-form'

export default async function SetupPage() {
  // Lock the page if any superuser already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'superuser'))
    .then((r) => r[0])

  if (existing) redirect('/login')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-stone-900 via-stone-800 to-emerald-950">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600/10 border border-emerald-600/20 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/vaultlogo.png" width={36} height={36} alt="" className="object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-stone-100 tracking-tight">Vault Setup</h1>
          <p className="text-stone-400 text-sm mt-1">Create the first superuser account.</p>
          <p className="text-emerald-700 text-xs mt-2">This page disappears once a superuser exists.</p>
        </div>
        <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-8 shadow-2xl">
          <SetupForm />
        </div>
      </div>
    </div>
  )
}
