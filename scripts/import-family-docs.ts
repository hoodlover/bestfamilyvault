// One-shot importer for the docs in
// C:\Users\lance\Documents\4625 Forest Place\Family Docs-CCs-Ins
//
// Behavior:
//   - Credit/debit cards become entries (type=credit_card) under
//     Finance > Credit Cards.
//   - Everything else becomes a private note under the right category /
//     subcategory, with the source image(s) attached as files.
//   - Each note's content is the OCR'd info I captured by reading the
//     image with the multimodal Read tool.
//   - All inserts are idempotent-by-title: if a note/entry with the same
//     title already exists for the same category, we skip it. Re-running
//     the script after fixing one item won't double up the rest.
//   - Everything is marked isPrivate=true (superuser-only). Lance can
//     un-private later if he wants to share with the kids.
//
// Run with: npx tsx --env-file=.env.local scripts/import-family-docs.ts
//
// Optional: pass --dry-run to log what would happen without writing.

import { neon } from '@neondatabase/serverless'
import { put } from '@vercel/blob'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { encrypt } from '../src/lib/crypto'

const dryRun = process.argv.includes('--dry-run')

const sql = neon(process.env.DATABASE_URL!)

const SOURCE_DIR = String.raw`C:\Users\lance\Documents\4625 Forest Place\Family Docs-CCs-Ins`

// ─── Identifiers (from prod DB, dumped by scripts/dump-id-targets.ts) ────
const LANCE_USER_ID = '8b207c90-4012-4a2b-9ee7-25f153494414'

const CAT = {
  finance: 'ddd7b570-61ab-4a30-852f-42a82e2d045c',
  kids: 'f9faf9a5-1dcf-4585-8704-e5c0ab471249',
  travel: '2f21fff9-f3cf-4208-9f9a-9d04a199a787',
  legal: '5fea496b-dcc8-4035-9e05-1512458b4ef9',
}
const SUB = {
  creditCards: '21d27b6b-6df4-446f-8716-a8821ea4a7ee',
  idDocuments: '41fa6962-74d1-4462-ae3d-87b387ffb04c',
  activities: 'b66b8619-8295-4a32-b429-73e8a5f2f543',
  passports: '201f65cc-5977-452f-8435-65333580126b',
  otherLegal: '141d9071-4d31-465a-a37b-a4669d3f4be2',
}

// ─── Manifest ────────────────────────────────────────────────────────────

interface CardItem {
  kind: 'card'
  title: string
  files: string[]
  cardholderName: string
  cardNumber: string
  /** Stored as MM/YY. */
  expiryDate: string | null
  cvv: string | null
  cardNetwork: string
  noteContent: string
}

interface NoteItem {
  kind: 'note'
  title: string
  categoryId: string
  subcategoryId: string | null
  content: string
  files: string[]
  tags?: string[]
}

type Item = CardItem | NoteItem

