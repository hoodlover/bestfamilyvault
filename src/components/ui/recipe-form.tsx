'use client'

// Custom create-a-recipe form. Saves the recipe as a Note in the Recipes
// category — the form's job is to make ingredient entry fast via two
// dropdowns (measurement + ingredient) plus an "Other" escape hatch.
//
// Output format (markdown-ish, plain text inside note.content):
//
//   ## Ingredients
//   - 1 tsp salt
//   - 2 cups flour
//
//   ## Method
//   1. Preheat oven to 350°F.
//   2. Mix dry ingredients.
//
//   ## Story
//   Mom always made this on Christmas Eve…

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, ChefHat, Check, ImagePlus, Plus, Search, Trash2, X } from 'lucide-react'
import { createRecipe } from '@/lib/actions/recipes'
import { uploadFile } from '@/lib/actions/files'
import { compressImage } from '@/lib/image-compress'
import { useUnsavedGuard } from './use-unsaved-guard'
import { CameraCapture } from './camera-capture'
import { RecipeImportPanel, type ImportedRecipe } from './recipe-import-panel'

const STANDARD_UNITS = [
  'tsp', 'tbsp', 'cup', 'fl oz', 'oz', 'lb',
  'pinch', 'dash', 'sprig', 'clove', 'whole',
  'to taste',
]

const METRIC_UNITS = [
  'ml', 'l', 'g', 'kg',
  'pinch', 'dash', 'sprig', 'clove', 'whole',
  'to taste',
]

// Sectioned ingredient list. Order matters within each section — the
// most-reached-for items go first so dropdown scrolling stays minimal.
const INGREDIENT_GROUPS: { label: string; items: string[] }[] = [
  {
    label: '— Spices & seasonings —',
    items: [
      'salt', 'kosher salt', 'sea salt', 'black pepper', 'white pepper',
      'garlic powder', 'onion powder', 'paprika', 'smoked paprika',
      'cayenne pepper', 'crushed red pepper', 'chili powder',
      'cumin', 'coriander', 'turmeric', 'ginger', 'cinnamon', 'nutmeg',
      'allspice', 'cloves', 'cardamom', 'bay leaves', 'oregano', 'basil',
      'thyme', 'rosemary', 'sage', 'parsley', 'cilantro', 'dill',
      'tarragon', 'chives', 'mint', 'mustard powder', 'curry powder',
      'garam masala', 'italian seasoning', 'old bay', 'lemon pepper',
      'garlic salt', 'seasoned salt', 'vanilla extract',
    ],
  },
  {
    label: '— Pantry —',
    items: [
      'olive oil', 'vegetable oil', 'butter', 'flour', 'sugar', 'brown sugar',
      'powdered sugar', 'honey', 'maple syrup', 'baking powder', 'baking soda',
      'cornstarch', 'cocoa powder', 'oats', 'rice', 'pasta', 'bread crumbs',
      'soy sauce', 'worcestershire sauce', 'vinegar', 'lemon juice', 'lime juice',
      'ketchup', 'mustard', 'mayonnaise', 'hot sauce',
    ],
  },
  {
    label: '— Fresh —',
    items: [
      'garlic', 'onion', 'shallot', 'tomato', 'lemon', 'lime',
      'egg', 'milk', 'cream', 'sour cream', 'yogurt',
      'chicken', 'beef', 'pork', 'shrimp', 'fish',
      'cheese', 'parmesan', 'cheddar', 'mozzarella',
    ],
  },
]

const FLAT_INGREDIENTS = INGREDIENT_GROUPS.flatMap((g) => g.items)

const QUICK_AMOUNTS = ['1', '1/2', '1/4', '1/3', '2', '3', 'pinch', 'dash', 'to taste']

interface IngredientRow {
  id: number
  text: string
}

interface CategoryOption { id: string; name: string }
interface SubcategoryOption { id: string; name: string; slug: string; parentSubcategoryId?: string | null }

interface Props {
  recipesCategory: CategoryOption | null
  /** All categories (for the picker if no Recipes category exists). */
  allCategories: CategoryOption[]
  /** Canonical recipe subcategories (Slow Cooker, Poultry, etc.). */
  recipeSubcategories: SubcategoryOption[]
}

