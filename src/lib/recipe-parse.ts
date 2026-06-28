// Recipe ingredient parsing, scaling, and merging.
//
// Recipes are stored as plain-text markdown inside notes.content, with an
// "## Ingredients" section that holds one ingredient per line prefixed with
// "- ". The lines themselves are unstructured strings ("1 cup flour", "salt
// to taste", "1/2 tsp baking soda") authored either via the recipe form or
// by the AI scan/web import.
//
// The meal-plan feature needs to:
//   1. Pull those lines out of a recipe's content
//   2. Parse each into { quantity, unit, item } so we can scale by 2/3/4×
//   3. Merge same-(item, unit) entries across multiple picked recipes so the
//      shopping list shows "2 cups flour" once instead of "1 cup flour" twice
//
// All helpers are pure (no I/O) so they're testable and safe to call from
// either a server action or a client component.

export interface ParsedIngredient {
  /** Numeric quantity, or null when the line has no leading number. */
  quantity: number | null
  /** Normalized unit ('cup', 'tsp', 'tbsp', ...) or null. */
  unit: string | null
  /** Item name, lowercased + trimmed. Empty string for malformed input. */
  item: string
  /** Original line, kept around so we can fall back to displaying it raw. */
  raw: string
  /** Recipe IDs that contributed this line. Used for merging across recipes. */
  recipeIds: string[]
  /**
   * Optional second part for mixed-unit rendering (e.g. "1 cup 2 tbsp flour"
   * or "1 lb 4 oz butter"). Set by mergeIngredients when summing within a
   * unit family yields a value that doesn't land on a single clean
   * cooking fraction. Always null on freshly parsed lines.
   */
  extraQuantity?: number | null
  extraUnit?: string | null
}

// Units we recognise. Order matters: longer aliases first so "tablespoon"
// matches before "table". Each entry maps an alias → the canonical unit
// we'll display.
const UNIT_ALIASES: Array<[RegExp, string]> = [
  // Volume
  [/^tablespoons?$|^tbsps?\.?$|^tbs?\.?$/i, 'tbsp'],
  [/^teaspoons?$|^tsps?\.?$/i, 'tsp'],
  [/^cups?$|^c\.?$/i, 'cup'],
  [/^pints?$|^pt\.?$/i, 'pint'],
  [/^quarts?$|^qt\.?$/i, 'quart'],
  [/^gallons?$|^gal\.?$/i, 'gallon'],
  [/^fluid ounces?$|^fl\.?\s*oz\.?$/i, 'fl oz'],
  [/^milliliters?$|^millilitres?$|^ml\.?$/i, 'ml'],
  [/^liters?$|^litres?$|^l\.?$/i, 'l'],
  // Weight
  [/^ounces?$|^oz\.?$/i, 'oz'],
  [/^pounds?$|^lbs?\.?$/i, 'lb'],
  [/^grams?$|^g\.?$/i, 'g'],
  [/^kilograms?$|^kgs?\.?$/i, 'kg'],
  // Misc / counted
  [/^pinch(?:es)?$/i, 'pinch'],
  [/^dash(?:es)?$/i, 'dash'],
  [/^sprigs?$/i, 'sprig'],
  [/^cloves?$/i, 'clove'],
  [/^slices?$/i, 'slice'],
  [/^heads?$/i, 'head'],
  [/^bunch(?:es)?$/i, 'bunch'],
  [/^cans?$/i, 'can'],
  [/^packages?$|^pkgs?\.?$|^packs?$/i, 'pkg'],
  [/^pieces?$|^pcs?\.?$/i, 'piece'],
  [/^stalks?$/i, 'stalk'],
  [/^stems?$/i, 'stem'],
  [/^whole$/i, 'whole'],
]

// Canonical units that pluralise (e.g. "1 cup" → "2 cups"). The renderer
// adds an 's' when quantity > 1 for these.
const PLURALIZABLE_UNITS = new Set([
  'cup', 'tsp', 'tbsp', 'pint', 'quart', 'gallon',
  'oz', 'lb', 'pinch', 'dash', 'sprig', 'clove',
  'slice', 'head', 'bunch', 'can', 'pkg', 'piece', 'stalk', 'stem',
])

// ─── Unit families & conversion ─────────────────────────────────────────────
//
// Lets the merger combine entries with the same item but different units in
// the same physical family. e.g. "1 cup butter" + "4 tbsp butter" merges
// into "1 cup 4 tbsp butter" instead of staying as two lines. We never
// cross families (weight ↔ volume) since the conversion depends on the
// specific ingredient's density.

