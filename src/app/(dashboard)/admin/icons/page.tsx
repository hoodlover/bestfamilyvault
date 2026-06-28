import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getAllVaultIcons } from '@/lib/all-icons'
import { IconBrowser } from '@/components/ui/icon-browser'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function IconsBrowserPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  // Admin-only — this is a maintenance tool, not user-facing.
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    redirect('/dashboard')
  }

  const icons = await getAllVaultIcons()

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-32">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link href="/admin" className="hover:text-stone-300 transition">Admin</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Icons</span>
      </nav>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold text-stone-100">Icon Browser</h1>
        <HelpPopout
          title="Icon Browser"
          sections={[
            {
              heading: 'What this shows',
              tips: [
                { title: 'Every icon under /public/icons', description: 'Scanned at server start, grouped by folder. New icons appear after a redeploy / restart.' },
                { title: 'Backed-up icons are hidden', description: 'Anything moved to /bestfamilyvault-backup is out of scope. Copy back into /public/icons to make it browsable.' },
              ],
            },
            {
              heading: 'Use it',
              tips: [
                { title: 'Filter', description: 'Search by name, folder name, or anywhere in the path.' },
                { title: 'Tap to copy path', description: 'Click any thumbnail → its /icons/... path lands on your clipboard, ready to paste into code or the icon-picker.' },
                { title: 'File size on hover', description: 'Title attribute shows file size — handy for spotting oversized source images.' },
              ],
            },
          ]}
        />
      </div>
      <p className="text-sm text-stone-400 mb-6">
        Every image in the vault&rsquo;s icon library. Use this to find that one icon you swore you saved.
      </p>

      <IconBrowser icons={icons} />
    </div>
  )
}
