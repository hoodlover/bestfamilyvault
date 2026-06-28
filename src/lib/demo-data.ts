// Single source of truth for the demo dataset. Both scripts/seed-demo.ts (run
// locally to populate a fresh demo DB) and the Vercel cron at
// /api/cron/reset-demo (which wipes + re-seeds on a schedule) import from
// here. Keeping the data in one place stops the two paths from drifting and
// flickering between datasets after every cron tick.
//
// All credentials below are FAKE. The CC numbers are the standard test card
// numbers Stripe / docs use that don't belong to any real card.

export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS = [
  { email: 'demo@bestfamilyvault.app', name: 'Demo Owner', role: 'superuser' as const },
  { email: 'parent@bestfamilyvault.app', name: 'Demo Parent', role: 'admin' as const },
  { email: 'kid1@bestfamilyvault.app', name: 'Demo Kid 1', role: 'member' as const },
  { email: 'kid2@bestfamilyvault.app', name: 'Demo Kid 2', role: 'member' as const },
  { email: 'guest@bestfamilyvault.app', name: 'Demo Guest', role: 'readonly' as const },
]

export const CATEGORIES = [
  { slug: 'family', name: 'Family', icon: '👨‍👩‍👧‍👦', sortOrder: 0 },
  { slug: 'banking', name: 'Banking', icon: '🏦', sortOrder: 1 },
  { slug: 'streaming', name: 'Streaming', icon: '🎬', sortOrder: 2 },
  { slug: 'shopping', name: 'Shopping', icon: '🛒', sortOrder: 3 },
  { slug: 'email', name: 'Email', icon: '📧', sortOrder: 4 },
  { slug: 'utilities', name: 'Utilities', icon: '⚡', sortOrder: 5 },
  { slug: 'travel', name: 'Travel', icon: '✈️', sortOrder: 6 },
]

export type DemoEntry = {
  category: string
  type: 'login' | 'bank_account' | 'credit_card' | 'identity'
  title: string
  username?: string
  password?: string
  url?: string
  noteContent?: string
  bankName?: string
  accountType?: string
  accountNumber?: string
  routingNumber?: string
  cardholderName?: string
  cardNumber?: string
  expiryDate?: string
  cvv?: string
  cardNetwork?: string
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  ssn?: string
  isFavorite?: boolean
  // For demonstrating the merge feature: entries with the same mergeKey will
  // be merged into a group during seeding.
  mergeKey?: string
}