type UnitFamily = 'vol_us' | 'vol_metric' | 'wt_us' | 'wt_metric'

// Each unit's family + multiplier to the family's base unit (smallest).
//   vol_us  base = tsp:   1 tbsp = 3 tsp, 1 fl oz = 6 tsp, 1 cup = 48 tsp, ...
//   vol_metric base = ml: 1 l = 1000 ml
//   wt_us   base = oz:    1 lb = 16 oz
//   wt_metric base = g:   1 kg = 1000 g
const UNIT_INFO: Record<string, { family: UnitFamily; toBase: number }> = {
  // Volume (US)
  tsp:     { family: 'vol_us',     toBase: 1 },
  tbsp:    { family: 'vol_us',     toBase: 3 },
  'fl oz': { family: 'vol_us',     toBase: 6 },
  cup:     { family: 'vol_us',     toBase: 48 },
  pint:    { family: 'vol_us',     toBase: 96 },
  quart:   { family: 'vol_us',     toBase: 192 },
  gallon:  { family: 'vol_us',     toBase: 768 },
  // Volume (metric)
  ml:      { family: 'vol_metric', toBase: 1 },
  l:       { family: 'vol_metric', toBase: 1000 },
  // Weight (US)
  oz:      { family: 'wt_us',      toBase: 1 },
  lb:      { family: 'wt_us',      toBase: 16 },
  // Weight (metric)
  g:       { family: 'wt_metric',  toBase: 1 },
  kg:      { family: 'wt_metric',  toBase: 1000 },
}

// Ladder of OUTPUT units, largest to smallest, for promotion during render.
// Intentionally narrower than UNIT_INFO — pint/quart/gallon/fl oz are valid
// inputs (someone might write "1 quart milk") but on a grocery list nobody
// wants to see "3/4 quarts flour" instead of "3 cups". Renders always
// promote to cup / tbsp / tsp for vol_us, lb / oz for wt_us, etc.
const LADDER: Record<UnitFamily, string[]> = {
  vol_us:     ['cup', 'tbsp', 'tsp'],
  vol_metric: ['l', 'ml'],
  wt_us:      ['lb', 'oz'],
  wt_metric:  ['kg', 'g'],
}

function getUnitFamily(unit: string | null | undefined): UnitFamily | null {
  if (!unit) return null
  return UNIT_INFO[unit]?.family ?? null
}

function toBaseValue(quantity: number, unit: string): number | null {
  const info = UNIT_INFO[unit]
  if (!info) return null
  return quantity * info.toBase
}

// Cooking-friendly: a value is "clean" if it sits within tolerance of a
// whole number or a common cooking fraction. Used to decide whether a
// single-unit render reads naturally ("1 1/2 cups") or would come out
// awkward ("0.83 cups"), in which case we split into two units.
const COOKING_FRACTIONS = [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 7 / 8]
function isCleanCookingQty(q: number): boolean {
  if (q < 0) return false
  const whole = Math.floor(q)
  const frac = q - whole
  for (const v of COOKING_FRACTIONS) {
    if (Math.abs(frac - v) < 0.02) return true
  }
  return false
}

/**
 * Given a value in the family's base unit, pick the best human-readable
 * (qty, unit) plus optional (extraQty, extraUnit) for mixed rendering.
 *
 * Anchors on the LARGEST unit that reaches qty >= 1 (the "natural" base
 * for this amount). e.g. base = 51 tsp → cup is natural (1.06 cups), so
 * we render around cup rather than picking up "17 tbsps".
 *
 * Then in priority:
 *   1. Single-unit render at the natural base, if the qty is a clean
 *      cooking fraction (whole or whole + 1/8, 1/4, 1/3, 1/2, 2/3, 3/4).
 *      → "1 1/8 cups", "2 cups", "1 1/2 lbs"
 *   2. Mixed two-part: whole at the natural base + a smaller unit that
 *      absorbs the remainder cleanly.
 *      → "1 cup 1 tbsp", "1 lb 4 oz"
 *   3. Single-unit at the natural base with a decimal qty.
 *      → "1.07 cups" (rare — only when no clean split exists)
 *   4. If no unit reaches 1, render at the smallest ladder unit raw.
 *      → "2 tsps", "120 g"
 */
