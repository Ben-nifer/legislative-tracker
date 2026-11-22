// Longest interest phrase accepted from users (onboarding S4)
export const MAX_PHRASE_LENGTH = 80

// §3.2: lowercase, trim, collapse whitespace, strip punctuation.
// Punctuation becomes a space so "high-speed rail" and "high speed rail" share a cache row.
export function normalizePhrase(phrase: string): string {
  return phrase
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
