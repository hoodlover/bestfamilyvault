// Canonical "things we always buy" list for the Quick-Pick page
// (/meal-plan/quick-pick). Each category renders as its own section
// of checkboxes; ticked items + per-category specifics + bottom
// write-ins all become manual shoppingListItems in one shot.
//
// Order here is the order categories render on the page; items
// inside each are ordered roughly by how-often-they're-bought (the
// stuff up front being the obvious picks).

export interface StapleCategory {
  name: string
  items: string[]
}

export const GROCERY_STAPLES: StapleCategory[] = [
  {
    name: 'Produce',
    items: [
      'Bananas', 'apples', 'oranges', 'grapes', 'berries', 'avocados',
      'tomatoes', 'lettuce', 'spinach', 'broccoli', 'carrots', 'onions',
      'garlic', 'potatoes', 'peppers', 'cucumbers', 'celery',
      'lemons/limes', 'Iguana lettuce',
    ],
  },
  {
    name: 'Dairy & Eggs',
    items: [
      '1% milk', '2% milk', 'eggs', 'butter', 'cheddar cheese',
      'mozzarella', 'cream cheese', 'sour cream', 'yogurt', 'heavy cream',
      'parmesan',
    ],
  },
  {
    name: 'Meat & Seafood',
    items: [
      'chicken breast/thighs', 'ground beef', 'steak', 'pork chops',
      'bacon', 'sausage', 'salmon', 'shrimp',
    ],
  },
  {
    name: 'Bread & Bakery',
    items: [
      'potato bread', 'whole wheat', 'rolls/buns', 'tortillas',
      'English muffins', 'bagels', 'pita bread',
    ],
  },
  {
    name: 'Pantry / Dry Goods',
    items: [
      'pasta', 'rice', 'oats', 'flour', 'sugar', 'olive oil',
      'vegetable oil', 'canned tomatoes', 'pinto beans', 'black beans',
      'kidney beans', 'chicken broth', 'veg broth', 'beef broth',
      'crunchy pb', 'smooth pb', 'raspberry jelly', 'honey', 'soy sauce',
      'vinegar', 'hot sauce', 'salsa', 'pasta sauce', 'pizza sauce',
      'syrup', 'pancake mix',
    ],
  },
  {
    name: 'Frozen',
    items: [
      'frozen peas', 'broccoli', 'green beans', 'corn',
      'frozen strawberries', 'blueberries', 'mix',
      'chicken nuggets/tenders', 'pizza', 'ice cream', 'frozen meals',
      'edamame', 'vegetarian meat', 'Eggo waffles',
    ],
  },
  {
    name: 'Snacks',
    items: [
      'chips', 'crackers', 'pretzels', 'movie butter popcorn',
      'granola bars', 'nuts', 'trail mix', 'cookies', 'chocolate',
      'candy',
    ],
  },
  {
    name: 'Beverages',
    items: [
      'SBX coffee', 'sweet tea', 'orange juice', 'sparkling water',
      'diet coke', 'wine', 'beer', 'sports drinks', 'protein shakes',
    ],
  },
  {
    name: 'Condiments',
    items: [
      'ketchup', 'mustard', 'mayo', 'ranch', 'blue cheese',
      'italian salad dressing',
    ],
  },
  {
    name: 'Spices',
    items: [
      'salt', 'pepper', 'garlic powder', 'cumin', 'paprika',
      'Italian seasoning', 'cinnamon',
    ],
  },
  {
    name: 'Breakfast',
    items: [
      'Raisin Bran Crunch', 'Lucky Charms', 'instant oatmeal',
      'Quaker Oats',
    ],
  },
  {
    name: 'Baking',
    items: [
      'baking soda', 'sugar', 'baking powder', 'vanilla extract',
      'chocolate chips', 'cocoa powder', 'yeast', 'brown sugar',
      'powdered sugar',
    ],
  },
  {
    name: 'Household & Cleaning',
    items: [
      'paper towels', 'toilet paper', 'dish soap', 'laundry detergent',
      'trash bags', 'sponges', 'all-purpose cleaner', 'Ziploc bags',
      'aluminum foil', 'plastic wrap',
    ],
  },
  {
    name: 'Personal Care',
    items: [
      'shampoo', 'conditioner', 'body wash', 'deodorant', 'toothpaste',
      'toothbrushes', 'razors', 'lotion', 'face wash',
    ],
  },
  {
    name: 'Health & Medicine',
    items: [
      'vitamins', 'pain relievers', 'antacids', 'cold medicine',
      'bandages', 'hand sanitizer', 'feminine products',
    ],
  },
  {
    name: 'Pets',
    items: [
      'dog food', 'cat food', 'treats', 'litter',
    ],
  },
]