function pickRender(baseValue: number, family: UnitFamily): {
  qty: number
  unit: string
  extraQty: number | null
  extraUnit: string | null
} {
  const ladder = LADDER[family]

  // Find the largest ladder unit where qty >= 1 (the "natural" anchor).
  let anchor = -1
  for (let i = 0; i < ladder.length; i++) {
    const q = baseValue / UNIT_INFO[ladder[i]].toBase
    if (q >= 1 - 0.001) { anchor = i; break }
  }

  // Nothing reaches 1 of any ladder unit — render at the smallest, raw.
  if (anchor === -1) {
    const smallest = ladder[ladder.length - 1]
    return {
      qty: baseValue / UNIT_INFO[smallest].toBase,
      unit: smallest,
      extraQty: null,
      extraUnit: null,
    }
  }

  const anchorUnit = ladder[anchor]
  const anchorFactor = UNIT_INFO[anchorUnit].toBase
  const anchorQty = baseValue / anchorFactor

  // 1. Single-unit clean render at the anchor.
  if (isCleanCookingQty(anchorQty)) {
    return { qty: anchorQty, unit: anchorUnit, extraQty: null, extraUnit: null }
  }

  // 2. Mixed: anchor whole + smaller unit absorbs remainder cleanly.
  const whole = Math.floor(anchorQty)
  const remainder = baseValue - whole * anchorFactor
  if (whole >= 1 && remainder > 0.001) {
    for (let j = anchor + 1; j < ladder.length; j++) {
      const smaller = ladder[j]
      const sFactor = UNIT_INFO[smaller].toBase
      const q2 = remainder / sFactor
      if (q2 >= 1 / 8 - 0.001 && isCleanCookingQty(q2)) {
        return { qty: whole, unit: anchorUnit, extraQty: q2, extraUnit: smaller }
      }
    }
  }

  // 3. Couldn't split cleanly — render the anchor with its decimal qty.
  return { qty: anchorQty, unit: anchorUnit, extraQty: null, extraUnit: null }
}

// Leading prep modifiers that describe how the cook treats the
// ingredient, NOT what the product on the shelf is. Stripping these
// merges "extra-virgin olive oil" with "olive oil" and "freshly ground
// black pepper" with "black pepper".
//
// Order matters: longer phrases come first so "freshly ground" matches
// before "freshly" alone. Each entry is a leading prefix; we strip
// exactly one match per call (the most specific that fits).
const LEADING_PREP_ADJECTIVES = [
  'extra-virgin', 'extra virgin',
  'freshly ground', 'freshly grated', 'freshly chopped', 'freshly squeezed',
  'freshly cracked', 'freshly',
  'finely chopped', 'finely minced', 'finely diced', 'finely grated',
  'finely sliced', 'finely',
  'coarsely chopped', 'coarsely ground', 'coarsely',
  'roughly chopped', 'roughly',
  'thinly sliced', 'thinly',
]

// "Ground X" is ambiguous — "ground beef" is a distinct product from
// "beef" (different cut, different shelf), but "ground black pepper" is
// literally the same jar as "black pepper" with a pre-grind. We only
// strip "ground" when the rest of the line is a spice that's almost
// always sold pre-ground.
const GROUND_SPICE_RE = /^ground\s+(black pepper|white pepper|pepper|cinnamon|nutmeg|cumin|cloves?|coriander|ginger|allspice|cardamom|mustard|paprika|turmeric|fennel)\b/

