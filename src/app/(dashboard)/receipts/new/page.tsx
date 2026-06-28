import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { NewReceiptForm } from '@/components/ui/new-receipt-form'
import { LockEgg } from '@/components/ui/lock-egg'
import { HelpPopout } from '@/components/ui/help-popout'
import { ensureCobbFamilyReceiptsSub } from '@/lib/actions/family-setup'

interface PrefillParams {
  prefillAmount?: string  // dollars, e.g. "54.59"
  prefillDate?: string    // YYYY-MM-DD
  prefillMerchant?: string
  attachDecisionTo?: string  // statement_line_item id to flip to matched on save
}

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<PrefillParams>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const params = await searchParams
  // Sanitize — date must match YYYY-MM-DD, amount must parse to a
  // sensible cents range, merchant gets a sane length cap. No
  // injection vector but we keep the contract tight.
  const prefillAmountDollars =
    params.prefillAmount && /^\d{1,7}(\.\d{1,2})?$/.test(params.prefillAmount)
      ? params.prefillAmount
      : null
  const prefillDate =
    params.prefillDate && /^\d{4}-\d{2}-\d{2}$/.test(params.prefillDate)
      ? params.prefillDate
      : null
  const prefillMerchant = params.prefillMerchant?.slice(0, 120) || null
  const attachDecisionTo = params.attachDecisionTo?.slice(0, 100) || null

  // Idempotently make sure the "Cobb Family" Receipts subcategory exists
  // before we load the dropdown options. Lance reported it was missing
  // from the classifier — the seed script never ran in prod. This call
  // returns instantly if the sub is already there, so the only cost on
  // every load is one extra SELECT.
  await ensureCobbFamilyReceiptsSub()

  const [allCategories, allSubs] = await Promise.all([
    db.select().from(categories).orderBy(categories.sortOrder),
    db.select().from(subcategories).orderBy(subcategories.sortOrder),
  ])

  // Default landing: Documents → Receipts (the seeded sub) when present,
  // otherwise leave selection to the user. The category suggester runs
  // after OCR and overrides this when it's confident.
  const documents = allCategories.find((c) => c.slug === 'documents')
  const receiptsSub = documents
    ? allSubs.find((s) => s.categoryId === documents.id && s.name === 'Receipts')
    : null

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <LockEgg src="/icons/cobb/icons/system/upload_receipt_icon_512.png" />
        <h1 className="text-2xl font-bold text-stone-100">Upload receipt</h1>
        <HelpPopout
          title="Upload receipt"
          sections={[
            {
              heading: 'How it works',
              tips: [
                { title: 'Snap or pick a photo', description: 'Use the camera button for a fresh shot, or pick an existing photo from your roll.' },
                { title: 'Crop the receipt', description: 'Optional — drag the four corners over the paper to straighten and clean it up before saving.' },
                { title: 'Auto-fill', description: 'Claude reads the merchant, total, and date. Tweak any field before saving.' },
                { title: 'Original is kept', description: 'The receipt photo attaches to the saved entry so you can pull up the source later.' },
              ],
            },
          ]}
        />
      </div>
      <p className="text-stone-400 text-sm mb-3">
        Snap a receipt — we read the merchant, total, and date, then file it under the best-fit category.
      </p>
      <Link
        href="/receipts"
        className="inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 mb-6 transition"
      >
        <BarChart3 size={12} />
        See YTD totals by LLC →
      </Link>

      <NewReceiptForm
        categories={allCategories}
        subcategories={allSubs}
        defaultCategoryId={documents?.id ?? null}
        defaultSubcategoryId={receiptsSub?.id ?? null}
        prefillAmount={prefillAmountDollars}
        prefillDate={prefillDate}
        prefillMerchant={prefillMerchant}
        attachDecisionTo={attachDecisionTo}
      />
    </div>
  )
}
