import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import sharp from 'sharp'
import type { Page } from 'playwright'
import User from '#models/user'
import Board from '#models/board'
import BoardMember from '#models/board_member'
import BoardShare from '#models/board_share'
import Asset from '#models/asset'

/**
 * E2E (REL-4): rola podglądu, współpraca dwóch osób na żywo i portal klienta.
 * Druga osoba loguje się przez formularz w osobnym kontekście przeglądarki.
 */
test.group('Collaboration e2e', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const PASSWORD = 'password123'

  async function makeUser(prefix: string, fullName: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return User.create({
      fullName,
      emailVerifiedAt: DateTime.utc(),
      email: `${prefix}-${suffix}@test.com`,
      password: PASSWORD,
    })
  }

  async function makeBoard(owner: User) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return Board.create({ title: 'Wspólna tablica', slug: `e2e-${suffix}`, userId: owner.id })
  }

  async function addMember(board: Board, user: User, role: 'editor' | 'viewer') {
    return BoardMember.create({
      boardId: board.id,
      userId: user.id,
      email: user.email,
      role,
      token: Math.random().toString(36).slice(2) + Date.now().toString(36),
      acceptedAt: DateTime.utc(),
    })
  }

  /** Logowanie formularzem w nowym kontekście (druga osoba). */
  async function loginInNewContext(
    browser: { newContext: () => Promise<{ newPage: () => Promise<Page> }> },
    origin: string,
    user: User
  ) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${origin}/login`)
    await page.fill('#email', user.email)
    await page.fill('#password', PASSWORD)
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login')),
      page.click('[type=submit]'),
    ])
    return page
  }

  /** Odpowiedzi 403 w trakcie testu — podgląd nie powinien ich wywoływać. */
  function track403(page: Page) {
    const forbidden: string[] = []
    page.on('response', (r) => {
      if (r.status() === 403) forbidden.push(r.url())
    })
    return forbidden
  }

  test('rola podglądu: brak kontrolek edycji i żadnych 403', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const owner = await makeUser('owner', 'Ola Właścicielka')
    const viewer = await makeUser('viewer', 'Wiktor Podgląd')
    const board = await makeBoard(owner)
    await addMember(board, viewer, 'viewer')
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#335' } })
      .png()
      .toBuffer()
    await Asset.create({
      boardId: board.id,
      kind: 'image',
      source: 'upload',
      filename: 'logo.png',
      mime: 'image/png',
      size: png.length,
      width: 64,
      height: 64,
    })

    await browserContext.loginAs(viewer)
    const page = await visit(`/boards/${board.id}`)
    const forbidden = track403(page)
    await page.locator('[data-testid=canvas-root]').waitFor()
    await page.waitForTimeout(800)

    assert.equal(await page.locator('[data-testid^=tool-]').count(), 0, 'pasek narzędzi')
    assert.equal(await page.locator('[data-testid=generate-design-doc]').count(), 0)
    assert.equal(await page.locator('[data-testid^=asset-delete-]:visible').count(), 0)

    // Skróty edycji nic nie robią (i nie wysyłają żądań).
    await page.mouse.click(400, 400)
    await page.keyboard.press('r')
    await page.keyboard.press('Delete')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert.deepEqual(forbidden, [])
  })

  test('dwie osoby: obecność i komentarz widoczny u drugiej bez odświeżania', async ({
    browser,
    cleanup,
    browserContext,
    visit,
    assert,
  }) => {
    const owner = await makeUser('owner', 'Ola Właścicielka')
    const editor = await makeUser('editor', 'Edek Edytor')
    const board = await makeBoard(owner)
    await addMember(board, editor, 'editor')

    await browserContext.loginAs(owner)
    const ownerPage = await visit(`/boards/${board.id}`)
    await ownerPage.locator('[data-testid=canvas-root]').waitFor()
    const origin = new URL(ownerPage.url()).origin
    // Pusta tablica: „Generuj” nieaktywny od razu (UX-11).
    assert.isTrue(await ownerPage.locator('[data-testid=generate-design-doc]').isDisabled())

    const editorPage = await loginInNewContext(browser as never, origin, editor)
    cleanup(() => editorPage.context().close())
    await editorPage.goto(`${origin}/boards/${board.id}`)
    await editorPage.locator('[data-testid=canvas-root]').waitFor()

    // Obecność: każde widzi drugą osobę.
    await ownerPage.locator('[data-testid=presence] .presence__avatar').first().waitFor()
    await editorPage.locator('[data-testid=presence] .presence__avatar').first().waitFor()
    assert.equal(
      await ownerPage.locator('[data-testid=presence] .presence__avatar').innerText(),
      editor.initials
    )

    // Komentarz właścicielki pojawia się u edytora przez zdarzenie na żywo.
    await ownerPage.locator('[data-testid=comments-add]').click()
    // Pusta tablica: karta powitalna nie może zasłaniać miejsca ani okienka komentarza.
    await ownerPage.locator('[data-testid=comments-layer]').click({ position: { x: 300, y: 300 } })
    await ownerPage.locator('[data-testid=comment-input]').fill('Większy nagłówek?')
    await ownerPage.locator('[data-testid=comment-submit]').click()
    await ownerPage.locator('[data-testid^=comment-pin-]').first().waitFor()

    await editorPage.locator('[data-testid^=comment-pin-]').first().waitFor({ timeout: 10_000 })
    assert.equal(await editorPage.locator('[data-testid^=comment-pin-]').count(), 1)
  })

  test('portal klienta: przesłany plik trafia do skrzynki tablicy', async ({ visit, assert }) => {
    const owner = await makeUser('owner', 'Ola Właścicielka')
    const board = await makeBoard(owner)
    const token = `e2e${Date.now()}${Math.random().toString(36).slice(2, 10)}`
    await BoardShare.create({ boardId: board.id, token, allowUpload: true, showDoc: true })

    const page = await visit(`/c/${token}`)
    await page.locator('[data-testid=portal-upload]').waitFor()
    await page.fill('#portal-name', 'Klient Kowalski')
    await page.locator('[data-testid=portal-files]').setInputFiles({
      name: 'brief.png',
      mimeType: 'image/png',
      buffer: await sharp({ create: { width: 80, height: 40, channels: 3, background: '#c63' } })
        .png()
        .toBuffer(),
    })
    await page.locator('[data-testid=portal-send]').click()

    const deadline = Date.now() + 10_000
    let asset: Asset | null = null
    while (!asset && Date.now() < deadline) {
      asset = await Asset.query().where('board_id', board.id).where('filename', 'brief.png').first()
      if (!asset) await page.waitForTimeout(200)
    }
    assert.isNotNull(asset)
    assert.equal(asset!.submittedBy, 'Klient Kowalski')
  })
})