// Item-name normaliser. Pulls out the bare ingredient noun so that lines
// authored in different recipes (or by different humans) still merge into
// one row. Without this, "1 cup olive oil" from one recipe and "2 tbsp
// olive oil, divided" from another would persist as TWO rows on the
// grocery list — defeating the whole point of having a meal plan.
//
// Steps:
//   1. Lowercase + trim.
//   2. Strip a trailing parenthetical:  "olive oil (extra-virgin)" → "olive oil"
//   3. Strip a comma-suffix prep note:  "olive oil, divided"       → "olive oil"
//                                       "salt, to taste"           → "salt"
//   4. Collapse repeated internal whitespace.
//   5. Strip one leading prep adjective:
//        "extra-virgin olive oil"        → "olive oil"
//        "freshly ground black pepper"   → "black pepper"
//        "finely chopped onion"          → "onion"
//   6. Strip a leading "ground " when followed by a common ground-only
//      spice: "ground black pepper" → "black pepper".
//   7. Strip a trailing 's' for common singular/plural pairing
//      ("egg" / "eggs"). Skips words ending in double-s, 'us', 'is', 'os'.
function normalizeItem(s: string): string {
  let lower = s.toLowerCase().trim()
  // Drop any parenthetical (prep hints like "(chopped)" or sourcing
  // notes like "(such as Bertolli)").
  lower = lower.replace(/\s*\([^)]*\)/g, '').trim()
  // Drop everything after the first comma — that's the prep-note tail
  // ("divided", "for drizzling", "chopped", "to taste").
  const commaIdx = lower.indexOf(',')
  if (commaIdx >= 0) lower = lower.slice(0, commaIdx).trim()
  // Squeeze multiple spaces so "olive  oil" matches "olive oil".
  lower = lower.replace(/\s+/g, ' ')
  // Strip a leading prep adjective (longest match wins thanks to the
  // ordering of LEADING_PREP_ADJECTIVES).
  for (const prefix of LEADING_PREP_ADJECTIVES) {
    if (lower.startsWith(prefix + ' ')) {
      lower = lower.slice(prefix.length + 1).trim()
      break
    }
  }
  // Targeted "ground " strip for spices that are essentially always
  // sold ground. Runs AFTER the leading-adj pass so "freshly ground
  // black pepper" → ("freshly ground" stripped) → "black pepper" via
  // the first rule, and "ground black pepper" → "black pepper" here.
  lower = lower.replace(GROUND_SPICE_RE, '$1')
  if (lower.length < 4) return lower
  if (/(?:ss|us|is|os)$/.test(lower)) return lower
  if (lower.endsWith('s')) return lower.slice(0, -1)
  return lower
}

function pluralizeUnit(unit: string, quantity: number | null): string {
  if (quantity == null || quantity <= 1) return unit
  if (!PLURALIZABLE_UNITS.has(unit)) return unit
  return unit + 's'
}

