import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { analysis as analysisVariant } from '#config/assets'
import type { AiProvider, AssetAnalysisData, DesignSpec } from '#services/ai/types'
import { buildBoardContext } from '#services/design/board_context'
import { assessQuality } from '#services/design/quality'
import { renderCssVariables, renderDesignMd } from '#services/design/renderer'
import { composeVerifiedSpec } from '#services/design/compose'
import { colorDistance } from '#shared/color'
import { normalizeUsage, type AssetUsage } from '#shared/asset-usage'

/**
 * Zestaw ewaluacyjny DESIGN.md: przypadki w `tests/eval/cases/<nazwa>/`
 * (obrazy + `case.json` z oczekiwanymi faktami) przechodzą przez TEN SAM
 * pipeline co produkcja (analiza → `composeVerifiedSpec`: budżet, kompozycja,
 * ugruntowanie, weryfikacja ról/kolorów/fontów/cytatów → render)
 * i są oceniane: czy kolory, fonty i teksty z obrazów trafiły do dokumentu,
 * czy nie pojawiły się zmyślone fakty i czy tokeny są poprawnym CSS.
 * Uruchamiany przed każdą zmianą promptu: `node ace design:eval`.
 */

export interface EvalCase {
  name: string
  dir: string
  boardTitle: string
  notes: Record<string, string>
  canvasNotes: string[]
  /** Rola i aspekty materiału (nazwa pliku → usage), jak ustawia klient. */
  usage: Record<string, AssetUsage>
  /** Ile razy powtórzyć zestaw obrazów (np. tablica 40 materiałów z 2 plików). */
  repeat: number
  expect: {
    colors: string[]
    fonts: string[]
    text: string[]
    forbiddenColors: string[]
    forbiddenPhrases: string[]
    /** Nazwy komponentów, których materiały nie pokazują (zmyślone = naruszenie). */
    forbiddenComponents: string[]
    /** Żaden font nie jest w materiałach nazwany — każdy musi być założeniem †. */
    fontsAssumed: boolean
  }
}

export interface EvalResult {
  case: string
  score: number
  colors: { expected: number; found: string[]; missing: string[] }
  fonts: { expected: number; found: string[]; missing: string[] }
  text: { expected: number; found: string[]; missing: string[] }
  violations: string[]
  invalidCss: string[]
  quality: number
  assumed: number
  tokens: { in: number; out: number }
  durationMs: number
  error?: string
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const SAME = 0.06

export async function loadCases(root: string, only?: string): Promise<EvalCase[]> {
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && (!only || d.name === only))
    .map((d) => d.name)
    .sort()
  const cases: EvalCase[] = []
  for (const name of names) {
    const dir = join(root, name)
    const raw = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8'))
    cases.push({
      name,
      dir,
      boardTitle: raw.boardTitle ?? name,
      notes: raw.notes ?? {},
      canvasNotes: raw.canvasNotes ?? [],
      usage: Object.fromEntries(
        Object.entries(
          (raw.usage ?? {}) as Record<string, { role?: unknown; aspects?: unknown }>
        ).map(([file, u]) => [file, normalizeUsage(u.role ?? null, u.aspects ?? [])])
      ),
      repeat: Math.max(1, Math.min(40, Number(raw.repeat) || 1)),
      expect: {
        colors: raw.expect?.colors ?? [],
        fonts: raw.expect?.fonts ?? [],
        text: raw.expect?.text ?? [],
        forbiddenColors: raw.expect?.forbiddenColors ?? [],
        forbiddenPhrases: raw.expect?.forbiddenPhrases ?? [],
        forbiddenComponents: raw.expect?.forbiddenComponents ?? [],
        fontsAssumed: raw.expect?.fontsAssumed === true,
      },
    })
  }
  return cases
}

