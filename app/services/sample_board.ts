import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import DesignDoc from '#models/design_doc'
import type User from '#models/user'
import { storeBuffer } from '#services/assets_service'
import { prepareGeneration, withPlanFooter } from '#services/design/generator'
import { PROMPT_VERSION } from '#services/design/prompts'
import { renderDesignMd } from '#services/design/renderer'
import { validateDesignSpec } from '#services/design/spec'
import type { Locale } from '#shared/i18n'

/**
 * Przykładowa tablica nowego konta: trzy materiały kawiarni „Ziarno”, notatka,
 * przepływ między ekranami i GOTOWY DESIGN.md (bez wywołania AI i bez kredytów).
 * Pokazuje od razu, co produkt robi. Nie liczy się do limitu tablic planu.
 */

const COPY = {
  pl: {
    title: 'Przykład: kawiarnia Ziarno',
    home: 'Strona główna — tak ma wyglądać pierwszy ekran',
    menu: 'Menu z zamawianiem — karty produktów i potwierdzenie',
    logo: 'Logo i kolory marki',
    brief:
      'Brief: rzemieślnicza palarnia i kawiarnia z Krakowa. Ciepło, konkretnie, bez korporacyjnego tonu. Nagłówki Fraunces, tekst Inter.',
    labelHome: 'Strona główna',
    labelMenu: 'Menu',
    labelBrand: 'Marka',
  },
  en: {
    title: 'Example: Ziarno coffee',
    home: 'Home page — this is how the first screen should look',
    menu: 'Menu with ordering — product cards and confirmation',
    logo: 'Logo and brand colors',
    brief:
      'Brief: a craft roastery and café from Kraków. Warm and specific, no corporate tone. Headlines in Fraunces, body in Inter.',
    labelHome: 'Home',
    labelMenu: 'Menu',
    labelBrand: 'Brand',
  },
} as const

const FONT = "'Inter Variable', Inter, system-ui, sans-serif"

function el(fields: Record<string, unknown>) {
  return { id: globalThis.crypto.randomUUID(), rotation: 0, opacity: 1, ...fields }
}

export async function createSampleBoard(user: User, locale: Locale): Promise<Board | null> {
  const existing = await Board.query().where('user_id', user.id).where('is_sample', true).first()
  if (existing) return existing
  const copy = COPY[locale] ?? COPY.en

  const board = await Board.create({
    title: copy.title,
    slug: `sample-${Math.random().toString(36).slice(2, 10)}`,
    userId: user.id,
    isSample: true,
  })

  const files = [
    { name: 'home.png', note: copy.home },
    { name: 'menu.png', note: copy.menu },
    { name: 'logo.png', note: copy.logo },
  ]
  const assets = []
  for (const f of files) {
    const buffer = await readFile(app.makePath('resources/sample', f.name))
    const asset = await storeBuffer(
      board.id,
      { buffer, mime: 'image/png', clientName: `ziarno-${f.name}`, size: buffer.length },
      'upload'
    )
    asset.userNote = f.note
    await asset.save()
    assets.push(asset)
  }
  const [home, menu, logo] = assets

  const document = {
    metadata: { sample: true },
    elements: [
      el({
        type: 'text',
        x: 0,
        y: -56,
        text: copy.labelHome,
        fontSize: 28,
        fontFamily: FONT,
        fill: '#27251e',
        label: true,
      }),
      el({ type: 'image', assetId: String(home.id), x: 0, y: 0, width: 960, height: 600 }),
      el({
        type: 'arrow',
        x: 980,
        y: 300,
        points: [
          { x: 0, y: 0 },
          { x: 140, y: 0 },
        ],
        stroke: '#27251e',
        strokeWidth: 2,
      }),
      el({
        type: 'text',
        x: 1140,
        y: -56,
        text: copy.labelMenu,
        fontSize: 28,
        fontFamily: FONT,
        fill: '#27251e',
        label: true,
      }),
      el({ type: 'image', assetId: String(menu.id), x: 1140, y: 0, width: 960, height: 600 }),
      el({
        type: 'text',
        x: 0,
        y: 704,
        text: copy.labelBrand,
        fontSize: 28,
        fontFamily: FONT,
        fill: '#27251e',
        label: true,
      }),
      el({ type: 'image', assetId: String(logo.id), x: 0, y: 760, width: 400, height: 400 }),
      el({
        type: 'sticky',
        x: 460,
        y: 760,
        width: 360,
        height: 200,
        text: copy.brief,
        fill: '#f7e6a6',
        fontSize: 18,
      }),
    ],
  }
  await BoardScene.create({
    boardId: board.id,
    document,
    appState: { camera: { x: 64, y: 110, scale: 0.45 } },
    version: 1,
  })

  // Gotowy dokument: specyfikacja z repozytorium z identyfikatorami prawdziwych assetów.
  const ids: Record<string, number> = { '1': home.id, '2': menu.id, '3': logo.id }
  const raw = (await readFile(app.makePath('resources/sample/spec.json'), 'utf8')).replace(
    /\[A([123])\]/g,
    (_m, n: string) => `[A${ids[n]}]`
  )
  const parsed = JSON.parse(raw)
  const remap = (list: number[]) => list.map((n) => ids[String(n)] ?? n)
  for (const c of parsed.colors) c.sources = remap(c.sources)
  for (const f of parsed.typography.families) f.sources = remap(f.sources)
  for (const c of parsed.components) c.sources = remap(c.sources)
  for (const s of parsed.screens) s.sources = remap(s.sources)
  const spec = validateDesignSpec(parsed)

  const generatedAt = DateTime.utc()
  const { markdown, sources } = renderDesignMd(
    spec,
    assets.map((a) => ({
      id: a.id,
      filename: a.filename,
      kind: a.kind,
      userNote: a.userNote,
      usage: a.usage,
    })),
    {
      boardTitle: board.title,
      version: 1,
      generatedAt: generatedAt.toFormat("yyyy-MM-dd HH:mm 'UTC'"),
    }
  )
  const input = await prepareGeneration(board)
  await DesignDoc.create({
    boardId: board.id,
    version: 1,
    status: 'ready',
    contentMd: await withPlanFooter(markdown, user.id),
    spec,
    sources,
    model: 'sample',
    promptVersion: PROMPT_VERSION,
    inputFingerprint: input.fingerprint,
    proMode: false,
    creditsCharged: 0,
    generatedAt,
  })
  return board
}

/** Wersja „bezpieczna” dla rejestracji — błąd nie blokuje założenia konta. */
export async function createSampleBoardSafely(user: User, locale: Locale) {
  try {
    return await createSampleBoard(user, locale)
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'sample board not created')
    return null
  }
}
