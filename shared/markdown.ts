/**
 * Minimalny parser markdown → drzewo bloków (czysty moduł, bez Reacta).
 *
 * Podgląd DESIGN.md renderuje to drzewo do elementów React — bez
 * `dangerouslySetInnerHTML`, więc treść pochodząca od modelu (a pośrednio od
 * użytkownika tablicy) nie może wstrzyknąć HTML-a. Obsługuje podzbiór, którego
 * używa DESIGN.md: nagłówki, akapity, listy, cytaty, tabele, bloki kodu, `---`,
 * oraz w tekście: **pogrubienie**, *kursywę*, `kod`, [link](http…) i [A<id>].
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'assetRef'; assetId: number }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; text: string }
  | { type: 'rule' }

const SAFE_HREF = /^https?:\/\//i

export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer })
    buffer = ''
  }

  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)

    // Escapowany znak (np. \| w tabeli).
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_[\]|#()-]/.test(rest[1])) {
      buffer += rest[1]
      i += 2
      continue
    }

    let m = rest.match(/^`([^`]+)`/)
    if (m) {
      flush()
      out.push({ type: 'code', text: m[1] })
      i += m[0].length
      continue
    }

    m = rest.match(/^\[A(\d+)\]/)
    if (m) {
      flush()
      out.push({ type: 'assetRef', assetId: Number(m[1]) })
      i += m[0].length
      continue
    }

    m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/)
    if (m) {
      flush()
      const children = parseInline(m[1])
      if (SAFE_HREF.test(m[2])) out.push({ type: 'link', href: m[2], children })
      else out.push(...children)
      i += m[0].length
      continue
    }

    m = rest.match(/^\*\*(.+?)\*\*/) ?? rest.match(/^__(.+?)__/)
    if (m) {
      flush()
      out.push({ type: 'strong', children: parseInline(m[1]) })
      i += m[0].length
      continue
    }

    m = rest.match(/^\*(?!\s)(.+?)\*/) ?? rest.match(/^_(?!\s)(.+?)_(?![\p{L}\d])/u)
    if (m && (i === 0 || !/[\p{L}\d]/u.test(source[i - 1]))) {
      flush()
      out.push({ type: 'em', children: parseInline(m[1]) })
      i += m[0].length
      continue
    }

    buffer += rest[0]
    i++
  }
  flush()
  return out
}

function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      current += '\\|'
      i++
    } else if (row[i] === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += row[i]
    }
  }
  cells.push(current.trim())
  return cells
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const isBlockStart = (line: string) =>
    /^(#{1,6})\s/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^```/.test(line) ||
    /^\s*(-{3,}|\*{3,})\s*$/.test(line) ||
    (line.trim().startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? ''))

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    if (/^```/.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      })
      i++
      continue
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    if (line.trim().startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      const header = splitRow(line).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]).map(parseInline))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: Inline[][] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(parseInline(lines[i].replace(/^>\s?/, '')))
        i++
      }
      blocks.push({ type: 'quote', children: quote })
      continue
    }

    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+/)
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1])
      const items: Inline[][] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
        if (!m || /\d/.test(m[1]) !== ordered) break
        items.push(parseInline(m[2]))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      (paragraph.length === 0 || !isBlockStart(lines[i]))
    ) {
      paragraph.push(lines[i].trim())
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
  }

  return blocks
}