export const ENTRIES: DemoEntry[] = [
  // Streaming — merged group example
  { category: 'streaming', type: 'login', title: 'Netflix', username: 'demo.parent@example.com', password: 'NotARealPassword!23', url: 'https://www.netflix.com', isFavorite: true, mergeKey: 'netflix' },
  { category: 'streaming', type: 'login', title: 'Netflix (Kid 1)', username: 'demo.kid1@example.com', password: 'KidPassword2024', url: 'https://www.netflix.com', mergeKey: 'netflix' },
  { category: 'streaming', type: 'login', title: 'Netflix (Kid 2)', username: 'demo.kid2@example.com', password: 'KidsRule99', url: 'https://www.netflix.com', mergeKey: 'netflix' },
  { category: 'streaming', type: 'login', title: 'Disney+', username: 'demo.parent@example.com', password: 'MagicalKingdom!7', url: 'https://www.disneyplus.com' },
  { category: 'streaming', type: 'login', title: 'Spotify', username: 'demo.parent@example.com', password: 'SoundOfMusic!22', url: 'https://www.spotify.com', isFavorite: true },
  { category: 'streaming', type: 'login', title: 'Hulu', username: 'demo.parent@example.com', password: 'StreamLater42', url: 'https://www.hulu.com' },
  { category: 'streaming', type: 'login', title: 'YouTube Premium', username: 'demo.parent@example.com', password: 'WatchAndChill19', url: 'https://www.youtube.com' },

  // Shopping — merged group
  { category: 'shopping', type: 'login', title: 'Amazon', username: 'demo.parent@example.com', password: 'PrimeMember2024', url: 'https://www.amazon.com', isFavorite: true, mergeKey: 'amazon' },
  { category: 'shopping', type: 'login', title: 'Amazon (Kid 1)', username: 'demo.kid1@example.com', password: 'WishList2024', url: 'https://www.amazon.com', mergeKey: 'amazon' },
  { category: 'shopping', type: 'login', title: 'Target', username: 'demo.parent@example.com', password: 'RedCircle99', url: 'https://www.target.com' },
  { category: 'shopping', type: 'login', title: 'Walmart', username: 'demo.parent@example.com', password: 'EverydayLow8', url: 'https://www.walmart.com' },
  { category: 'shopping', type: 'login', title: 'Costco', username: 'demo.parent@example.com', password: 'BulkBuy500', url: 'https://www.costco.com' },

  // Email — merged group
  { category: 'email', type: 'login', title: 'Gmail', username: 'demo.parent@example.com', password: 'GoogleAcct123!', url: 'https://accounts.google.com', isFavorite: true, mergeKey: 'gmail' },
  { category: 'email', type: 'login', title: 'Gmail (Kid 1)', username: 'demo.kid1@example.com', password: 'KidsGmail2024', url: 'https://accounts.google.com', mergeKey: 'gmail' },
  { category: 'email', type: 'login', title: 'Gmail (Kid 2)', username: 'demo.kid2@example.com', password: 'KidsGmail2025', url: 'https://accounts.google.com', mergeKey: 'gmail' },
  { category: 'email', type: 'login', title: 'Outlook', username: 'demo.parent@example.com', password: 'OutlookFTW!7', url: 'https://outlook.live.com' },

  // Banking
  { category: 'banking', type: 'bank_account', title: 'Demo Family Checking', bankName: 'First National Demo Bank', accountType: 'Checking', accountNumber: '1234567890', routingNumber: '021000021', noteContent: 'Joint account, primary household checking.', isFavorite: true },
  { category: 'banking', type: 'bank_account', title: 'Demo Family Savings', bankName: 'First National Demo Bank', accountType: 'Savings', accountNumber: '9876543210', routingNumber: '021000021' },
  { category: 'banking', type: 'credit_card', title: 'Demo Visa Rewards', cardholderName: 'Demo Parent', cardNetwork: 'Visa', cardNumber: '4111-1111-1111-1111', expiryDate: '12/28', cvv: '123', noteContent: 'This is a fake test card number, not a real card.' },
  { category: 'banking', type: 'credit_card', title: 'Demo Amex', cardholderName: 'Demo Parent', cardNetwork: 'Amex', cardNumber: '3782-822463-10005', expiryDate: '06/27', cvv: '1234' },

  // Family / Identity
  { category: 'family', type: 'identity', title: "Demo Kid 1's Identity", firstName: 'Demo', lastName: 'Kid One', dateOfBirth: '07/15/2010', ssn: '123-45-6789', noteContent: 'All values fake — example only.' },
  { category: 'family', type: 'identity', title: "Demo Kid 2's Identity", firstName: 'Demo', lastName: 'Kid Two', dateOfBirth: '03/22/2013', ssn: '987-65-4321' },
  { category: 'family', type: 'login', title: 'Family Cloud Photos', username: 'demo.family@example.com', password: 'OurMemories2024', url: 'https://photos.example.com', isFavorite: true },

  // Utilities
  { category: 'utilities', type: 'login', title: 'Power Company', username: 'demo.parent@example.com', password: 'PowerMe!42', url: 'https://www.example-power.com' },
  { category: 'utilities', type: 'login', title: 'Internet (Demo Cable)', username: 'demo.parent@example.com', password: 'FastInternet8', url: 'https://www.example-cable.com' },
  { category: 'utilities', type: 'login', title: 'Water Utility', username: 'demo.parent@example.com', password: 'H2OAccount99', url: 'https://www.example-water.com' },

  // Travel
  { category: 'travel', type: 'login', title: 'Delta SkyMiles', username: 'demo.parent@example.com', password: 'FlyAway2024!', url: 'https://www.delta.com' },
  { category: 'travel', type: 'login', title: 'Marriott Bonvoy', username: 'demo.parent@example.com', password: 'StayLonger55', url: 'https://www.marriott.com' },
  { category: 'travel', type: 'login', title: 'Airbnb', username: 'demo.parent@example.com', password: 'TravelSmart!8', url: 'https://www.airbnb.com' },
]

export const NOTES = [
  {
    category: 'family',
    title: 'WiFi Password',
    content: 'Network: DemoFamilyWiFi\nPassword: SecretWifi2024!\n\nGuest network: DemoGuest / GuestPass99',
    isFavorite: true,
  },
  {
    category: 'family',
    title: 'Emergency Contacts',
    content:
      'Pediatrician: Dr. Smith — (555) 010-2030\nVet: Animal Care Demo — (555) 010-4050\nNeighbor (Jenny): (555) 010-6070\n\nAfter-hours line: 1-800-DEMO-911',
  },
  {
    category: 'travel',
    title: 'Passport Numbers',
    content:
      'Demo Parent: AB1234567 (exp 2030-05-12)\nDemo Kid 1: CD7654321 (exp 2029-08-04)\nDemo Kid 2: EF1122334 (exp 2031-02-19)\n\nAll numbers are fake examples.',
  },
  {
    category: 'utilities',
    title: 'Garage Code & Alarm',
    content: 'Garage keypad: 1234\nAlarm system: 5678 (master), 4321 (guest)\n\nReset code if needed: 0000',
  },
]
