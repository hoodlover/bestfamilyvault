import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import { NewPhotoForm } from '@/components/ui/new-photo-form'
import { LockEgg } from '@/components/ui/lock-egg'
import { HelpPopout } from '@/components/ui/help-popout'

// Quick "+ Photo" capture flow. Reachable from the AddMenuSheet on the
// bottom nav. Opens the camera immediately, lets the user title the
// snapshot, optionally pick a category/subcategory, and saves it as a
// note with the image attached. Designed for fast field capture.

export default async function NewPhotoPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const [allCategories, allSubcategories] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    db.select().from(subcategories).orderBy(asc(subcategories.sortOrder)),
  ])

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      <h1 className="flex items-center gap-3 text-2xl font-bold text-stone-100 mb-2">
        <LockEgg src="/icons/cobb/icons/system/photo_pic.png" />
        Quick Photo
        <HelpPopout
          title="Quick photo"
          sections={[
            {
              heading: 'Snap',
              tips: [
                { title: 'Back camera by default', description: 'Most uses are documents / receipts / labels — front camera flips via the swap button.' },
                { title: 'Photo compression', description: 'A 12MB iPhone shot lands as a sub-MB JPEG. Stays sharp at viewing size.' },
                { title: 'EXIF dates preserved', description: 'Photo filename includes the date the shutter actually fired, not when you uploaded it.' },
              ],
            },
            {
              heading: 'Categorize + save',
              tips: [
                { title: 'Title + category', description: 'Required. Subcategory optional. Pre-filled if you came in from a category page.' },
                { title: 'Auto-named file', description: 'Filename becomes "<title>-YYYY-MM-DD.jpg" so attachments lists stay readable.' },
                { title: 'OCR after save', description: 'On the entry detail, the Sparkles button asks Claude about the photo — receipts, labels, handwritten notes, all fair game.' },
              ],
            },
          ]}
        />
      </h1>
      <p className="text-sm text-stone-400 mb-6">
        Snap something worth remembering — receipt, label, serial number, recipe card. Title it,
        drop it in a category, save. Stored as a note with the photo attached.
      </p>

      <NewPhotoForm
        categories={allCategories}
        subcategories={allSubcategories}
        isSuperuser={session.user.role === 'superuser'}
      />
    </div>
  )
}
