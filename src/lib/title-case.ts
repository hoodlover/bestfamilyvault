export function titleCaseWords(value: FormDataEntryValue | string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z][A-Za-z0-9']*/g, (word) => {
      if (word.length <= 5 && word === word.toUpperCase()) return word
      if (/[A-Z]/.test(word.slice(1))) return word.charAt(0).toUpperCase() + word.slice(1)
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
}
