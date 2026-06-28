// Single source of truth for the tag string that flags a login as
// "include this on the printable emergency sheet". Plain module — NOT a
// 'use server' file — so server pages, client components, and server
// actions can all import the constant. Next.js 16 Turbopack rejects
// non-async exports from server-action files, which is why this lives
// here instead of inside src/lib/actions/emergency-sheet.ts.
export const EMERGENCY_SHEET_TAG = 'emergency-sheet'
