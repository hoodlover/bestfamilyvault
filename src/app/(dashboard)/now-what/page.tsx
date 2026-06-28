import { DeadNowWhatGuidePage } from '@/components/ui/dead-now-what-guide-page'
import { GUIDE_PROFILES } from '@/lib/dead-now-what-config'

export default async function DeadNowWhatPage() {
  // Default route always renders the primary guide (LEGACY_GUIDES[0] in
  // family-config). Sibling guides live at /now-what/<key>.
  return <DeadNowWhatGuidePage profile={GUIDE_PROFILES[0]} />
}