// Convert a quantity string like "1/2", "1 1/2", "0.75", or "2" into a number.
// Returns null if the input doesn't parse cleanly.
function parseQuantityToken(token: string): number | null {
  const cleaned = token.trim()
  if (cleaned === '') return null
  // Mixed fraction: "1 1/2" or "1-1/2"
  const mixed = cleaned.match(/^(\d+)[\s-](\d+)\/(\d+)$/)
  if (mixed) {
    const whole = Number(mixed[1])
    const num = Number(mixed[2])
    const den = Number(mixed[3])
    if (den === 0) return null
    return whole + num / den
  }
  // Plain fraction: "1/2"
  const frac = cleaned.match(/^(\d+)\/(\d+)$/)
  if (frac) {
    const num = Number(frac[1])
    const den = Number(frac[2])
    if (den === 0) return null
    return num / den
  }
  // Decimal or integer
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

// Render a number back to a recipe-friendly string. 1 → "1", 0.5 → "1/2",
// 1.5 → "1 1/2", 0.333 → "1/3", 0.25 → "1/4". Anything that doesn't land on
// a common cooking fraction falls back to two-decimal rounding.
function renderQuantity(q: number): string {
  if (!Number.isFinite(q)) return ''
  // Cooking fractions: 1/8, 1/4, 1/3, 1/2, 2/3, 3/4
  const fractions: Array<[number, string]> = [
    [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'],
    [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'],
  ]
  const whole = Math.floor(q)
  const frac = q - whole

  // Exact whole number
  if (Math.abs(frac) < 0.01) return String(whole)

  // Match the fractional part to a cooking fraction (within tolerance)
  for (const [val, str] of fractions) {
    if (Math.abs(frac - val) < 0.02) {
      return whole === 0 ? str : `${whole} ${str}`
    }
  }

  // Fallback: decimal trimmed to 2 places
  const rounded = Math.round(q * 100) / 100
  return String(rounded)
}

/**
 * Pull ingredient lines out of a recipe's note content. Looks for a section
 * starting with "## Ingredients" and reads "- " prefixed lines until the
 * next heading or end of content.
 */
export function extractIngredients(content: string): string[] {
  if (!content) return []
  const lines = content.split('\n')
  const out: string[] = []
  let inSection = false
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    // Heading detection (## anything)
    if (/^##\s+/.test(line)) {
      // Only enter the section when we hit exactly "## Ingredients"
      inSection = /^##\s+ingredients\s*$/i.test(line)
      continue
    }
    if (!inSection) continue
    const m = line.match(/^\s*[-*]\s+(.+)$/)
    if (m && m[1].trim() !== '') out.push(m[1].trim())
  }
  return out
}

/**
 * Parse "1 1/2 cups all-purpose flour" → { quantity: 1.5, unit: 'cup',
 * item: 'all-purpose flour' }. Lines without a leading number ("salt to
 * taste") parse with quantity=null and the whole text as item.
 */
export function parseIngredient(line: string, recipeIds: string[] = []): ParsedIngredient {
  const raw = line.trim()
  if (raw === '') {
    return { quantity: null, unit: null, item: '', raw, recipeIds }
  }

  // Try to match a leading quantity token. Supports "1 1/2", "1-1/2", "1/2",
  // and plain numbers (integer or decimal). Allows an optional unit token
  // after, then the rest is the item.
  const re = /^\s*((?:\d+[\s-]\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?))\s+(.+)$/
  const match = raw.match(re)
  if (!match) {
    return { quantity: null, unit: null, item: normalizeItem(raw), raw, recipeIds }
  }

  let quantity = parseQuantityToken(match[1])
  const rest = match[2].trim()

  // Try to peel off a unit from the next token. If the first word matches a
  // known unit alias, treat it as the unit; otherwise, no unit and the whole
  // rest is the item name.
  const firstSpace = rest.indexOf(' ')
  const firstWord = firstSpace === -1 ? rest : rest.slice(0, firstSpace)
  const tail = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim()

  let unit: string | null = null
  let itemRaw = rest
  for (const [alias, canonical] of UNIT_ALIASES) {
    if (alias.test(firstWord)) {
      unit = canonical
      itemRaw = tail
      break
    }
  }

  // Optional compound quantity: "X u1 plus Y u2 ITEM" (or "X u1 + Y u2 ITEM").
  // The web/AI recipe importer emits these for fractional measurements
  // like "1/4 cup + 1 tbsp olive oil" → "0.38 cup plus 1 tbsp olive oil".
  // Without this branch the "plus 1 tbsp." string gets jammed into the
  // item name and the row never merges with sibling olive-oil entries.
  // When the secondary unit is in the same physical family as the
  // primary, fold its base-value into `quantity` so downstream sees one
  // clean (qty, unit, item) tuple.
  if (quantity != null && unit) {
    const compoundRe = /^(?:plus\s+|\+\s*)((?:\d+[\s-]\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?))\s+(\S+?)\.?\s+(.+)$/i
    const cm = itemRaw.match(compoundRe)
    if (cm) {
      const q2 = parseQuantityToken(cm[1])
      const u2Word = cm[2]
      let u2: string | null = null
      for (const [alias, canonical] of UNIT_ALIASES) {
        if (alias.test(u2Word)) { u2 = canonical; break }
      }
      const f1 = getUnitFamily(unit)
      const f2 = getUnitFamily(u2)
      if (q2 != null && u2 && f1 && f1 === f2) {
        const baseA = toBaseValue(quantity, unit)
        const baseB = toBaseValue(q2, u2)
        if (baseA != null && baseB != null) {
          const factor = UNIT_INFO[unit].toBase
          quantity = (baseA + baseB) / factor
          itemRaw = cm[3].trim()
        }
      }
    }
  }

  return {
    quantity,
    unit,
    item: normalizeItem(itemRaw),
    raw,
    recipeIds,
  }
}

/** Multiply a parsed ingredient's quantity by `scale`. Null quantities pass through. */
export function scaleIngredient(parsed: ParsedIngredient, scale: number): ParsedIngredient {
  if (parsed.quantity == null || scale === 1) return parsed
  return { ...parsed, quantity: parsed.quantity * scale }
}

/** Render a parsed ingredient back to a clean display string. */
export function renderIngredient(parsed: ParsedIngredient): string {
  // No quantity → fall back to the original line (preserves "salt to taste").
  if (parsed.quantity == null) {
    return parsed.raw || parsed.item
  }
  const qStr = renderQuantity(parsed.quantity)
  const uStr = parsed.unit ? ` ${pluralizeUnit(parsed.unit, parsed.quantity)}` : ''
  // Mixed two-part rendering ("1 cup 2 tbsp flour", "1 lb 4 oz butter").
  // The merger sets these when summing within a unit family yielded a
  // value that doesn't fit one clean cooking fraction.
  let extra = ''
  if (parsed.extraQuantity != null && parsed.extraUnit) {
    const eq = renderQuantity(parsed.extraQuantity)
    const eu = pluralizeUnit(parsed.extraUnit, parsed.extraQuantity)
    extra = ` ${eq} ${eu}`
  }
  const iStr = parsed.item ? ` ${parsed.item}` : ''
  return `${qStr}${uStr}${extra}${iStr}`.trim()
}

/**
 * Group ingredients across a list and sum their quantities.
 *
 * Three merge bands, in priority order:
 *
 *   1. Quantity + unit in a known family (cup, tbsp, oz, lb, ml, g, …):
 *      key by (item, family). All entries with the same item in the same
 *      family are summed in the family's base unit (tsp / ml / oz / g),
 *      then re-rendered by pickRender() — which may switch units
 *      (4 tsp → "1 tbsp 1 tsp") or split into a 2-part mixed form
 *      ("1 cup 2 tbsp flour", "1 lb 4 oz butter").
 *
 *   2. Quantity + unit OUTSIDE a known family (counted units like clove,
 *      can, slice, or numbers with no unit at all): key by (item, unit)
 *      and sum quantities as-is. Keeps "2 cans tomatoes" + "1 can
 *      tomatoes" as "3 cans tomatoes".
 *
 *   3. No quantity ("salt to taste"): dedup by item name only — two
 *      identical lines collapse to one.
 *
 * `recipeIds` from each input merges into the output so the UI can show
 * "needed for: Lasagna, Bread".
 */
export function mergeIngredients(items: ParsedIngredient[]): ParsedIngredient[] {
  interface FamilyAccumulator {
    item: string
    family: UnitFamily
    base: number
    recipeIds: string[]
    raw: string
    /**
     * Quantities the user actually wrote, keyed by unit. When this map
     * has only one entry, the group never crossed unit boundaries and
     * we render with that original unit (preserves "1/4 cup oil" instead
     * of forcing it to "4 tbsps oil" via promotion).
     */
    byUnit: Map<string, number>
  }
  const familyGroups = new Map<string, FamilyAccumulator>()
  const otherGroups = new Map<string, ParsedIngredient>()

  for (const it of items) {
    const family = getUnitFamily(it.unit)
    if (it.quantity != null && it.unit && family) {
      const key = `fam:${it.item}|${family}`
      const base = toBaseValue(it.quantity, it.unit) ?? 0
      const existing = familyGroups.get(key)
      if (!existing) {
        familyGroups.set(key, {
          item: it.item,
          family,
          base,
          recipeIds: [...it.recipeIds],
          raw: it.raw,
          byUnit: new Map([[it.unit, it.quantity]]),
        })
      } else {
        existing.base += base
        existing.byUnit.set(it.unit, (existing.byUnit.get(it.unit) ?? 0) + it.quantity)
        for (const r of it.recipeIds) {
          if (!existing.recipeIds.includes(r)) existing.recipeIds.push(r)
        }
      }
      continue
    }

    // Fall-through: counted units, no unit, or no quantity.
    const key = it.quantity == null
      ? `text:${it.item}`
      : `qty:${it.item}|${it.unit ?? ''}`
    const existing = otherGroups.get(key)
    if (!existing) {
      otherGroups.set(key, { ...it, recipeIds: [...it.recipeIds] })
      continue
    }
    if (existing.quantity != null && it.quantity != null) {
      existing.quantity += it.quantity
    }
    for (const r of it.recipeIds) {
      if (!existing.recipeIds.includes(r)) existing.recipeIds.push(r)
    }
  }

  // Convert family-summed accumulators back to ParsedIngredients.
  // When every contributor used the SAME unit, pass through with that
  // unit + summed quantity — no promotion, so "1/4 cup oil" alone stays
  // "1/4 cup oil" and "1 cup + 1 cup flour" stays "2 cups flour".
  // When contributors used DIFFERENT units in the same family, run
  // pickRender to combine + promote (single or mixed two-part).
  const fromFamilies: ParsedIngredient[] = []
  for (const acc of familyGroups.values()) {
    if (acc.byUnit.size === 1) {
      const [origUnit, totalQty] = acc.byUnit.entries().next().value as [string, number]
      fromFamilies.push({
        quantity: totalQty,
        unit: origUnit,
        item: acc.item,
        raw: acc.raw,
        recipeIds: acc.recipeIds,
        extraQuantity: null,
        extraUnit: null,
      })
      continue
    }
    const pick = pickRender(acc.base, acc.family)
    fromFamilies.push({
      quantity: pick.qty,
      unit: pick.unit,
      item: acc.item,
      raw: acc.raw,
      recipeIds: acc.recipeIds,
      extraQuantity: pick.extraQty,
      extraUnit: pick.extraUnit,
    })
  }

  return [...fromFamilies, ...otherGroups.values()]
}