const items: Item[] = [
  // ─── Credit / debit cards ──────────────────────────────────────────────
  {
    kind: 'card',
    title: 'BOA Mastercard Debit (PTC LLC)',
    files: ['BOA MC Debit PTC Lance.jpg'],
    cardholderName: 'PATH TO CHANGE LLC / LANCE M COBB',
    cardNumber: '5348690002644928',
    expiryDate: '03/23',
    cvv: '658',
    cardNetwork: 'Mastercard',
    noteContent: [
      'Bank of America business debit card.',
      'Issued to Path to Change LLC; cardholder Lance M Cobb.',
      'Customer service: 1-888-287-4637 (1.888.BUSINESS).',
      'EXPIRED 03/23 — replace before re-using.',
    ].join('\n'),
  },
  {
    kind: 'card',
    title: 'Stash Visa Debit (Lance)',
    files: ['Stash Visa Lance.jpg'],
    cardholderName: 'LANCE COBB',
    cardNumber: '4240670101533638',
    expiryDate: '02/23',
    cvv: '680',
    cardNetwork: 'Visa Debit',
    noteContent: [
      'Stash debit card issued by Green Dot Bank.',
      'Linked to Stash investing account.',
      'Customer service: (800) 205-5164.',
      'EXPIRED 02/23.',
    ].join('\n'),
  },
  {
    kind: 'card',
    title: 'Synchrony Bank ATM (Heather)',
    files: ['Synchrony Bank Heather.jpg'],
    cardholderName: 'HEATHER COBB',
    cardNumber: '5176704187270507',
    expiryDate: null,
    cvv: null,
    cardNetwork: 'Accel / Plus (ATM)',
    noteContent: [
      'Synchrony Bank ATM card (no Visa/MC; ATM-only on Accel + Plus networks).',
      'Customer service: 1-866-226-5638.',
      'Card #: 2907339 (printed on card body).',
    ].join('\n'),
  },
  {
    kind: 'card',
    title: 'Target REDcard Credit (Lance)',
    files: ['Target Credit Lance.jpg'],
    cardholderName: 'LANCE COBB',
    cardNumber: '5859752139936899',
    expiryDate: '11/24',
    cvv: '734',
    cardNetwork: 'Mastercard (REDcard, TD Bank)',
    noteContent: [
      'Target REDcard credit, issued by TD Bank, USA, N.A.',
      'Cardholder since 2019.',
      'Manage account: Target.com/myREDcard',
      'EXPIRED 11/24.',
    ].join('\n'),
  },
  {
    kind: 'card',
    title: 'Target REDcard Debit (Lance)',
    files: ['Target Debit Lance.jpg'],
    cardholderName: 'LANCE COBB',
    cardNumber: '6394632251546496',
    expiryDate: '06/23',
    cvv: '124',
    cardNetwork: 'Target REDcard Debit',
    noteContent: [
      'Target REDcard debit, issued by Target Corporation.',
      'Cardholder since 2014.',
      'Customer service: 1-888-729-7331.',
      'EXPIRED 06/23.',
    ].join('\n'),
  },
  {
    kind: 'card',
    title: 'Tires Plus / CFNA (Lance)',
    files: ['Tire Plus Lance.jpg'],
    cardholderName: 'LANCE M COBB',
    cardNumber: '520425772',
    expiryDate: null,
    cvv: null,
    cardNetwork: 'CFNA (Tires Plus store card)',
    noteContent: [
      'Tires Plus store credit card issued by Credit First National Association (CFNA).',
      'Customer service: 1-800-321-3950.',
      'Returns: Credit First N.A., P.O. Box 81083, Cleveland, OH 44181-0083.',
      'No expiry / CVV printed (private-label store card).',
    ].join('\n'),
  },
  {
    kind: 'card',
    title: 'USAA Visa Signature (Heather)',
    files: ['USAA Visa Heather.jpg'],
    cardholderName: 'HEATHER B COBB',
    cardNumber: '4270825029437089',
    expiryDate: '12/23',
    cvv: '456',
    cardNetwork: 'Visa Signature',
    noteContent: [
      'USAA Visa Signature credit card, issued by USAA Savings Bank.',
      'Customer service: 800-531-9762.',
      'International collect: 1-210-282-8879.',
      'EXPIRED 12/23.',
    ].join('\n'),
  },

  // ─── Driver licenses + permits ─────────────────────────────────────────
  {
    kind: 'note',
    title: 'Driver License - Lance (current GA CDL)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: [
      'Drivers License GA DL Lance F&B.jpg',
      'Drivers License GA DL 10-18-2027 Lance.jpg',
      'Drivers License GA DL 10-18-2027 Lance Back.jpg',
      'Drivers License GA DL 10-18-2027 Lance Front Small.jpg',
      'Drivers License GA DL 10-18-2027 Lance Back Small.jpg',
    ],
    content: [
      'Georgia Commercial Driver\'s License — current.',
      '',
      'Name: Lance Michael Cobb',
      'DL #: 058259359',
      'Class: B (CDL)',
      'DOB: 10/18/1971',
      'Issued: 10/17/2019',
      'Expires: 10/18/2027',
      'Sex: M  Eyes: BLU  Hgt: 5\'-09"  Wgt: 310 lb',
      'Address: 4625 Forest Pl, Cumming, GA 30041-5944, Forsyth County',
      'DD: 396532124360049200',
      'Endorsements: P (16+ passengers), S (school bus)',
      'Restrictions: M (no class A passenger buses)',
      'Medical info: NONE',
    ].join('\n'),
    tags: ['id', 'driver-license', 'lance'],
  },
  {
    kind: 'note',
    title: 'Driver License - Lance (expired 2019)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Drivers License Lance DL Expired 10-19.jpg'],
    content: [
      'Georgia Commercial Driver\'s License — superseded by current 2027 DL.',
      '',
      'Name: Lance Michael Cobb',
      'DL #: 058259359',
      'Class: B (CDL)',
      'DOB: 10/18/1971',
      'Issued: 07/29/2015',
      'Expired: 10/18/2019',
      'Restrictions: M  Endorsements: PS',
      'Address: 4625 Forest Pl, Cumming, GA 30041-5944, Forsyth',
      'DD: 242407870510049200',
    ].join('\n'),
    tags: ['id', 'driver-license', 'lance', 'expired'],
  },
  {
    kind: 'note',
    title: 'Driver License - Heather (current)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Drivers License Heather DL Exp 12-2025.jpg'],
    content: [
      'Georgia Driver\'s License — current.',
      '',
      'Name: Heather Beth Cobb',
      'DL #: 058259388',
      'Class: C',
      'DOB: 12/05/1972',
      'Issued: 10/27/2017',
      'Expires: 12/05/2025',
      'Sex: F  Eyes: BLU  Hgt: 5\'-07"  Wgt: 140 lb',
      'Restrictions: A   End: NONE',
      'Address: 4625 Forest Pl, Cumming, GA 30041-5944, Forsyth',
      'DD: 324433940200015950',
    ].join('\n'),
    tags: ['id', 'driver-license', 'heather'],
  },
  {
    kind: 'note',
    title: 'Driver License - Heather (expired 2017)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Drivers License Heather Drivers License 2015 Expired 2017.jpg'],
    content: [
      'Georgia Driver\'s License — superseded by current 2025 DL.',
      '',
      'Name: Heather Beth Cobb',
      'DL #: 058259388',
      'Class: C',
      'DOB: 12/05/1972',
      'Issued: 10/05/2012',
      'Expired: 12/05/2017',
      'Donor.',
      'DD: 139723858870045950',
    ].join('\n'),
    tags: ['id', 'driver-license', 'heather', 'expired'],
  },
  {
    kind: 'note',
    title: 'Driver License - Tadan (provisional, expired 2019)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Driver License Tadan 2015 Expired 7-2019.jpg'],
    content: [
      'Georgia Provisional Driver\'s License (Under 21) — expired.',
      '',
      'Name: Tadan Michael Cobb',
      'DL #: 058870784',
      'Class: D',
      'DOB: 07/16/1998',
      'Issued: 01/09/2015',
      'Expired: 07/16/2019',
      'Sex: M  Eyes: BLU  Hgt: 5\'-07"  Wgt: 130 lb',
      'Restrictions: A   End: NONE',
      'Donor.',
      'DD: 222332929220041909',
    ].join('\n'),
    tags: ['id', 'driver-license', 'tadan', 'expired'],
  },
  {
    kind: 'note',
    title: 'Instructional Permit - Makenzie (expired 2023)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Makenzie Permit Expired.jpg'],
    content: [
      'Georgia DL Instructional Permit (Under 21) — expired.',
      '',
      'Name: Makenzie Narae Cobb',
      'DL #: 070053018',
      'Class: CP (Instructional Permit)',
      'DOB: 01/09/2006',
      'Issued: 02/27/2021',
      'Expired: 02/27/2023',
      'Sex: F  Eyes: BLU  Hgt: 5\'-07"  Wgt: 125 lb',
      'Restrictions: A   End: NONE',
      'Organ donor.',
      'DD: 446403886020000',
    ].join('\n'),
    tags: ['id', 'permit', 'makenzie', 'expired'],
  },
  {
    kind: 'note',
    title: 'Forsyth County Schools Transportation ID - Lance',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: [
      'Forsyth ID Lance Best Front.jpg',
      'Forsyth ID Lance Best Back.jpg',
      'Forsyth ID Lance Front.jpg',
    ],
    content: [
      'Forsyth County Schools Transportation badge.',
      '',
      'Name: Lance Cobb',
      'Card barcode: 100 16858 AWID26',
      'If found, return to: Forsyth County Schools, School Safety, 136 Elm St., Cumming, GA 30040 (770.888.3466).',
    ].join('\n'),
    tags: ['id', 'employer', 'lance'],
  },
  {
    kind: 'note',
    title: 'Georgia Weapons Carry License - Lance (expired 2023)',
    categoryId: CAT.legal,
    subcategoryId: SUB.otherLegal,
    files: [
      'GA Carry Lance.jpg',
      'GA Carry Lance 6-12-23.jpg',
      'GA Carry Lance 6-12-23 Back.jpg',
    ],
    content: [
      'Georgia Weapons Carry License — expired, renew at Forsyth County Probate Court.',
      '',
      'Name: Lance Michael Cobb',
      'License #: F0581802363',
      'DOB: 10/18/1971',
      'Sex: M  Eyes: BLUE  Hgt: 5.09  Wgt: 325',
      'Issued: 06/13/2018',
      'Expired: 06/12/2023',
      'County: 058 (Forsyth)',
      'Issuing court: Forsyth County Probate Court, 100 W. Courthouse Sq, Ste 008, Cumming, GA 30040.',
      'Probate Judge: Lynwood D. Jordan, Jr.',
    ].join('\n'),
    tags: ['carry-permit', 'lance', 'expired'],
  },

  // ─── Birth certificates ────────────────────────────────────────────────
  {
    kind: 'note',
    title: 'Birth Certificate - Lance',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Birth Certificate Lance Original.jpg'],
    content: [
      'State of Washington Certificate of Live Birth (Seattle/King County).',
      '',
      'Name: Lance Michael Cobb',
      'DOB: 10-18-71  Time: 2:26 AM',
      'Sex: Male  Single birth',
      'Place of birth: Group Health Hospital, Seattle, King County, WA',
      'Mother: Marcheta Rae Weaver — age 24, born Minnesota, residence 15913 23rd SW, King County, WA',
      'Father: Larry Michael Cobb — age 27, born Washington',
      'Informant: Marcheta Rae Cobb (mother)',
      'Attendants: A. Hacar, M.D. and G.D. Lehman, M.D.',
      'Date received: Dec 3 1971',
      'File #: 15506',
      'Certified copy issued: Aug 1 1977 (Seattle-King County Registrar)',
    ].join('\n'),
    tags: ['birth-certificate', 'lance'],
  },
  {
    kind: 'note',
    title: 'Birth Certificate - Tadan',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Birth Certificate Tadan.jpg'],
    content: [
      'Commonwealth of Pennsylvania Certification of Birth.',
      '',
      'Name: Tadan Michael Cobb',
      'DOB: 07-16-1998',
      'Sex: Male',
      'County of birth: Montgomery, PA',
      'Father: Lance Michael Cobb',
      'Mother\'s maiden name: Heather Beth Kane',
      'File #: 3569460-1998',
      'Date filed: 07-28-1998',
      'Date issued: 07-29-1998',
      'State Registrar: Charles Hardester',
    ].join('\n'),
    tags: ['birth-certificate', 'tadan'],
  },
  {
    kind: 'note',
    title: 'Birth Certificate - Sydney',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Birth Certificate Sydney.jpg'],
    content: [
      'Commonwealth of Pennsylvania Certification of Birth.',
      '',
      'Name: Sydney Elise Cobb',
      'DOB: 09-21-2001',
      'Sex: Female',
      'County of birth: Montgomery, PA',
      'Father: Lance Michael Cobb',
      'Mother\'s maiden name: Heather Beth Kane',
      'File #: 3923430-2001',
      'Date filed: 09-24-2001',
      'Date issued: 09-26-2001',
      'State Registrar: Charles Hardester',
      'Secretary of Health: Robert S. Zimmerman, Jr., MPH',
    ].join('\n'),
    tags: ['birth-certificate', 'sydney'],
  },
  {
    kind: 'note',
    title: 'Birth Certificate - Makenzie',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: [
      'Birth Certificate Makenzie Original.jpg',
      'Birth Certificate Makenzie Certified Copy.jpeg',
    ],
    content: [
      'Commonwealth of Pennsylvania Certification of Birth.',
      '',
      'Name: Makenzie Narae Cobb',
      'DOB: January 9, 2006',
      'Sex: Female',
      'County of birth: Montgomery, PA',
      'Father: Lance Michael Cobb',
      'Mother\'s maiden name: Heather Beth Kane',
      'File #: 003573-2006',
      'Date filed: January 18, 2006',
      'Date issued: January 26, 2006',
      'State Registrar: Charles Hardester',
      'Document control: 087141',
    ].join('\n'),
    tags: ['birth-certificate', 'makenzie'],
  },
  {
    kind: 'note',
    title: 'Birth Certificate - Paiton',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: [
      'Birth Certificate Paiton Original.jpg',
      'Birth Certificate Paiton Certified Copy.jpg',
    ],
    content: [
      'Commonwealth of Pennsylvania Certification of Birth.',
      '',
      'Name: Paiton Grace Cobb',
      'DOB: December 17, 2007',
      'Sex: Female',
      'County of birth: Montgomery, PA',
      'Father: Lance Michael Cobb',
      'Mother\'s maiden name: Heather Beth Kane',
      'File #: 143236-2007',
      'Date filed: December 26, 2007',
      'Date issued: December 27, 2007',
      'State Registrar: Frank Yeropoli',
      'Secretary of Health: Calvin B. Johnson, M.D., M.P.H.',
    ].join('\n'),
    tags: ['birth-certificate', 'paiton'],
  },
  {
    kind: 'note',
    title: 'Birth Registration Notice - Heather',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Birth Notice Heather.jpg'],
    content: [
      'Commonwealth of Pennsylvania, Department of Health Birth Registration Notice.',
      '',
      'Name: Heather Beth Kane',
      'DOB: December 5, 1972',
      'Sex: Female',
      'Place of birth: Lansdale, PA',
      'Father: James Houghton Kane',
      'Mother\'s maiden name: Nancy Doris Osterman',
      'Filed at: North Wales, PA',
      'Registered #: 797',
      '',
      'Note: this is the Birth Registration Notice (not a certified birth certificate).',
    ].join('\n'),
    tags: ['birth-certificate', 'heather'],
  },

  // ─── Passports ─────────────────────────────────────────────────────────
  {
    kind: 'note',
    title: 'Passport - Heather (active, exp 2029)',
    categoryId: CAT.travel,
    subcategoryId: SUB.passports,
    files: ['Passport Heather Exp Feb 2029.jpg'],
    content: [
      'US Passport — current.',
      '',
      'Name: Heather Beth Cobb',
      'Passport #: 589641724',
      'DOB: 05 Dec 1972',
      'Place of birth: Pennsylvania, U.S.A.',
      'Sex: F',
      'Issued: 01 Mar 2019',
      'Expires: 28 Feb 2029',
      'Authority: United States Department of State',
    ].join('\n'),
    tags: ['passport', 'heather'],
  },
  {
    kind: 'note',
    title: 'Passport - Lance (expired 2021)',
    categoryId: CAT.travel,
    subcategoryId: SUB.passports,
    files: ['Passport Lance Expiored 6-21.jpg'],
    content: [
      'US Passport — EXPIRED.',
      '',
      'Name: Lance Michael Cobb',
      'Passport #: 479961018',
      'DOB: 02 Jun 1971',
      'Place of birth: Washington, U.S.A.',
      'Sex: M',
      'Issued: 02 Jun 2011',
      'Expired: ~06/2021',
      'Authority: United States Department of State',
      '',
      'Note: passport expired in 2021 — needs renewal before international travel.',
    ].join('\n'),
    tags: ['passport', 'lance', 'expired'],
  },
  {
    kind: 'note',
    title: 'Passport - Paiton (active, exp 2027)',
    categoryId: CAT.travel,
    subcategoryId: SUB.passports,
    files: ['Passport Paiton Exp 4.2027.jpg'],
    content: [
      'US Passport — current.',
      '',
      'Name: Paiton Grace Cobb',
      'Passport #: A05891293',
      'DOB: 17 Dec 2007',
      'Place of birth: Pennsylvania, U.S.A.',
      'Sex: F',
      'Issued: 22 Apr 2022',
      'Expires: 21 Apr 2027',
      'Authority: United States Department of State',
    ].join('\n'),
    tags: ['passport', 'paiton'],
  },
  {
    kind: 'note',
    title: 'Passport - Sydney (expired 2018)',
    categoryId: CAT.travel,
    subcategoryId: SUB.passports,
    files: ['Passport Sydney Expired  2018.jpg'],
    content: [
      'US Passport — EXPIRED.',
      '',
      'Name: Sydney Elise Cobb',
      'Passport #: 511550600',
      'DOB: 21 Sep 2001',
      'Place of birth: Pennsylvania, U.S.A.',
      'Sex: F',
      'Issued: 06 Aug 2013',
      'Expired: 05 Aug 2018',
      'Authority: United States Department of State',
    ].join('\n'),
    tags: ['passport', 'sydney', 'expired'],
  },
  {
    kind: 'note',
    title: 'Passport - Tadan (expired 2018)',
    categoryId: CAT.travel,
    subcategoryId: SUB.passports,
    files: ['Passport Tadan Expired 2018.jpg'],
    content: [
      'US Passport — EXPIRED.',
      '',
      'Name: Tadan Michael Cobb',
      'Passport #: 511550599',
      'DOB: 14 Jul 1998',
      'Place of birth: Pennsylvania, U.S.A.',
      'Sex: M',
      'Issued: 06 Aug 2013',
      'Expired: 05 Aug 2018',
      'Authority: United States Department of State',
    ].join('\n'),
    tags: ['passport', 'tadan', 'expired'],
  },

  // ─── SSN cards ─────────────────────────────────────────────────────────
  {
    kind: 'note',
    title: 'SSN Card - Lance',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['SSN Lance.jpg'],
    content: [
      'Social Security card.',
      '',
      'Name: Lance Michael Cobb',
      'SSN: 535-90-1549',
      'Card signed: 02/04/2008',
    ].join('\n'),
    tags: ['ssn', 'lance'],
  },
  {
    kind: 'note',
    title: 'SSN Card - Heather (issued as Heather B Kane)',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['SSN Heather.jpg'],
    content: [
      'Social Security card.',
      '',
      'Name on card: Heather B Kane (maiden name; same SSN since marriage).',
      'SSN: 181-52-4539',
    ].join('\n'),
    tags: ['ssn', 'heather'],
  },
  {
    kind: 'note',
    title: 'SSN Card - Tadan',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['SSN Tadan.jpg'],
    content: [
      'Social Security card.',
      '',
      'Name: Tadan Michael Cobb',
      'SSN: 174-78-1764',
      'Card signed: 01/03/2008',
    ].join('\n'),
    tags: ['ssn', 'tadan'],
  },
  {
    kind: 'note',
    title: 'SSN Card - Sydney',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['SSN Sydney.jpg'],
    content: [
      'Social Security card.',
      '',
      'Name: Sydney Elise Cobb',
      'SSN: 178-80-9159',
    ].join('\n'),
    tags: ['ssn', 'sydney'],
  },
  {
    kind: 'note',
    title: 'SSN Card - Makenzie',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['SSN Makenzie.jpg'],
    content: [
      'Social Security card.',
      '',
      'Name: Makenzie Narae Cobb',
      'SSN: 203-82-4353',
    ].join('\n'),
    tags: ['ssn', 'makenzie'],
  },
  {
    kind: 'note',
    title: 'SSN Card - Paiton',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['SSN Paiton.jpg'],
    content: [
      'Social Security card.',
      '',
      'Name: Paiton Grace Cobb',
      'SSN: 185-84-7984',
      'Card signed: 01/03/2008',
    ].join('\n'),
    tags: ['ssn', 'paiton'],
  },

  // ─── Misc ──────────────────────────────────────────────────────────────
  {
    kind: 'note',
    title: 'Marriage License - Lance & Heather',
    categoryId: CAT.legal,
    subcategoryId: SUB.otherLegal,
    files: ['Marriage License Lance Heather.jpg'],
    content: [
      'Original Certificate of Marriage.',
      '',
      'Husband: Lance Michael Cobb',
      'Wife: Heather Beth Kane',
      'Date: August 19, 1995',
      'Place: Collegeville, Pennsylvania',
      'Officiant: Rev. Dennis W. Roberts',
      'License from: Clerk of the Orphans\' Court of Montgomery County, PA',
      'License #: 262508',
    ].join('\n'),
    tags: ['marriage-license', 'legal'],
  },
  {
    kind: 'note',
    title: 'PADI Open Water Diver Cert - Makenzie',
    categoryId: CAT.kids,
    subcategoryId: SUB.activities,
    files: ['Makenzie PADI Scuba License.jpg'],
    content: [
      'PADI Open Water Diver certification.',
      '',
      'Name: Makenzie Cobb',
      'Diver No.: 21060C5438',
      'DOB: 09-Jan-2006',
      'Cert Date: 17-Jun-2021',
      'Instructor No.: OWSI-294859  (Michael P. Waters #2106)',
      'Cert agency: Aquatic Safaris, 7220 Wrightsville Ave Ste A, Wilmington NC 28403  (910-392-4386)',
      '',
      'Meets ISO 24801-2: Diver Level 2 — Autonomous Diver Standard.',
    ].join('\n'),
    tags: ['certification', 'scuba', 'makenzie'],
  },
  {
    kind: 'note',
    title: 'ID Info Page - Lance',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Info Page Lance.jpg'],
    content: 'Combined identity summary page (birth cert, SSN, DL, passport) for Lance Michael Cobb. See individual notes for full detail per document.',
    tags: ['info-page', 'lance'],
  },
  {
    kind: 'note',
    title: 'ID Info Page - Tadan',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Info Page Tadan.jpg'],
    content: 'Combined identity summary page (birth cert, SSN, DL, passport) for Tadan Michael Cobb. See individual notes for full detail per document.',
    tags: ['info-page', 'tadan'],
  },
  {
    kind: 'note',
    title: 'ID Info Page - Sydney',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Info Page Sydney.jpg'],
    content: 'Combined identity summary page (birth cert, SSN, passport) for Sydney Elise Cobb. See individual notes for full detail per document.',
    tags: ['info-page', 'sydney'],
  },
  {
    kind: 'note',
    title: 'ID Info Page - Makenzie',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Info Page Makenzie.jpg'],
    content: 'Combined identity summary page (birth cert, SSN, permit) for Makenzie Narae Cobb. See individual notes for full detail per document.',
    tags: ['info-page', 'makenzie'],
  },
  {
    kind: 'note',
    title: 'ID Info Page - Paiton',
    categoryId: CAT.kids,
    subcategoryId: SUB.idDocuments,
    files: ['Info Page Paiton.jpg'],
    content: 'Combined identity summary page (birth cert, SSN, passport) for Paiton Grace Cobb. See individual notes for full detail per document.',
    tags: ['info-page', 'paiton'],
  },
]