/** Wariant obrazu jak w produkcji (`analysis`: webp, dłuższa krawędź ≤ 1568 px). */
async function analysisImage(file: string) {
  const image = sharp(await readFile(file))
  const meta = await image.metadata()
  const buffer = await image
    .resize(analysisVariant.maxDimension, analysisVariant.maxDimension, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: analysisVariant.quality })
    .toBuffer()
  return { buffer, mime: 'image/webp', width: meta.width ?? null, height: meta.height ?? null }
}

/** Tokeny z wartością, która nie wygląda na CSS (opis w nawiasie, słowa). */
export function invalidCssTokens(spec: DesignSpec): string[] {
  return renderCssVariables(spec)
    .split('\n')
    .filter((line) => /^\s+--[\w-]+: /.test(line))
    .filter((line) => {
      const value = line.replace(/^\s+--[\w-]+: /, '').replace(/;$/, '')
      const withoutFns = value.replace(
        /\b(rgba?|hsla?|oklch|oklab|var|calc|cubic-bezier)\([^()]*\)/g,
        ''
      )
      return /[()]/.test(withoutFns)
    })
    .map((line) => line.trim())
}

export function scoreSpec(c: EvalCase, spec: DesignSpec, markdown: string) {
  const grounded = spec.colors.filter((x) => !x.assumed)
  const colorsFound = c.expect.colors.filter((hex) =>
    grounded.some((x) => colorDistance(x.hex, hex) <= SAME)
  )
  const families = spec.typography.families.map((f) => f.name.toLowerCase())
  const fontsFound = c.expect.fonts.filter((f) => families.some((n) => n.includes(f.toLowerCase())))
  // Teksty liczą się tylko, gdy trafiły do DOKUMENTU (nie do samego OCR analizy).
  const haystack = markdown.toLowerCase()
  const textFound = c.expect.text.filter((s) => haystack.includes(s.toLowerCase()))
  const violations = [
    ...c.expect.forbiddenColors
      .filter((hex) => spec.colors.some((x) => colorDistance(x.hex, hex) <= 0.04))
      .map((hex) => `color ${hex} in tokens`),
    ...c.expect.forbiddenPhrases
      .filter((p) => markdown.toLowerCase().includes(p.toLowerCase()))
      .map((p) => `phrase „${p}”`),
    ...c.expect.forbiddenComponents
      .filter((name) =>
        spec.components.some((x) => !x.assumed && x.name.toLowerCase().includes(name.toLowerCase()))
      )
      .map((name) => `invented component „${name}”`),
    ...(c.expect.fontsAssumed
      ? spec.typography.families
          .filter((f) => !f.assumed && !/^(system-ui|sans-serif|serif|monospace)$/i.test(f.name))
          .map((f) => `font „${f.name}” presented as fact`)
      : []),
  ]
  const invalidCss = invalidCssTokens(spec)
  const ratio = (found: number, expected: number) => (expected ? found / expected : 1)
  const quality = assessQuality(spec, Object.keys(c.notes).length || 1)
  // Bez stałych punktów „za udział”: 100 = wszystko znalezione, nic zmyślonego.
  const score = Math.max(
    0,
    Math.round(
      ratio(colorsFound.length, c.expect.colors.length) * 40 +
        ratio(fontsFound.length, c.expect.fonts.length) * 15 +
        ratio(textFound.length, c.expect.text.length) * 25 +
        (quality.grounded / Math.max(1, quality.total)) * 20 -
        violations.length * 8 -
        invalidCss.length * 2
    )
  )
  return {
    score,
    colors: {
      expected: c.expect.colors.length,
      found: colorsFound,
      missing: c.expect.colors.filter((x) => !colorsFound.includes(x)),
    },
    fonts: {
      expected: c.expect.fonts.length,
      found: fontsFound,
      missing: c.expect.fonts.filter((x) => !fontsFound.includes(x)),
    },
    text: {
      expected: c.expect.text.length,
      found: textFound,
      missing: c.expect.text.filter((x) => !textFound.includes(x)),
    },
    violations,
    invalidCss,
    quality: quality.score,
    assumed: quality.assumed.length,
  }
}

