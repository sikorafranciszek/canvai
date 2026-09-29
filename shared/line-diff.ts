/**
 * Diff liniowy (LCS) do porównania dwóch wersji DESIGN.md. Czysty moduł.
 *
 * Dokumenty mają setki linii, więc tablica O(n·m) jest akceptowalna; dla
 * skrajnie dużych wejść (> MAX_CELLS) zwracamy uproszczony diff „wszystko
 * usunięte / wszystko dodane”, zamiast blokować przeglądarkę.
 */

export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string }

const MAX_CELLS = 4_000_000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n')
  const b = after.replace(/\r\n?/g, '\n').split('\n')

  // Wspólny prefiks i sufiks — typowo większość dokumentu.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ type: 'same', text }))
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ type: 'same', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text) => ({ type: 'removed' as const, text })),
      ...midB.map((text) => ({ type: 'added' as const, text })),
      ...tail,
    ]
  }

  const n = midA.length
  const m = midB.length
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const middle: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ type: 'same', text: midA[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      middle.push({ type: 'removed', text: midA[i++] })
    } else {
      middle.push({ type: 'added', text: midB[j++] })
    }
  }
  while (i < n) middle.push({ type: 'removed', text: midA[i++] })
  while (j < m) middle.push({ type: 'added', text: midB[j++] })

  return [...head, ...middle, ...tail]
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'added') added++
    else if (line.type === 'removed') removed++
  }
  return { added, removed }
}