// ─── Importer ────────────────────────────────────────────────────────────

interface Existing {
  cardTitles: Set<string>
  noteTitles: Set<string>
}

async function loadExisting(): Promise<Existing> {
  const cards = (await sql`
    SELECT title FROM entry
    WHERE created_by = ${LANCE_USER_ID} AND type = 'credit_card' AND category_id = ${CAT.finance}
  `) as Array<{ title: string }>
  const notes = (await sql`
    SELECT title FROM note WHERE created_by = ${LANCE_USER_ID}
  `) as Array<{ title: string }>
  return {
    cardTitles: new Set(cards.map((r) => r.title)),
    noteTitles: new Set(notes.map((r) => r.title)),
  }
}

async function uploadOne(filePath: string, ownerLabel: string) {
  const buf = await readFile(filePath)
  const filename = path.basename(filePath)
  const blobPath = `vault/${LANCE_USER_ID}/${Date.now()}-${ownerLabel}-${filename}`
  const out = await put(blobPath, buf, {
    access: 'private',
    contentType: filename.toLowerCase().endsWith('.jpeg') || filename.toLowerCase().endsWith('.jpg')
      ? 'image/jpeg'
      : 'application/octet-stream',
    allowOverwrite: true,
  })
  const size = (await stat(filePath)).size
  return { url: out.url, filename, size, contentType: 'image/jpeg' }
}

