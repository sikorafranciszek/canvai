import { chromium } from 'playwright'
import sharp from 'sharp'
import fs from 'node:fs'

const BASE = 'http://localhost:4000'
// Uruchamiać z katalogu głównego repo przy działającej aplikacji (PORT=4000):
//   node landing/scripts/capture-screens.mjs
const DEMO = process.argv[2] ?? 'landing/scripts/demo-assets'
const OUT = 'landing/public/screens'
fs.mkdirSync(OUT, { recursive: true })

const COPY = {
  en: {
    board: 'Ziarno — coffee shop website',
    frame: 'Customer flow',
    notes: {
      'home-desktop.png': 'Home page — warm, artisanal feel',
      'product-mobile.png': 'Product page on mobile',
      'logo-ziarno.png': 'Brand logo',
      'moodboard.png': 'Moodboard from the client: palette and type',
    },
    stickies: ['Audience: coffee lovers 25–40, value craft and origin', 'Primary CTA always terracotta. Serif headlines, sans body.'],
  },
  pl: {
    board: 'Ziarno — strona kawiarni',
    frame: 'Ścieżka klienta',
    notes: {
      'home-desktop.png': 'Strona główna — ciepły, rzemieślniczy klimat',
      'product-mobile.png': 'Karta produktu na telefonie',
      'logo-ziarno.png': 'Logo marki',
      'moodboard.png': 'Moodboard od klienta: paleta i typografia',
    },
    stickies: ['Grupa docelowa: miłośnicy kawy 25–40, liczy się rzemiosło i pochodzenie', 'Główne CTA zawsze terakota. Nagłówki szeryfowe, treść bezszeryfowa.'],
  },
}

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const xsrf = decodeURIComponent(document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '')
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-XSRF-TOKEN': xsrf },
        body: body ? JSON.stringify(body) : undefined,
      })
      return res.json()
    },
    { method, url, body }
  )
}

const browser = await chromium.launch()
for (const lang of ['en', 'pl']) {
  const c = COPY[lang]
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: lang === 'pl' ? 'pl-PL' : 'en-US',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

  const email = `demo-${lang}-${Date.now()}@canvai.dev`
  await page.goto(`${BASE}/signup?lang=${lang}`)
  await page.fill('#fullName', lang === 'pl' ? 'Anna Nowak' : 'Jane Cooper')
  await page.fill('#email', email)
  await page.fill('#password', 'password123')
  await page.fill('#passwordConfirmation', 'password123')
  await page.click('[data-testid=signup-submit]')
  await page.waitForURL(/verify-email/)
  const mb = await ctx.newPage()
  await mb.goto(`${BASE}/dev/mailbox`)
  const html = await mb.locator('iframe').getAttribute('srcdoc')
  await mb.close()
  await page.goto(html.match(/https?:\/\/[^"&<\s]+\/verify-email\/[^"&<\s]+/)[0])
  await page.waitForURL(/boards/)

  await page.goto(`${BASE}/boards/create`)
  await page.fill('#title', c.board)
  await page.click('form:has(#title) button[type=submit]')
  await page.waitForURL(/\/boards\/\d+$/)
  const boardId = page.url().split('/').pop()
  await page.waitForSelector('[data-testid=canvas-root]')
  await page.waitForTimeout(600)

  const files = Object.keys(c.notes)
  await page.setInputFiles('[data-testid=upload-input]', files.map((f) => `${DEMO}/${f}`))
  await page.locator('[data-testid^=asset-item-]').nth(files.length - 1).waitFor()
  await page.locator('[data-testid=save-status][data-status=saved]').waitFor()
  await page.waitForTimeout(1500)

  const assets = (await api(page, 'GET', `/api/boards/${boardId}/assets`)).data
  const byName = Object.fromEntries(assets.map((a) => [a.filename, a]))
  for (const [file, note] of Object.entries(c.notes)) {
    await api(page, 'PATCH', `/api/assets/${byName[file].id}`, { note })
  }

  const scene = (await api(page, 'GET', `/api/boards/${boardId}/scene`)).data
  const base = { rotation: 0, opacity: 1 }
  const img = (id, file, x, y, width, height) => ({ ...base, id, type: 'image', assetId: String(byName[file].id), x, y, width, height })
  const document = {
    metadata: {},
    elements: [
      { ...base, id: 'frame', type: 'rectangle', x: 0, y: 0, width: 1420, height: 700, fill: '#fdfbfa', stroke: '#d1d1cd', strokeWidth: 1.5, cornerRadius: 16 },
      { ...base, id: 'frame-label', type: 'text', x: 4, y: -46, text: c.frame, fontSize: 26, fontFamily: "'Inter Variable', Inter, sans-serif", fill: '#27251e', align: 'left' },
      img('i-home', 'home-desktop.png', 40, 40, 992, 620),
      img('i-mobile', 'product-mobile.png', 1100, 40, 296, 620),
      { ...base, id: 'arrow', type: 'arrow', x: 1036, y: 350, points: [{ x: 0, y: 0 }, { x: 58, y: 0 }], stroke: '#27251e', strokeWidth: 2.5, arrowHeadSize: 12 },
      img('i-logo', 'logo-ziarno.png', 0, 760, 300, 300),
      img('i-mood', 'moodboard.png', 340, 760, 450, 300),
      { ...base, id: 'n1', type: 'sticky', x: 830, y: 760, width: 270, height: 170, text: c.stickies[0], fill: '#f7e6a6', fontSize: 17 },
      { ...base, id: 'n2', type: 'sticky', x: 1130, y: 760, width: 270, height: 170, text: c.stickies[1], fill: '#dcebe0', fontSize: 17 },
    ],
  }
  await api(page, 'PUT', `/api/boards/${boardId}/scene`, { version: scene.version, document, appState: {} })

  await page.reload()
  await page.waitForSelector('[data-testid=canvas-root]')
  await page.waitForTimeout(1200)
  await page.click('[data-testid=generate-design-doc]')
  await page.waitForSelector('[data-testid=design-doc-content]', { timeout: 90000 })
  await page.waitForTimeout(800)
  await page.click('[data-testid=fit-to-content]')
  await page.getByRole('button', { name: 'Colors', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.mouse.move(700, 880)
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => t.remove()))
  await page.waitForTimeout(300)

  const shot = await page.screenshot()
  await sharp(shot).resize(2160).webp({ quality: 84 }).toFile(`${OUT}/hero-${lang}.webp`)
  await sharp(shot).resize(1440).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(`${OUT}/hero-${lang}.png`)
  console.log(lang, 'ok', email)
  await ctx.close()
}
await browser.close()
