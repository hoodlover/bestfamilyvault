import { notFound } from 'next/navigation'
import { GUIDE_PROFILES } from '@/lib/dead-now-what-config'
import { DeadNowWhatGuidePage } from '@/components/ui/dead-now-what-guide-page'

// Sibling guides (anyone who isn't the primary in LEGACY_GUIDES) live at
// /now-what/<key>. The primary owner's guide stays at the top-level
// /now-what route. Slug param matches the LEGACY_GUIDES[].key field.

export default async function SiblingGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const profile = GUIDE_PROFILES.find((g) => g.key === slug)
  // Don't render the primary guide here — it lives at /now-what; if someone
  // hits /now-what/<primary-key>, 404 to keep one canonical URL per guide.
  if (!profile || profile.key === GUIDE_PROFILES[0]?.key) notFound()
  return <DeadNowWhatGuidePage profile={profile} />
}
