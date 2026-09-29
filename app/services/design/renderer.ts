import {
  SECTION_KEYS,
  SECTION_TITLES,
  type ComposedSections,
  type SectionKey,
} from '#services/ai/types'

/**
 * Składanie DESIGN.md z siedmiu sekcji modelu + sekcji 8 (źródła), którą
 * generuje KOD na podstawie odwołań `[A<id>]` — model nie ma jak jej „zmyślić”.
 * Czysty moduł, testowany unitowo.
 */

export interface SourceAsset {
  id: number
  filename: string
  kind: string
  userNote: string | null
}

export interface RenderMeta {
  boardTitle: string
  version: number
  model: string
  promptVersion: string
  generatedAt: string
}

export interface SourceRow {
  assetId: number
  filename: string
  kind: string
  sections: number[]
}

/** Sekcje, w których twierdzenia MUSZĄ być ugruntowane w assetach. */
const SECTIONS_REQUIRING_SOURCES: SectionKey[] = ['overview', 'screens', 'tokens']

const REF_PATTERN = /\[A(\d+)\]/g

export function findAssetRefs(markdown: string): number[] {
  const ids = new Set<number>()
  for (const match of markdown.matchAll(REF_PATTERN)) ids.add(Number(match[1]))
  return [...ids]
}

/**
 * Kontrola jakości ugruntowania. Zwraca listę problemów (pusta = OK):
 * odwołania do nieistniejących assetów i sekcje bez żadnego źródła.
 */
export function checkGrounding(sections: ComposedSections, allowedIds: number[]): string[] {
  const allowed = new Set(allowedIds)
  const errors: string[] = []

  for (const key of SECTION_KEYS) {
    const refs = findAssetRefs(sections[key])
    const unknown = refs.filter((id) => !allowed.has(id))
    if (unknown.length > 0) {
      errors.push(
        `Sekcja „${SECTION_TITLES[key]}” odwołuje się do nieistniejących assetów: ${unknown.map((id) => `A${id}`).join(', ')}`
      )
    }
    if (allowed.size > 0 && SECTIONS_REQUIRING_SOURCES.includes(key) && refs.length === 0) {
      errors.push(`Sekcja „${SECTION_TITLES[key]}” nie wskazuje żadnego assetu źródłowego [A<id>]`)
    }
  }
  return errors
}

/** Mapowanie asset → numery sekcji, w których jest cytowany. */
export function buildSources(sections: ComposedSections, assets: SourceAsset[]): SourceRow[] {
  return assets.map((asset) => {
    const used: number[] = []
    SECTION_KEYS.forEach((key, index) => {
      if (findAssetRefs(sections[key]).includes(asset.id)) used.push(index + 1)
    })
    return { assetId: asset.id, filename: asset.filename, kind: asset.kind, sections: used }
  })
}

/** Nagłówki modelu schodzą poniżej poziomu sekcji (## należy do dokumentu). */
function demoteHeadings(markdown: string): string {
  return markdown.replace(/^#{1,2}(?=\s)/gm, '###')
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function headerLine(text: string): string {
  return (
    text
      .replace(/[\r\n#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'Bez tytułu'
  )
}

export function renderDesignMd(
  sections: ComposedSections,
  assets: SourceAsset[],
  meta: RenderMeta
): { markdown: string; sources: SourceRow[] } {
  const sources = buildSources(sections, assets)

  const parts: string[] = [
    `# DESIGN.md — ${headerLine(meta.boardTitle)}`,
    [
      `> Specyfikacja projektowa wygenerowana z tablicy Design Canvas. Przeznaczona dla AI i ludzi budujących UI.`,
      `> Oznaczenia [A<id>] wskazują materiały źródłowe — patrz sekcja 8. Sekcja 7 zawiera luki i założenia do potwierdzenia.`,
      `> Wersja ${meta.version} · model \`${meta.model}\` · prompt \`${meta.promptVersion}\` · ${meta.generatedAt}`,
    ].join('\n'),
  ]

  for (const key of SECTION_KEYS) {
    parts.push(`## ${SECTION_TITLES[key]}\n\n${demoteHeadings(sections[key]).trim()}`)
  }

  const rows = sources.map((s) => {
    const asset = assets.find((a) => a.id === s.assetId)
    const note = asset?.userNote ? cell(asset.userNote) : '—'
    const used = s.sections.length ? s.sections.join(', ') : 'nieużyty'
    return `| A${s.assetId} | ${cell(s.filename)} | ${s.kind} | ${note} | ${used} |`
  })
  parts.push(
    [
      `## ${SECTION_TITLES.sources}`,
      '',
      rows.length
        ? [
            '| Asset | Nazwa | Typ | Notatka klienta | Sekcje |',
            '| --- | --- | --- | --- | --- |',
            ...rows,
          ].join('\n')
        : 'Brak assetów na tablicy — dokument oparto wyłącznie na notatkach.',
    ].join('\n')
  )

  return { markdown: parts.join('\n\n') + '\n', sources }
}
