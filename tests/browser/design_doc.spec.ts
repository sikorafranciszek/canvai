import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import sharp from 'sharp'
import User from '#models/user'
import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import { setProviderOverride } from '#services/ai/provider'
import { MockProvider } from '#services/ai/mock_provider'
import { runPendingJobs } from '#services/queue'

/**
 * E2E (BLA-8): logowanie → tablica → upload 2 obrazów → Generuj DESIGN.md →
 * podgląd → pobranie pliku. Dostawca `mock`; worker kolejki w testach nie
 * działa w tle, więc test sam przetwarza zadania w pętli oczekiwania.
 */
test.group('Design doc e2e', (group) => {
  group.each.setup(() => {
    setProviderOverride(new MockProvider())
    return testUtils.db().withGlobalTransaction()
  })
  group.each.teardown(() => setProviderOverride(null))

  async function image(color: string, width: number, height: number) {
    return sharp({ create: { width, height, channels: 3, background: color } })
      .png()
      .toBuffer()
  }

  test('wklejone materiały → DESIGN.md do pobrania', async ({ browserContext, visit, assert }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await User.create({ email: `e2e-${suffix}@test.com`, password: 'password123' })
    const board = await Board.create({ title: 'Kawiarnia', slug: `e2e-${suffix}`, userId: user.id })
    await browserContext.loginAs(user)

    const page = await visit(`/boards/${board.id}`)
    await page.locator('[data-testid=canvas-root]').waitFor()

    await page.locator('[data-testid=upload-input]').setInputFiles([
      { name: 'home-screen.png', mimeType: 'image/png', buffer: await image('#faf6f0', 1280, 800) },
      { name: 'logo.png', mimeType: 'image/png', buffer: await image('#3b2a20', 300, 300) },
    ])
    await page.locator('[data-testid^=asset-item-]').nth(1).waitFor()
    await page.locator('[data-testid=save-status][data-status=saved]').waitFor()

    await page.locator('[data-testid=generate-design-doc]').click()
    await page.locator('[data-testid=design-doc-panel]').waitFor()

    // Przetwarzamy kolejkę, aż dokument będzie gotowy (zamiast workera w tle).
    const deadline = Date.now() + 30_000
    let doc: DesignDoc | null = null
    while (Date.now() < deadline) {
      await runPendingJobs()
      doc = await DesignDoc.query().where('board_id', board.id).orderBy('version', 'desc').first()
      if (doc?.status === 'ready' || doc?.status === 'failed') break
      await page.waitForTimeout(200)
    }
    assert.equal(doc?.status, 'ready', doc?.error ?? undefined)

    const content = page.locator('[data-testid=design-doc-content]')
    await content.waitFor({ timeout: 10_000 })
    assert.include(await content.innerText(), 'Tokens — Colors')
    assert.isAbove(await page.locator('[data-testid^=design-ref-]').count(), 0)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=design-doc-download]').click(),
    ])
    assert.equal(download.suggestedFilename(), 'DESIGN.md')
  })
})
