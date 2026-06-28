// Three-letter abbreviation for each recipe subcategory tag — used on
// the closed recipe card and next to the "Serves N" pill so a quick
// glance tells you what kind of recipe it is without taking up much
// space. Falls back to the first three uppercased characters when an
// unknown tag shows up (covers legacy/custom subs without breaking).

const ABBREV: Record<string, string> = {
  'Slow Cooker':  'SLO',
  'Poultry':      'PLT',
  'Seafood':      'SEA',
  'Desserts':     'DES',
  'Salads':       'SAL',
  'Sides':        'SID',
  'Soups':        'SOU',
  'Breads':       'BRD',
  'Appetizers':   'APP',
  'Vegetarian':   'VGN',
  'Pasta':        'PAS',
  'Meat':         'MEA',
  'Veggies':      'VEG',
  'Cookies':      'COO',
  'Holidays':     'HOL',
  'Christmas':    'XMS',
  'Easter':       'EAS',
  'Thanksgiving': 'THX',
  // Legacy / non-canonical subs that may still be tagged on older notes.
  'Breakfast': 'BKF',
  'Lunch':     'LCH',
  'Dinner':    'DIN',
  'Snacks':    'SNK',
  'Camping':   'CMP',
  'Chicken':   'CHK',
}

export function abbreviateRecipeTag(name: string): string {
  return ABBREV[name] ?? name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()
}

/**
 * True when this tag matches a known recipe-subcategory name — used
 * by generic note rendering (NoteCard) to decide whether to surface
 * abbrev pills. Avoids putting pills on non-recipe notes whose tags
 * mean something else (e.g. IDNW letters tag with LETTER_TAG).
 */
export function isRecipeTag(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ABBREV, name)
}