export function RecipeForm({ recipesCategory, allCategories, recipeSubcategories }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [system, setSystem] = useState<'standard' | 'metric'>('standard')
  const [ingredients, setIngredients] = useState<IngredientRow[]>([])
  const [method, setMethod] = useState('')
  const [story, setStory] = useState('')
  const [servings, setServings] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>(recipesCategory?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { dirty, markDirty, markClean } = useUnsavedGuard()

  // Recipe-scan state. The captured photos live here until save, at
  // which point each is uploaded as an attachment to the new recipe note.
  // Either path (scan-with-Claude or just-attach) keeps the same photos.
  // Up to 3 pages so a recipe can span facing cookbook pages or an
  // index card front+back.
  const MAX_PAGES = 3
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recipePhotos, setRecipePhotos] = useState<File[]>([])
  const [recipePhotoPreviews, setRecipePhotoPreviews] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // After a successful save we stay on the page (instead of navigating to
  // the new note) and show a "Saved!" card at the bottom with an
  // "Add another?" button. Lets Heather batch-enter cookbook
  // recipes without bouncing back to /new-recipe between each one.
  const [savedRecipe, setSavedRecipe] = useState<{ id: string; title: string } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Recipe-subcategory multi-select. Stores the subcategory IDs the user
  // has ticked. First checked becomes the note's primary subcategoryId on
  // save; all of them get written to notes.tags[] for multi-tag filtering.
  // Selection order is preserved so the "primary" can be intentional.
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([])
  function toggleSub(id: string) {
    setSelectedSubIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    markDirty()
  }

  // Revoke object URLs on unmount so the browser doesn't leak the bytes.
  useEffect(() => {
    return () => {
      for (const url of recipePhotoPreviews) URL.revokeObjectURL(url)
    }
  }, [recipePhotoPreviews])

  async function handlePhotoCaptured(file: File) {
    setCameraOpen(false)
    if (recipePhotos.length >= MAX_PAGES) {
      setError(`Max ${MAX_PAGES} pages per recipe.`)
      return
    }
    try {
      const compressed = await compressImage(file).catch(() => file)
      setRecipePhotos((prev) => [...prev, compressed])
      setRecipePhotoPreviews((prev) => [...prev, URL.createObjectURL(compressed)])
      setScanMessage(null)
      markDirty()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process photo.')
    }
  }

  function removePhoto(idx: number) {
    setRecipePhotoPreviews((prev) => {
      const url = prev[idx]
      if (url) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== idx)
    })
    setRecipePhotos((prev) => prev.filter((_, i) => i !== idx))
    setScanMessage(null)
  }

  // Shared between the photo-OCR scan and the web import panel: pre-fill
  // any empty fields from a parsed recipe payload. Doesn't clobber typed work.
  function applyImportedRecipe(r: {
    title: string | null
    ingredients: string[]
    method: string | null
    story: string | null
    servings: number | null
  }) {
    if (r.title && !title.trim()) setTitle(r.title)
    if (r.ingredients.length > 0) {
      const newRows: IngredientRow[] = r.ingredients.map((text, i) => ({
        id: Date.now() + i,
        text,
      }))
      setIngredients((prev) => [...prev, ...newRows])
    }
    if (r.method && !method.trim()) setMethod(r.method)
    if (r.story && !story.trim()) setStory(r.story)
    if (r.servings && servings.trim() === '') setServings(String(r.servings))
  }

  function handleWebImport(r: ImportedRecipe) {
    applyImportedRecipe(r)
    markDirty()
  }

  async function runRecipeScan() {
    if (recipePhotos.length === 0) return
    setScanning(true)
    setScanMessage(null)
    setError(null)
    try {
      const fd = new FormData()
      for (const p of recipePhotos) fd.append('file', p)
      const res = await fetch('/api/ocr-recipe', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.recipe) {
        setScanMessage(data.error ?? 'Scan failed. The photo will still be saved as an attachment.')
        return
      }
      const r = data.recipe as { title: string | null; ingredients: string[]; method: string | null; story: string | null; servings: number | null }
      applyImportedRecipe(r)
      setScanMessage('Recipe filled in. Eyeball the fields and tweak anything that looks off.')
      markDirty()
    } catch (err) {
      setScanMessage(err instanceof Error ? err.message : 'Scan failed.')
    } finally {
      setScanning(false)
    }
  }

  const units = system === 'standard' ? STANDARD_UNITS : METRIC_UNITS

  // Inline adder state
  const [addAmount, setAddAmount] = useState('')
  const [addUnit, setAddUnit] = useState('')
  const [addItem, setAddItem] = useState('')
  const [addOther, setAddOther] = useState('')
  const showOther = addItem === '__other__'

  function addIngredientLine() {
    const itemName = (showOther ? addOther : addItem).trim()
    if (!itemName) return
    const parts = [addAmount.trim(), addUnit.trim(), itemName].filter(Boolean)
    setIngredients((prev) => [...prev, { id: Date.now() + Math.random(), text: parts.join(' ') }])
    markDirty()
    setAddAmount('')
    setAddUnit('')
    setAddItem('')
    setAddOther('')
  }

  function removeIngredient(id: number) {
    setIngredients((prev) => prev.filter((r) => r.id !== id))
    markDirty()
  }

  function editIngredient(id: number, text: string) {
    setIngredients((prev) => prev.map((r) => (r.id === id ? { ...r, text } : r)))
    markDirty()
  }

  async function save() {
    setError(null)
    if (!title.trim()) { setError('Pick a title.'); return }
    if (!categoryId) { setError('Pick a category.'); return }

    setBusy(true)
    const fd = new FormData()
    fd.append('title', title.trim())
    fd.append('categoryId', categoryId)
    fd.append('ingredients', ingredients.map((r) => r.text).filter(Boolean).join('\n'))
    fd.append('method', method)
    fd.append('story', story)
    if (servings.trim() !== '') fd.append('servings', servings.trim())
    for (const id of selectedSubIds) fd.append('tags', id)
    const res = await createRecipe(fd)
    if (res?.error) { setBusy(false); setError(res.error); return }

    // Attach the recipe photos to the freshly-created note so the user can
    // tap to view the original pages later (especially useful when the OCR
    // missed a step). Failure here is non-fatal — the recipe itself is
    // saved, we just log a warning.
    if (res?.id && recipePhotos.length > 0) {
      for (const photo of recipePhotos) {
        try {
          const photoFd = new FormData()
          photoFd.append('file', photo)
          photoFd.append('noteId', res.id)
          if (categoryId) photoFd.append('categoryId', categoryId)
          const up = await uploadFile(photoFd)
          if (up?.error) console.warn('[recipe-form] photo upload failed:', up.error)
        } catch (err) {
          console.warn('[recipe-form] photo upload threw:', err)
        }
      }
    }

    const savedTitle = title.trim()
    const savedId = res?.id ?? null

    // Reset to a blank form so Heather can immediately enter the next
    // recipe. Keep the chosen category and measurement system — she's
    // usually doing a whole stack of recipes from the same cookbook.
    setTitle('')
    setIngredients([])
    setMethod('')
    setStory('')
    setServings('')
    setSelectedSubIds([])
    for (const url of recipePhotoPreviews) URL.revokeObjectURL(url)
    setRecipePhotos([])
    setRecipePhotoPreviews([])
    setScanMessage(null)

    setBusy(false)
    markClean()
    if (savedId) setSavedRecipe({ id: savedId, title: savedTitle })
    // Tiny delay so the freshly-cleared form has rendered before focus.
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }

  return (
    <div className="space-y-5">
      {dirty && (
        <div className="sticky top-0 z-10 -mx-4 md:-mx-0 px-3 py-1.5 text-xs text-amber-200 bg-amber-950/40 border-y md:border md:rounded-md border-amber-700/40 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Not saved yet — tap Save when you&rsquo;re done.
        </div>
      )}

      {cameraOpen && (
        <CameraCapture
          onCapture={handlePhotoCaptured}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* Web import — search by name (Claude web search) or paste a URL,
          then JSON-LD parser fills the form. Sits above the camera scan
          block so the typing-friendly path comes first on desktop. */}
      <RecipeImportPanel onImported={handleWebImport} />

      {/* Scan-from-photo block. Two paths: take pictures (or upload them)
          → run Claude on them to populate the form, OR keep the photos
          only and attach them to the recipe so you can tap to view the
          original pages when the model can't read messy handwriting.
          Up to 3 pages so a single recipe can span facing cookbook pages
          or both sides of an index card. */}
      <div className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-3 md:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Camera size={16} className="text-emerald-300 shrink-0" />
            <p className="text-sm font-medium text-stone-200">
              Scan a recipe from a book or card
              <span className="ml-1.5 text-[11px] text-stone-500 font-normal">(up to {MAX_PAGES} pages)</span>
            </p>
          </div>
          {recipePhotos.length < MAX_PAGES && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
              >
                <Camera size={13} />
                {recipePhotos.length === 0 ? 'Take photo' : 'Add page'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 hover:text-stone-100 rounded-lg transition"
              >
                <ImagePlus size={13} />
                Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handlePhotoCaptured(f)
                  e.currentTarget.value = ''
                }}
              />
            </div>
          )}
        </div>

        {recipePhotos.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {recipePhotoPreviews.map((url, idx) => (
                <div key={url} className="relative rounded-lg overflow-hidden border border-stone-700/60 bg-stone-900">
                  <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center px-1.5 py-0.5 rounded-full bg-stone-900/80 text-[10px] font-medium text-stone-300 border border-stone-700/60">
                    Page {idx + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="block w-full max-h-64 object-contain bg-black" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    disabled={scanning}
                    aria-label={`Remove page ${idx + 1}`}
                    title={`Remove page ${idx + 1}`}
                    className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-7 w-7 rounded-full bg-stone-900/80 hover:bg-stone-800 text-stone-200 transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={runRecipeScan}
                disabled={scanning}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
              >
                {scanning ? (
                  <>
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    Reading {recipePhotos.length > 1 ? `${recipePhotos.length} pages` : ''}…
                  </>
                ) : (
                  <>
                    <ChefHat size={14} />
                    {recipePhotos.length > 1 ? `Scan ${recipePhotos.length} pages with Claude` : 'Scan with Claude'}
                  </>
                )}
              </button>
              <p className="text-[11px] text-stone-500 flex-1 min-w-0">
                Or skip the scan — the {recipePhotos.length > 1 ? 'photos' : 'photo'} will still attach to the recipe so you can tap to see the original {recipePhotos.length > 1 ? 'pages' : 'page'} later.
              </p>
            </div>
            {scanMessage && (
              <p className="text-xs text-stone-400 leading-relaxed">{scanMessage}</p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Recipe title *</label>
          <input
            ref={titleInputRef}
            autoFocus
            value={title}
            onChange={(e) => { setTitle(e.target.value); markDirty(); setSavedRecipe(null) }}
            placeholder="Family Banana Bread"
            maxLength={200}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Serves</label>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={servings}
            onChange={(e) => { setServings(e.target.value); markDirty() }}
            placeholder="4"
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Category</label>
          <select
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); markDirty() }}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">— Pick one —</option>
            {recipesCategory && <option value={recipesCategory.id}>{recipesCategory.name}</option>}
            {allCategories
              .filter((c) => !recipesCategory || c.id !== recipesCategory.id)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
          {!recipesCategory && (
            <p className="text-[11px] text-stone-500 mt-1">
              No &quot;Recipes&quot; category yet — pick any. You can move it later.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Measurement system</label>
          <div className="flex gap-2">
            {(['standard', 'metric'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSystem(s)}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border transition ${
                  system === s
                    ? 'bg-emerald-700/20 border-emerald-700/60 text-emerald-300'
                    : 'bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-600'
                }`}
              >
                {s === 'standard' ? 'Standard (US)' : 'Metric'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ingredient adder */}
      <div className="rounded-xl border border-stone-700/60 bg-stone-800/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ChefHat size={15} className="text-emerald-400" />
          <h3 className="text-sm font-medium text-stone-200">Add an ingredient</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[100px_140px_1fr_auto] gap-2">
          <input
            value={addAmount}
            onChange={(e) => setAddAmount(e.target.value)}
            placeholder="Amount"
            list="quick-amounts"
            className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          />
          <datalist id="quick-amounts">
            {QUICK_AMOUNTS.map((a) => <option key={a} value={a} />)}
          </datalist>

          <select
            value={addUnit}
            onChange={(e) => setAddUnit(e.target.value)}
            className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          >
            <option value="">unit</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>

          <IngredientPicker
            value={addItem}
            onChange={setAddItem}
            groups={INGREDIENT_GROUPS}
          />

          <button
            type="button"
            onClick={addIngredientLine}
            disabled={!(showOther ? addOther.trim() : addItem.trim())}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
          >
            <Plus size={14} />
            Add
          </button>
        </div>

        {showOther && (
          <input
            value={addOther}
            onChange={(e) => setAddOther(e.target.value)}
            placeholder="Custom ingredient (e.g., dried porcini mushrooms)"
            className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            list="all-ingredients"
            autoFocus
          />
        )}
        <datalist id="all-ingredients">
          {FLAT_INGREDIENTS.map((i) => <option key={i} value={i} />)}
        </datalist>

        <p className="text-[11px] text-stone-500">
          Pick amount, unit, and ingredient → tap Add. Each line is editable below if a guess is wrong.
        </p>
      </div>

      {/* Ingredient list */}
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          Ingredients <span className="text-stone-500 font-normal">({ingredients.length})</span>
        </label>
        {ingredients.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-700 bg-stone-900/40 p-4 text-center text-xs text-stone-500">
            No ingredients yet — use the panel above to add some.
          </div>
        ) : (
          <ul className="rounded-lg border border-stone-800 divide-y divide-stone-800">
            {ingredients.map((row) => (
              <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                <input
                  value={row.text}
                  onChange={(e) => editIngredient(row.id, e.target.value)}
                  className="flex-1 bg-transparent text-sm text-stone-200 placeholder-stone-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeIngredient(row.id)}
                  className="p-1 text-stone-600 hover:text-red-400 transition"
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Method</label>
        <textarea
          value={method}
          onChange={(e) => { setMethod(e.target.value); markDirty() }}
          rows={8}
          placeholder={`1. Preheat oven to 350°F.\n2. Mix dry ingredients in a large bowl.\n3. ...`}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition resize-y"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          Story <span className="text-stone-500 font-normal">(optional)</span>
        </label>
        <textarea
          value={story}
          onChange={(e) => { setStory(e.target.value); markDirty() }}
          rows={3}
          placeholder="Where does this recipe come from? Who taught it to you? Any tricks worth remembering?"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition resize-y"
        />
      </div>

      {/* Recipe-type multi-select. These are subcategories under Recipes,
          seeded by ensureRecipesCategory(). Tick any that apply — the
          first one becomes the note's primary subcategory and the full
          set lands in notes.tags[]. Only shown when the page successfully
          loaded the canonical list (e.g. first-time users with no
          superuser yet may see an empty list, in which case we hide). */}
      {recipeSubcategories.length > 0 && (
        <div className="rounded-xl border border-stone-700/60 bg-stone-800/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-sm font-medium text-stone-200">
              Recipe type
              <span className="ml-1.5 text-[11px] text-stone-500 font-normal">
                (pick any that fit — {selectedSubIds.length} selected)
              </span>
            </label>
            {selectedSubIds.length > 0 && (
              <button
                type="button"
                onClick={() => { setSelectedSubIds([]); markDirty() }}
                className="text-[11px] text-stone-500 hover:text-stone-300 transition"
              >
                Clear
              </button>
            )}
          </div>
          {/* Parents in the grid; children stack inside their parent's cell
              as smaller indented chips. Selecting parent doesn't auto-select
              children — they're independent tags. */}
          {(() => {
            const parents = recipeSubcategories.filter((s) => !s.parentSubcategoryId)
            const kidsByParent = new Map<string, SubcategoryOption[]>()
            for (const s of recipeSubcategories) {
              if (s.parentSubcategoryId) {
                const arr = kidsByParent.get(s.parentSubcategoryId) ?? []
                arr.push(s)
                kidsByParent.set(s.parentSubcategoryId, arr)
              }
            }
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 items-start">
                {parents.map((sub) => {
                  const checked = selectedSubIds.includes(sub.id)
                  const kids = kidsByParent.get(sub.id) ?? []
                  return (
                    <div key={sub.id} className="flex flex-col gap-1">
                      <label
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm cursor-pointer transition ${
                          checked
                            ? 'bg-emerald-700/20 border-emerald-700/60 text-emerald-200'
                            : 'bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSub(sub.id)}
                          className="h-4 w-4 rounded border-stone-600 bg-stone-900 text-emerald-600 focus:ring-emerald-600/50 focus:ring-offset-0"
                        />
                        <span className="truncate">{sub.name}</span>
                      </label>
                      {kids.length > 0 && (
                        <div className="ml-3 flex flex-wrap gap-1">
                          {kids.map((kid) => {
                            const kchecked = selectedSubIds.includes(kid.id)
                            return (
                              <label
                                key={kid.id}
                                className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer transition ${
                                  kchecked
                                    ? 'bg-emerald-700/20 border-emerald-700/60 text-emerald-200'
                                    : 'bg-stone-900 border-stone-700 text-stone-400 hover:border-stone-600'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={kchecked}
                                  onChange={() => toggleSub(kid.id)}
                                  className="h-3 w-3 rounded border-stone-600 bg-stone-900 text-emerald-600 focus:ring-emerald-600/50 focus:ring-offset-0"
                                />
                                <span className="truncate">{kid.name}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Right padding keeps Save clear of the floating PWAToolbar dock
          (Back/Refresh) which sits at `right-3` on installed PWAs and
          would otherwise cover this button. Also give the row breathing
          room above the mobile bottom-nav. */}
      <div className="flex justify-end gap-2 pt-2 pr-24 pb-20 md:pb-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={busy}
          className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !title.trim() || !categoryId}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:opacity-60 text-white rounded-lg transition"
        >
          {busy ? (
            <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
          ) : 'Save recipe'}
        </button>
      </div>

      {/* Saved-recipe card: shows up after a successful save so Heather
          can confirm what just landed, jump to it, or roll straight into
          the next recipe without leaving the page. The form above is
          already cleared (category + measurement system kept) so
          "Add another?" is just a way to dismiss this card and
          park the cursor in the title field. */}
      {savedRecipe && (
        <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-emerald-900/60 border border-emerald-700/50">
              <Check size={18} className="text-emerald-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-200">Saved.</p>
              <Link
                href={`/notes/${savedRecipe.id}`}
                className="block mt-0.5 text-base font-semibold text-stone-100 hover:text-emerald-300 transition truncate"
              >
                {savedRecipe.title}
              </Link>
              <p className="text-[11px] text-stone-500 mt-0.5">Tap the title to open it.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSavedRecipe(null)
              titleInputRef.current?.focus()
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
          >
            <Plus size={15} />
            Add another?
          </button>
        </div>
      )}
    </div>
  )
}

// Typeahead picker for ingredients & spices. Replaces the native <select>
// so the user can type a letter or two and the list filters down. With no
// query, shows the full list grouped by section (Spices / Pantry / Fresh).
// With a query, flattens to alphabetical matches across all groups. Below
// the matches there's always a "Use '<query>' as custom" option so a typo
// or one-off ingredient still saves cleanly.
function IngredientPicker({
  value,
  onChange,
  groups,
}: {
  value: string
  onChange: (v: string) => void
  groups: { label: string; items: string[] }[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Keep the visible label synced when the parent clears value (e.g. after
  // tapping Add). When value becomes a real ingredient, show it; '__other__'
  // sticks around as the literal string until the user re-picks something.
  useEffect(() => {
    if (value === '' || value === '__other__') setQuery('')
    else setQuery(value)
  }, [value])

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const isFiltering = q.length > 0
  // Prefix match (not substring): typing "s" shows salt + sage, not basil.
  // Then "sa" narrows to salt + sage, "sal" to salt. Mirrors how a phone
  // contacts list feels.
  const flatMatches = isFiltering
    ? groups
        .flatMap((g) => g.items)
        .filter((item) => item.toLowerCase().startsWith(q))
        .sort((a, b) => a.localeCompare(b))
    : []

  // Match exact label so "salt" doesn't repeat the custom-fallback prompt.
  const exactMatch = isFiltering && flatMatches.some((m) => m.toLowerCase() === q)

  function pick(item: string) {
    onChange(item)
    setQuery(item)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            // Empty input means "no selection yet" — don't leave a stale
            // value sitting in the parent state.
            if (e.target.value.trim() === '') onChange('')
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            // Enter takes the first matching item if there is one,
            // otherwise commits the typed text as a custom ingredient.
            const top = flatMatches[0] ?? (q ? query.trim() : '')
            if (top) pick(top)
          }}
          onFocus={() => setOpen(true)}
          placeholder="ingredient or spice"
          className="w-full pl-8 pr-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
        />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-stone-700 bg-stone-900 shadow-2xl">
          {isFiltering ? (
            <>
              {flatMatches.length === 0 ? (
                <p className="px-3 py-2 text-xs text-stone-500">No matches.</p>
              ) : (
                flatMatches.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => pick(item)}
                    className="w-full text-left px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800 transition"
                  >
                    {item}
                  </button>
                ))
              )}
              {!exactMatch && (
                <button
                  type="button"
                  onClick={() => {
                    // Use the typed text directly as the ingredient name.
                    // Skips the legacy '__other__' indirection so the user
                    // doesn't have to retype the same word in a second box.
                    onChange(query.trim())
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-stone-800 border-t border-stone-800 transition"
                >
                  Use &ldquo;{query}&rdquo; as custom
                </button>
              )}
            </>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="sticky top-0 px-3 py-1 text-[10px] uppercase tracking-wider text-stone-500 bg-stone-900/95 backdrop-blur border-b border-stone-800">
                  {g.label.replace(/—/g, '').trim()}
                </div>
                {g.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => pick(item)}
                    className="w-full text-left px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800 transition"
                  >
                    {item}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
