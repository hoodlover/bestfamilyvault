'use client'

// Shared "what do you want to add?" grid — the 12 add affordances that
// the mobile bottom-nav's +Add sheet and the desktop sidebar's "Add
// entry" overlay both render. Lives in its own component so the two
// presenters (mobile bottom-sheet, desktop centered modal) can share
// the option list — adding a new affordance is a one-place edit.

import Link from 'next/link'

interface AddMenuGridProps {
  /** Called whenever any option is tapped — used by the parent to dismiss
   *  the surrounding sheet/modal. The Link navigates; the close is the
   *  visual cleanup. */
  onSelect?: () => void
}

export function AddMenuGrid({ onSelect }: AddMenuGridProps) {
  return (
    // 3-col grid. Most rows fill cleanly; the Asset tile pushes the
    // count to 13, which wraps to a final row holding one tile —
    // intentional, keeps the sheet short on small phones.
    //
    // Icon convention: tiles here use the dedicated add_*.png variants
    // (badge with a + corner) so the popup reads as "I'm adding
    // something" at a glance. Display surfaces (sidebar nav, page
    // headers, emergency sheet, list rows, etc.) keep their plain-icon
    // partners — only this grid uses the +badge variants.
    <div className="grid grid-cols-3 gap-2">
      <AddOption href="/entries/new?type=login" img="/icons/cobb/icons/system/add_password.png" label="Password" onSelect={onSelect} />
      {/* App login — same shape as a web login but tagged so /apps lists
          it on its own. Sits next to Password since users reach for both
          via the same "I need to save a credential" mental loop. */}
      <AddOption href="/entries/new?type=app_login" img="/icons/cobb/icons/system/addapp.png" label="App" onSelect={onSelect} />
      <AddOption href="/notes/new" img="/icons/cobb/icons/system/addnote.png" label="Note" onSelect={onSelect} />
      <AddOption href="/entries/new?type=upload" img="/icons/cobb/icons/system/add_upload.png" label="Upload" onSelect={onSelect} />
      <AddOption href="/photo/new" img="/icons/cobb/icons/system/add_photo.png" label="Photo" onSelect={onSelect} />
      <AddOption href="/entries/new?type=login&isRecurring=true" img="/icons/cobb/icons/system/addrecurring.png" label="Recurring" onSelect={onSelect} />
      <AddOption href="/recipes/new" img="/icons/cobb/icons/system/add_recipe.png" label="Recipe" onSelect={onSelect} />
      <AddOption href="/capsules" img="/icons/cobb/icons/system/add_time_cap.png" label="Time Capsule" onSelect={onSelect} />
      <AddOption href="/entries/new" img="/icons/cobb/icons/system/plus_entry.png" label="New Entry" onSelect={onSelect} />
      <AddOption href="/receipts/new" img="/icons/cobb/icons/system/upload_receipt_icon_512.png" label="Receipt" onSelect={onSelect} />
      <AddOption href="/entries/new?type=credit_card" img="/icons/cobb/icons/system/creditcardadd.png" label="Credit Card" onSelect={onSelect} />
      <AddOption href="/entries/new?type=bank_account" img="/icons/cobb/icons/system/bankadd.png" label="Bank Account" onSelect={onSelect} />
      <AddOption href="/entries/new?type=identity" img="/icons/cobb/icons/system/idadd.png" label="ID Card" onSelect={onSelect} />
      <AddOption href="/entries/new?type=asset" img="/icons/cobb/icons/system/assettadd.png" label="Asset" onSelect={onSelect} />
      {/* Where Is It → lands on the /locate browse (same pattern as
          Time Capsule). The header's + Add there pre-fills the
          category, so users don't have to remember a UUID. */}
      <AddOption href="/locate" img="/icons/cobb/icons/system/whereadd.png" label="Where Is It?" onSelect={onSelect} />
    </div>
  )
}

function AddOption({
  href,
  img,
  label,
  onSelect,
}: {
  href: string
  img: string
  label: string
  onSelect?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-1 py-1.5 transition active:scale-95"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        width={44}
        height={44}
        alt=""
        className="block h-[44px] w-[44px] object-contain"
      />
      <span className="text-[10px] font-medium text-stone-200 leading-tight text-center">{label}</span>
    </Link>
  )
}
