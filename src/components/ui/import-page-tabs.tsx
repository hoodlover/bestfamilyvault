'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { ImportEntries } from './import-entries'
import { ImportNotes } from './import-notes'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories } from '@/lib/db/schema'

type Category = InferSelectModel<typeof categories>

export function ImportPageTabs({ categories }: { categories: Category[] }) {
  const [tab, setTab] = useState<'entries' | 'notes'>('entries')

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-stone-800/50 p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab('entries')}
          className={clsx(
            'px-5 py-2 rounded-lg text-sm font-medium transition',
            tab === 'entries' ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
          )}
        >
          Entries (logins, cards, etc.)
        </button>
        <button
          onClick={() => setTab('notes')}
          className={clsx(
            'px-5 py-2 rounded-lg text-sm font-medium transition',
            tab === 'notes' ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
          )}
        >
          Notes
        </button>
      </div>

      {tab === 'entries' ? (
        <ImportEntries categories={categories} />
      ) : (
        <ImportNotes categories={categories} />
      )}
    </div>
  )
}
