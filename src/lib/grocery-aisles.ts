// Maps a grocery-list item's text to a Publix aisle so the shopping
// list groups itself the way you actually walk the store.
//
// Order in AISLE_RULES is the order things appear when you shop, AND
// the priority order for classification — first keyword hit wins, so
// more specific aisles must come before broader ones. e.g. "beef
// broth" needs Canned Goods to come before Meat & Seafood, or the
// "beef" hit would route it wrong.
//
// Keywords are matched as case-insensitive substrings against the
// item text (after the qty+unit prefix). It's a deliberately dumb
// classifier — works on ~90% of common pantry items, falls back to
// "Other" for the long tail (which still prints, just at the bottom).

export interface AisleRule {
  aisle: string
  keywords: string[]
}

export const AISLES_IN_STORE_ORDER: string[] = [
  'Produce',
  'Bakery',
  'Deli',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Frozen',
  'Pasta & Rice',
  'Canned Goods',
  'Baking & Pantry',
  'Spices & Condiments',
  'Breakfast & Cereal',
  'Snacks',
  'Beverages',
  'Household',
  'Other',
]

// Classification priority — NOT the same as store order. We classify
// more specific items first (e.g. broth before beef).
const AISLE_RULES: AisleRule[] = [
  {
    aisle: 'Frozen',
    keywords: ['frozen', 'ice cream', 'gelato', 'sorbet'],
  },
  {
    aisle: 'Canned Goods',
    keywords: [
      'broth', 'stock', 'canned', 'can of', 'tomato sauce', 'tomato paste',
      'crushed tomato', 'diced tomato', 'whole tomato', 'tomato puree',
      'pumpkin puree', 'condensed', 'evaporated milk',
    ],
  },
  {
    aisle: 'Bakery',
    keywords: [
      'baguette', 'sourdough', 'ciabatta', 'focaccia', 'brioche',
      'hamburger bun', 'hot dog bun', 'sandwich bread', 'sliced bread',
      'tortilla', 'pita', 'naan', 'bagel', 'english muffin', 'croissant',
      'dinner roll', 'crescent roll', 'pie crust',
    ],
  },
  {
    aisle: 'Deli',
    keywords: [
      'sliced ham', 'sliced turkey', 'sliced roast beef', 'salami',
      'prosciutto', 'pepperoni', 'pastrami', 'mortadella', 'capicola',
      'rotisserie chicken', 'rotisserie',
    ],
  },
  {
    aisle: 'Meat & Seafood',
    keywords: [
      'chicken', 'beef', 'pork', 'lamb', 'turkey', 'sausage', 'bacon',
      'ham', 'ground ', 'steak', 'ribs', 'brisket', 'tenderloin',
      'chop', 'meatball', 'shrimp', 'fish', 'salmon', 'tuna', 'cod',
      'tilapia', 'scallop', 'lobster', 'crab', 'mussel', 'oyster',
      'halibut', 'mahi', 'trout',
    ],
  },
  {
    aisle: 'Dairy & Eggs',
    keywords: [
      'milk', 'half and half', 'heavy cream', 'whipping cream', 'cream ',
      'butter', 'yogurt', 'sour cream', 'cheese', 'cheddar', 'mozzarella',
      'parmesan', 'cottage cheese', 'cream cheese', 'feta', 'ricotta',
      'gouda', 'gruyere', 'swiss', 'provolone', 'monterey jack', 'brie',
      'egg', 'eggs',
    ],
  },
  // Spices BEFORE Produce so "dried basil" / "ground cumin" don't get
  // routed to Produce by the basil/cumin keyword.
  {
    aisle: 'Spices & Condiments',
    keywords: [
      'dried ', 'ground ', 'powder', 'paprika', 'cumin', 'oregano',
      'bay leaves', 'bay leaf', 'cinnamon', 'nutmeg', 'allspice',
      'clove', 'cloves', 'cardamom', 'turmeric', 'curry powder',
      'garam masala', 'italian seasoning', 'old bay', 'lemon pepper',
      'garlic salt', 'seasoned salt', 'vanilla extract', 'vanilla',
      'ketchup', 'mustard', 'mayonnaise', 'mayo', 'hot sauce',
      'soy sauce', 'worcestershire', 'sriracha', 'salsa', 'salt',
      'pepper', 'peanut butter', 'jam', 'jelly', 'preserves', 'honey',
      'maple syrup',
    ],
  },
  {
    aisle: 'Produce',
    keywords: [
      'lettuce', 'romaine', 'spring mix', 'arugula', 'spinach', 'kale',
      'tomato', 'onion', 'garlic', 'apple', 'banana', 'orange', 'lemon',
      'lime', 'potato', 'sweet potato', 'carrot', 'celery', 'cucumber',
      'broccoli', 'mushroom', 'avocado', 'cilantro', 'parsley', 'basil',
      'thyme', 'rosemary', 'sage', 'mint', 'ginger', 'jalapeno',
      'jalapeño', 'scallion', 'green onion', 'leek', 'shallot',
      'asparagus', 'zucchini', 'squash', 'eggplant', 'cabbage',
      'cauliflower', 'corn', 'pea', 'green bean', 'snap pea', 'grape',
      'berry', 'berries', 'melon', 'peach', 'pear', 'plum', 'mango',
      'pineapple', 'kiwi', 'watermelon', 'cantaloupe', 'strawberry',
      'blueberry', 'raspberry', 'blackberry', 'cherry', 'pepper bell',
      'bell pepper', 'red pepper', 'green pepper', 'yellow pepper',
      'chili pepper', 'serrano', 'habanero', 'poblano',
    ],
  },
  {
    aisle: 'Pasta & Rice',
    keywords: [
      'pasta', 'rice', 'noodle', 'spaghetti', 'penne', 'macaroni',
      'quinoa', 'couscous', 'lasagna', 'fettuccine', 'linguine', 'orzo',
      'rigatoni', 'farfalle', 'ravioli', 'tortellini', 'angel hair',
      'rotini', 'ziti', 'gnocchi', 'risotto', 'wild rice',
    ],
  },
  {
    aisle: 'Baking & Pantry',
    keywords: [
      'flour', 'sugar', 'brown sugar', 'powdered sugar', 'baking powder',
      'baking soda', 'yeast', 'cocoa', 'chocolate chip', 'cornstarch',
      'corn starch', 'oats', 'oatmeal', 'olive oil', 'vegetable oil',
      'canola oil', 'oil', 'vinegar', 'bread crumb', 'breadcrumb', 'panko',
      'almond flour', 'coconut flour', 'shortening',
    ],
  },
  {
    aisle: 'Breakfast & Cereal',
    keywords: [
      'cereal', 'corn flakes', 'granola', 'pancake mix', 'waffle',
      'syrup', 'instant oatmeal',
    ],
  },
  {
    aisle: 'Snacks',
    keywords: [
      'chips', 'cracker', 'pretzel', 'popcorn', 'almond', 'walnut',
      'pecan', 'cashew', 'pistachio', 'trail mix', 'cookie', 'candy',
    ],
  },
  {
    aisle: 'Beverages',
    keywords: [
      'water', 'sparkling water', 'juice', 'soda', 'coffee', 'tea ',
      'wine', 'beer', 'kombucha', 'gatorade', 'lemonade', 'iced tea',
    ],
  },
  {
    aisle: 'Household',
    keywords: [
      'paper towel', 'toilet paper', 'dish soap', 'detergent',
      'trash bag', 'napkin', 'foil', 'plastic wrap', 'parchment',
      'aluminum foil', 'ziploc', 'storage bag',
    ],
  },
]

/**
 * Map an item text (e.g. "2 cups flour", "1 lb ground beef") to a
 * Publix-style aisle. Always returns one of AISLES_IN_STORE_ORDER.
 */
export function classifyAisle(text: string): string {
  const t = text.toLowerCase()
  for (const rule of AISLE_RULES) {
    for (const kw of rule.keywords) {
      if (t.includes(kw)) return rule.aisle
    }
  }
  return 'Other'
}

/**
 * Group a list of objects by aisle, returning them in
 * AISLES_IN_STORE_ORDER (empty aisles are skipped). Caller provides a
 * getText accessor so we don't bind to a specific item shape.
 */
export function groupByAisle<T>(items: T[], getText: (item: T) => string): Array<{ aisle: string; items: T[] }> {
  const buckets = new Map<string, T[]>()
  for (const it of items) {
    const aisle = classifyAisle(getText(it))
    const arr = buckets.get(aisle) ?? []
    arr.push(it)
    buckets.set(aisle, arr)
  }
  const out: Array<{ aisle: string; items: T[] }> = []
  for (const aisle of AISLES_IN_STORE_ORDER) {
    const arr = buckets.get(aisle)
    if (arr && arr.length > 0) out.push({ aisle, items: arr })
  }
  return out
}