async function attachFiles(item: Item, target: { entryId?: string; noteId?: string; categoryId?: string | null }) {
  for (const fileRef of item.files) {
    const fsPath = path.join(SOURCE_DIR, fileRef)
    const ownerLabel = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    if (dryRun) {
      console.log(`    would upload ${fileRef}`)
      continue
    }
    const blob = await uploadOne(fsPath, ownerLabel)
    const id = randomUUID()
    await sql`
      INSERT INTO file (id, entry_id, note_id, category_id, filename, blob_url, content_type, size, is_private, uploaded_by)
      VALUES (
        ${id},
        ${target.entryId ?? null},
        ${target.noteId ?? null},
        ${target.categoryId ?? null},
        ${blob.filename},
        ${blob.url},
        ${blob.contentType},
        ${blob.size},
        ${true},
        ${LANCE_USER_ID}
      )
    `
    console.log(`    + attached ${blob.filename}`)
  }
}

async function importCard(item: CardItem, existing: Existing) {
  if (existing.cardTitles.has(item.title)) {
    console.log(`SKIP card "${item.title}" (already exists)`)
    return
  }
  console.log(`CARD ${item.title}`)
  if (dryRun) {
    console.log('    would insert + attach', item.files.length, 'file(s)')
    return
  }
  const id = randomUUID()
  const noteCipher = encrypt(item.noteContent) ?? item.noteContent
  await sql`
    INSERT INTO entry (id, category_id, subcategory_id, type, title, cardholder_name, card_number, expiry_date, cvv, card_network, note_content, is_private, is_personal, created_by, updated_by)
    VALUES (
      ${id},
      ${CAT.finance},
      ${SUB.creditCards},
      'credit_card',
      ${item.title},
      ${item.cardholderName},
      ${item.cardNumber},
      ${item.expiryDate},
      ${item.cvv},
      ${item.cardNetwork},
      ${noteCipher},
      ${true},
      ${false},
      ${LANCE_USER_ID},
      ${LANCE_USER_ID}
    )
  `
  await attachFiles(item, { entryId: id, categoryId: CAT.finance })
}

