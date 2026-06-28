export interface ParsedCreditCardFields {
  cardNumber?: string
  expiryDate?: string
  cardholderName?: string
  cardNetwork?: string
  /** Claude-suggested entry title (e.g. "Chase Sapphire Mastercard - Lance").
   *  Filled into the Title field on scan; user can edit. */
  suggestedTitle?: string
}

export interface ParsedIdentityFields {
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  ssn?: string
  passport?: string
  driversLicense?: string
  /** Claude-suggested entry title (e.g. "Lance Cobb Driver's License").
   *  Filled into the Title field on scan; user can edit. */
  suggestedTitle?: string
}

export type OcrFieldKind = 'credit_card' | 'identity'

export interface ParsedOcrFields {
  creditCard?: ParsedCreditCardFields
  identity?: ParsedIdentityFields
  rawText?: string
}
