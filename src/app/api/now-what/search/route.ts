import { searchVault } from '@/lib/actions/entries'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  if (query.length < 2) return Response.json({ results: [] })

  let found: Awaited<ReturnType<typeof searchVault>>
  try {
    found = await searchVault(query)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not search the vault.'
    const status = message === 'Unauthorized' ? 401 : 500
    return Response.json({ error: message }, { status })
  }
  // Files surface twice — once as a "File" result that links to the
  // parent (entry/note/category) so the answer reads as a meaningful
  // pointer, and the detail line shows the filename. This is what
  // Lance was missing when he tried to attach the 2025 1040 to a tax
  // answer — searching "1040" would match the file by name, and
  // picking the result puts the right entry/note link into the answer.
  const fileResults = found.files
    .filter((f) => f.parentHref) // skip files whose parent the user can't see
    .map((f) => ({
      id: `file:${f.id}`,
      kind: 'File',
      title: f.parentLabel || f.filename,
      detail: f.filename,
      href: f.parentHref!,
    }))

  const results = [
    ...found.entries.map((entry) => ({
      id: entry.id,
      kind: formatKind(entry.type),
      title: entry.title,
      detail: entry.username || entry.url || null,
      href: `/entries/${entry.id}`,
    })),
    ...found.notes.map((note) => ({
      id: note.id,
      kind: 'Note',
      title: note.title,
      detail: note.content ? firstLine(note.content) : null,
      href: `/notes/${note.id}`,
    })),
    ...fileResults,
  ].slice(0, 12)

  return Response.json({ results })
}

function formatKind(type: string): string {
  if (type === 'login') return 'Password'
  if (type === 'bank_account') return 'Bank account'
  if (type === 'credit_card') return 'Credit card'
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function firstLine(content: string): string | null {
  const line = content.split('\n').map((item) => item.trim()).find(Boolean)
  if (!line) return null
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}