async function importNote(item: NoteItem, existing: Existing) {
  if (existing.noteTitles.has(item.title)) {
    console.log(`SKIP note "${item.title}" (already exists)`)
    return
  }
  console.log(`NOTE ${item.title}`)
  if (dryRun) {
    console.log('    would insert + attach', item.files.length, 'file(s)')
    return
  }
  const id = randomUUID()
  const cipher = encrypt(item.content) ?? item.content
  await sql`
    INSERT INTO note (id, category_id, subcategory_id, title, content, tags, is_private, is_personal, created_by, updated_by)
    VALUES (
      ${id},
      ${item.categoryId},
      ${item.subcategoryId},
      ${item.title},
      ${cipher},
      ${item.tags ?? null},
      ${true},
      ${false},
      ${LANCE_USER_ID},
      ${LANCE_USER_ID}
    )
  `
  await attachFiles(item, { noteId: id, categoryId: item.categoryId })
}

async function run() {
  console.log(dryRun ? '== DRY RUN ==' : '== IMPORTING ==')
  const existing = await loadExisting()
  let cards = 0, notes = 0, skipped = 0
  for (const item of items) {
    const before = existing.cardTitles.size + existing.noteTitles.size
    if (item.kind === 'card') {
      if (existing.cardTitles.has(item.title)) skipped++
      else { await importCard(item, existing); cards++ }
    } else {
      if (existing.noteTitles.has(item.title)) skipped++
      else { await importNote(item, existing); notes++ }
    }
    void before
  }
  console.log(`\nDone. cards=${cards} notes=${notes} skipped=${skipped}`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