/** Przechodzi przypadek przez pełny pipeline dostawcy i go ocenia. */
export async function runCase(c: EvalCase, provider: AiProvider): Promise<EvalResult> {
  const started = Date.now()
  const tokens = { in: 0, out: 0 }
  try {
    const files = (await readdir(c.dir))
      .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
      .sort()
    const analyses = new Map<number, AssetAnalysisData>()
    const assets: {
      id: number
      filename: string
      kind: string
      userNote: string | null
      onCanvas: boolean
      analysis: AssetAnalysisData
      usage?: AssetUsage
    }[] = []
    // Analiza raz na plik (jak cache w produkcji), materiał powtórzony `repeat` razy.
    const byFile = new Map<
      string,
      { data: AssetAnalysisData; width: number | null; height: number | null }
    >()
    for (const file of files) {
      const img = await analysisImage(join(c.dir, file))
      const res = await provider.analyzeAsset({
        assetId: byFile.size + 1,
        kind: 'image',
        filename: file,
        mime: 'image/png',
        width: img.width,
        height: img.height,
        linkMeta: null,
        image: provider.vision ? { buffer: img.buffer, mime: img.mime } : null,
      })
      tokens.in += res.usage.tokensIn
      tokens.out += res.usage.tokensOut
      byFile.set(file, { data: res.data, width: img.width, height: img.height })
    }
    for (let r = 0; r < c.repeat; r++) {
      for (const file of files) {
        const id: number = assets.length + 1
        const data = byFile.get(file)!.data
        analyses.set(id, data)
        assets.push({
          id,
          filename: c.repeat > 1 ? `${r + 1}-${file}` : file,
          kind: 'image',
          userNote: c.notes[file] ?? null,
          onCanvas: true,
          analysis: data,
          usage: c.usage[file],
        })
      }
    }

    const context = buildBoardContext({
      metadata: {},
      elements: [
        ...assets.map((a, i) => ({
          id: `img-${a.id}`,
          type: 'image',
          assetId: String(a.id),
          x: (i % 8) * 1100,
          y: Math.floor(i / 8) * 800,
          width: 1000,
          height: 640,
          rotation: 0,
          opacity: 1,
        })),
        ...c.canvasNotes.map((text, i) => ({
          id: `note-${i}`,
          type: 'sticky',
          text,
          x: i * 400,
          y: -400,
          width: 300,
          height: 160,
          rotation: 0,
          opacity: 1,
          fill: '#f7e6a6',
        })),
      ],
    } as any)

    const usage = { tokensIn: 0, tokensOut: 0 }
    const { spec } = await composeVerifiedSpec({
      provider,
      input: { boardTitle: c.boardTitle, assets, context },
      usage,
      evidence: {
        assets: assets.map((a) => ({ id: a.id, usage: a.usage, analysis: a.analysis })),
        notes: [c.boardTitle, ...Object.values(c.notes), ...c.canvasNotes],
      },
    })
    tokens.in += usage.tokensIn
    tokens.out += usage.tokensOut
    const { markdown } = renderDesignMd(
      spec,
      assets.map((a) => ({
        id: a.id,
        filename: a.filename,
        kind: a.kind,
        userNote: a.userNote,
        usage: a.usage,
      })),
      { boardTitle: c.boardTitle, version: 1, generatedAt: 'eval' }
    )
    return {
      case: c.name,
      ...scoreSpec(c, spec, markdown),
      tokens,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return {
      case: c.name,
      score: 0,
      colors: { expected: c.expect.colors.length, found: [], missing: c.expect.colors },
      fonts: { expected: c.expect.fonts.length, found: [], missing: c.expect.fonts },
      text: { expected: c.expect.text.length, found: [], missing: c.expect.text },
      violations: [],
      invalidCss: [],
      quality: 0,
      assumed: 0,
      tokens,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
