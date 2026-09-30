import { createHmac } from 'node:crypto'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import sharp from 'sharp'
import { billing, costs, freeCredits, lemonSqueezy, products } from '#config/billing'
import Board from '#models/board'
import CreditGrant from '#models/credit_grant'
import DesignDoc from '#models/design_doc'
import User from '#models/user'
import { MockProvider } from '#services/ai/mock_provider'
import { setProviderOverride } from '#services/ai/provider'
import {
  InsufficientCreditsError,
  balanceOf,
  ensureAutomaticGrants,
  grantCredits,
  releaseAll,
  reserveCredits,
} from '#services/billing/credits'
import { planFor } from '#services/billing/plans'
import { attachReferrer, referralCodeFor, rewardReferral } from '#services/billing/referrals'
import { isDisposableEmail } from '#services/disposable_email'
import { sanitizePreviewHtml } from '#services/design/preview_template'
import DesignPreview from '#models/design_preview'
import ApiToken from '#models/api_token'
import { createApiToken } from '#services/api_tokens'
import mail from '@adonisjs/mail/services/main'
import Asset from '#models/asset'
import PortalFeedback from '#models/portal_feedback'
import { pruneOrphanAssets } from '#services/assets_service'
import { runPendingJobs } from '#services/queue'

/**
 * Rozliczenia: kredyty, limity planów, naliczanie przy generacji i webhooki
 * Lemon Squeezy (podpis HMAC, idempotencja, zwroty).
 */

const SECRET = 'test-webhook-secret'
const VARIANTS = { pack_s: 'v-pack-s', pro: 'v-pro' }

let seq = 0
async function makeUser(prefix = 'billing') {
  const suffix = `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 6)}`
  return User.create({
    emailVerifiedAt: DateTime.utc(),
    email: `${prefix}-${suffix}@test.com`,
    password: 'password123',
  })
}

async function login(client: any, user: User) {
  const res = await client
    .post('/login')
    .json({ email: user.email, password: 'password123' })
    .redirects(0)
  return res.headers()['set-cookie']
}

async function createBoard(user: User, title = 'Kawiarnia') {
  const suffix = `${Date.now()}-${++seq}`
  return Board.create({ title, slug: `billing-${suffix}`, userId: user.id })
}

function png(color: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 600, height: 400, channels: 3, background: color } })
    .png()
    .toBuffer()
}

/** Tablica z dwoma obrazami na płótnie. */
async function seedBoard(client: any, cookies: any, board: Board) {
  let req = client.post(`/api/boards/${board.id}/assets`).headers({ cookie: cookies })
  req = req.file('files', await png({ r: 240, g: 230, b: 210 }), {
    filename: 'home.png',
    contentType: 'image/png',
  })
  req = req.file('files', await png({ r: 20, g: 90, b: 110 }), {
    filename: 'detail.png',
    contentType: 'image/png',
  })
  const up = await req
  up.assertStatus(201)
  const ids = (up.body().data as { id: number }[]).map((a) => a.id)

  const scene = await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: cookies })
  const elements = ids.map((id, i) => ({
    id: `i${i}`,
    type: 'image',
    assetId: String(id),
    x: i * 400,
    y: 0,
    width: 300,
    height: 200,
    rotation: 0,
    opacity: 1,
  }))
  const put = await client
    .put(`/api/boards/${board.id}/scene`)
    .headers({ cookie: cookies })
    .json({
      version: scene.body().data.version,
      document: { metadata: {}, elements },
      appState: {},
    })
  put.assertStatus(200)
  return ids
}

function sign(body: string) {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}

function webhook(client: any, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload)
  return client
    .post('/webhooks/lemonsqueezy')
    .header('content-type', 'application/json')
    .header('x-signature', signature ?? sign(body))
    .json(payload)
}

function orderPayload(user: User, orderId: string, variantId: string, status = 'paid') {
  return {
    meta: { event_name: 'order_created', custom_data: { user_id: String(user.id) } },
    data: {
      id: orderId,
      type: 'orders',
      attributes: { status, user_email: user.email, first_order_item: { variant_id: variantId } },
    },
  }
}

test.group('Billing', (group) => {
  const saved = {
    enforced: billing.enforced,
    secret: lemonSqueezy.webhookSecret,
    packS: products.pack_s.variantId,
    pro: products.pro.variantId,
  }

  group.each.setup(() => {
    billing.enforced = true
    lemonSqueezy.webhookSecret = SECRET
    products.pack_s.variantId = VARIANTS.pack_s
    products.pro.variantId = VARIANTS.pro
    setProviderOverride(new MockProvider())
    return testUtils.db().withGlobalTransaction()
  })
  group.each.teardown(() => {
    billing.enforced = saved.enforced
    lemonSqueezy.webhookSecret = saved.secret
    products.pack_s.variantId = saved.packS
    products.pro.variantId = saved.pro
    setProviderOverride(null)
  })

  test('darmowe kredyty: start + miesięczne, naliczane raz', async ({ assert }) => {
    const user = await makeUser()
    await ensureAutomaticGrants(user.id)
    await ensureAutomaticGrants(user.id)
    assert.equal(await balanceOf(user.id), freeCredits.signup + freeCredits.monthly)
    assert.equal(
      await CreditGrant.query()
        .where('user_id', user.id)
        .count('* as n')
        .then((r) => Number(r[0].$extras.n)),
      2
    )
  })

  test('rezerwacja zdejmuje najpierw pule wygasające najwcześniej; zwrot oddaje całość', async ({
    assert,
  }) => {
    const user = await makeUser()
    const late = await grantCredits(user.id, {
      source: 'admin',
      amount: 10,
      expiresAt: DateTime.utc().plus({ months: 6 }),
      externalId: `t-late-${user.id}`,
    })
    const soon = await grantCredits(user.id, {
      source: 'admin',
      amount: 5,
      expiresAt: DateTime.utc().plus({ days: 3 }),
      externalId: `t-soon-${user.id}`,
    })
    await grantCredits(user.id, {
      source: 'admin',
      amount: 50,
      expiresAt: DateTime.utc().minus({ days: 1 }),
      externalId: `t-expired-${user.id}`,
    })
    assert.equal(await balanceOf(user.id), 15, 'wygasła pula się nie liczy')

    const board = await createBoard(user)
    const doc = await DesignDoc.create({ boardId: board.id, version: 1, status: 'queued' })
    await reserveCredits(user.id, 8, { designDocId: doc.id })
    await soon!.refresh()
    await late!.refresh()
    assert.equal(soon!.remaining, 0)
    assert.equal(late!.remaining, 7)

    await assert.rejects(
      () => reserveCredits(user.id, 100, { designDocId: doc.id }),
      InsufficientCreditsError as any
    )
    assert.equal(await balanceOf(user.id), 7, 'nieudana rezerwacja nic nie zdejmuje')

    assert.equal(await releaseAll({ designDocId: doc.id }), 8)
    assert.equal(await balanceOf(user.id), 15)
    assert.equal(await releaseAll({ designDocId: doc.id }), 0, 'drugi zwrot nic nie oddaje')
  })

  test('generacja pobiera szacowany koszt; bez zmian — 0; plan Free dostaje stopkę', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user)
    await seedBoard(client, cookies, board)

    const est = await client
      .get(`/api/boards/${board.id}/design-doc/estimate`)
      .headers({ cookie: cookies })
    est.assertStatus(200)
    const expected = 2 * costs.perMaterial + costs.compose
    assert.equal(est.body().data.credits, expected)
    assert.equal(est.body().data.newMaterials, 2)
    const startBalance = est.body().data.balance
    assert.equal(startBalance, freeCredits.signup + freeCredits.monthly)

    const post = await client
      .post(`/api/boards/${board.id}/design-doc`)
      .headers({ cookie: cookies })
      .json({})
    post.assertStatus(202)
    assert.equal(await balanceOf(user.id), startBalance - expected, 'rezerwacja przy zleceniu')

    await runPendingJobs()
    const doc = await DesignDoc.findOrFail(post.body().data.doc.id)
    assert.equal(doc.status, 'ready', doc.error ?? '')
    assert.equal(doc.creditsCharged, expected)
    assert.isNotNull(doc.spec)
    assert.include(doc.contentMd!, 'canvai.dev', 'stopka planu Free')

    // Bez zmian: ta sama wersja, zero kredytów.
    const again = await client
      .post(`/api/boards/${board.id}/design-doc`)
      .headers({ cookie: cookies })
      .json({})
    again.assertStatus(200)
    assert.isTrue(again.body().data.reused)
    assert.equal(await balanceOf(user.id), startBalance - expected)

    // Wymuszona generacja: analizy z cache — płaci tylko za złożenie.
    const est2 = await client
      .get(`/api/boards/${board.id}/design-doc/estimate`)
      .headers({ cookie: cookies })
    assert.isTrue(est2.body().data.unchanged)
    assert.equal(est2.body().data.credits, costs.compose)
  })

  test('za mało kredytów → 402 i nic nie powstaje; nieudana generacja zwraca kredyty', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user)
    await seedBoard(client, cookies, board)

    // Wyczerpanie salda.
    await ensureAutomaticGrants(user.id)
    await CreditGrant.query().where('user_id', user.id).update({ remaining: 1 })
    const post = await client
      .post(`/api/boards/${board.id}/design-doc`)
      .headers({ cookie: cookies })
      .json({})
    post.assertStatus(402)
    assert.equal(post.body().code, 'E_INSUFFICIENT_CREDITS')
    assert.equal(
      await DesignDoc.query()
        .where('board_id', board.id)
        .count('* as n')
        .then((r) => Number(r[0].$extras.n)),
      0
    )

    // Doładowanie i generacja, która się nie powiedzie → pełny zwrot.
    await grantCredits(user.id, {
      source: 'admin',
      amount: 50,
      expiresAt: null,
      externalId: `t-topup-${user.id}`,
    })
    const before = await balanceOf(user.id)
    const failing = new MockProvider()
    failing.composeDocument = async () => {
      const { AiProviderError } = await import('#services/ai/types')
      throw new AiProviderError('boom', false)
    }
    setProviderOverride(failing)
    const ok = await client
      .post(`/api/boards/${board.id}/design-doc`)
      .headers({ cookie: cookies })
      .json({})
    ok.assertStatus(202)
    assert.isBelow(await balanceOf(user.id), before)
    await runPendingJobs()
    const doc = await DesignDoc.findOrFail(ok.body().data.doc.id)
    assert.equal(doc.status, 'failed')
    assert.equal(await balanceOf(user.id), before, 'kredyty wróciły')
  })

  test('plan Free: 1 tablica, bez Pro reasoning i eksportów', async ({ client, assert }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user)

    const second = await client
      .post('/boards')
      .headers({ cookie: cookies })
      .form({ title: 'Druga' })
      .redirects(0)
    second.assertStatus(302)
    assert.equal(second.header('location'), '/billing')
    assert.equal(
      await Board.query()
        .where('user_id', user.id)
        .count('* as n')
        .then((r) => Number(r[0].$extras.n)),
      1
    )

    const pro = await client
      .post(`/api/boards/${board.id}/design-doc`)
      .headers({ cookie: cookies })
      .json({ proMode: true })
    pro.assertStatus(403)

    const exp = await client
      .get(`/api/boards/${board.id}/design-doc/export?format=css`)
      .headers({ cookie: cookies })
    exp.assertStatus(403)
  })

  test('webhook: zły podpis → 401; zakup pakietu nalicza raz i daje plan PAYG', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const payload = orderPayload(user, 'ord-1', VARIANTS.pack_s)

    const bad = await webhook(client, payload, 'deadbeef')
    bad.assertStatus(401)
    assert.equal(await planFor(user.id), 'free')

    const ok = await webhook(client, payload)
    ok.assertStatus(200)
    const replay = await webhook(client, payload)
    replay.assertStatus(200)

    const packs = await CreditGrant.query().where('user_id', user.id).where('source', 'pack')
    assert.lengthOf(packs, 1, 'powtórzony webhook nie nalicza drugi raz')
    assert.equal(packs[0].amount, products.pack_s.credits)
    assert.equal(await planFor(user.id), 'payg')

    // Zwrot płatności cofa niewykorzystane kredyty i plan.
    const refund = await webhook(client, {
      ...payload,
      meta: { ...payload.meta, event_name: 'order_refunded' },
    })
    refund.assertStatus(200)
    await packs[0].refresh()
    assert.equal(packs[0].remaining, 0)
    assert.equal(await planFor(user.id), 'free')
  })

  test('webhook: subskrypcja Pro → plan pro, kredyty za każdą opłaconą fakturę', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const custom = { user_id: String(user.id) }
    const subAttrs = {
      customer_id: 77,
      variant_id: VARIANTS.pro,
      status: 'active',
      renews_at: DateTime.utc().plus({ months: 1 }).toISO(),
      ends_at: null,
      user_email: user.email,
    }
    ;(
      await webhook(client, {
        meta: { event_name: 'subscription_created', custom_data: custom },
        data: { id: 'sub-9', type: 'subscriptions', attributes: subAttrs },
      })
    ).assertStatus(200)
    assert.equal(await planFor(user.id), 'pro')

    for (const invoice of ['inv-1', 'inv-1', 'inv-2']) {
      ;(
        await webhook(client, {
          meta: { event_name: 'subscription_payment_success', custom_data: custom },
          data: {
            id: invoice,
            type: 'subscription-invoices',
            attributes: { subscription_id: 'sub-9', status: 'paid', user_email: user.email },
          },
        })
      ).assertStatus(200)
    }
    const subs = await CreditGrant.query().where('user_id', user.id).where('source', 'subscription')
    assert.lengthOf(subs, 2)
    assert.equal(subs[0].amount, products.pro.credits)

    // Wygasła subskrypcja → z powrotem Free.
    ;(
      await webhook(client, {
        meta: { event_name: 'subscription_expired', custom_data: custom },
        data: {
          id: 'sub-9',
          type: 'subscriptions',
          attributes: { ...subAttrs, status: 'expired' },
        },
      })
    ).assertStatus(200)
    assert.equal(await planFor(user.id), 'free')
  })

  test('plan płatny: eksporty tokenów, bez stopki, pełna historia wersji', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    ;(await webhook(client, orderPayload(user, 'ord-exp', VARIANTS.pack_s))).assertStatus(200)
    const board = await createBoard(user)
    await seedBoard(client, cookies, board)

    for (let i = 0; i < 3; i++) {
      ;(
        await client
          .post(`/api/boards/${board.id}/design-doc`)
          .headers({ cookie: cookies })
          .json({ force: true })
      ).assertStatus(202)
      await runPendingJobs()
    }
    const doc = await DesignDoc.query()
      .where('board_id', board.id)
      .orderBy('version', 'desc')
      .firstOrFail()
    assert.equal(doc.status, 'ready', doc.error ?? '')
    assert.notInclude(doc.contentMd!, 'canvai (', 'bez stopki w planie płatnym')

    const list = await client
      .get(`/api/boards/${board.id}/design-docs`)
      .headers({ cookie: cookies })
    assert.lengthOf(list.body().data, 3)

    const css = await client
      .get(`/api/boards/${board.id}/design-doc/export?format=css`)
      .headers({ cookie: cookies })
    css.assertStatus(200)
    assert.include(css.text(), ':root {')
    const tw = await client
      .get(`/api/boards/${board.id}/design-doc/export?format=tailwind`)
      .headers({ cookie: cookies })
    assert.include(tw.text(), '@theme {')
    const tokens = await client
      .get(`/api/boards/${board.id}/design-doc/export?format=tokens`)
      .headers({ cookie: cookies })
    tokens.assertStatus(200)
    const json = JSON.parse(tokens.text())
    const firstColor = Object.values(json.color)[0] as { $type: string; $value: string }
    assert.equal(firstColor.$type, 'color')
    assert.match(firstColor.$value, /^#[0-9a-f]{6}$/i)
  })

  test('plan Free widzi tylko 2 ostatnie wersje', async ({ client, assert }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user)
    for (let v = 1; v <= 3; v++) {
      await DesignDoc.create({
        boardId: board.id,
        version: v,
        status: 'ready',
        contentMd: `# v${v}`,
      })
    }
    const list = await client
      .get(`/api/boards/${board.id}/design-docs`)
      .headers({ cookie: cookies })
    assert.deepEqual(
      list.body().data.map((d: { version: number }) => d.version),
      [3, 2]
    )
    assert.equal(list.body().meta.hiddenVersions, 1)
    const old = await client
      .get(`/api/boards/${board.id}/design-doc?version=1`)
      .headers({ cookie: cookies })
    old.assertStatus(403)
  })

  test('rejestracja z jednorazowej skrzynki jest blokowana', async ({ client, assert }) => {
    assert.isTrue(isDisposableEmail('x@mailinator.com'))
    assert.isTrue(isDisposableEmail('x@abc.mailinator.com'))
    assert.isFalse(isDisposableEmail('x@gmail.com'))

    const email = `temp-${Date.now()}@yopmail.com`
    const res = await client
      .post('/signup')
      .header('accept', 'application/json')
      .json({ fullName: null, email, password: 'password123', passwordConfirmation: 'password123' })
    res.assertStatus(422)
    assert.equal(res.body().errors[0].field, 'email')
    assert.equal(res.body().errors[0].rule, 'disposable')
    assert.isNull(await User.findBy('email', email))
  })

  test('polecenie: link zapisuje polecającego, nagroda po potwierdzeniu e-maila — raz', async ({
    client,
    assert,
  }) => {
    const referrer = await makeUser('referrer')
    const code = await referralCodeFor(referrer)
    assert.match(code, /^[a-z0-9]{8}$/)
    assert.equal(await referralCodeFor(referrer), code, 'kod jest stały')

    // HTTP: /signup?ref= ustawia cookie, rejestracja zapisuje polecającego.
    const page = await client.get(`/signup?ref=${code}`)
    const refCookie = ([] as string[])
      .concat(page.headers()['set-cookie'] ?? [])
      .find((c) => c.startsWith('dc_ref='))
    assert.exists(refCookie)
    const email = `invited-${Date.now()}@test.com`
    const res = await client
      .post('/signup')
      .header('cookie', refCookie!.split(';')[0])
      .json({ fullName: null, email, password: 'password123', passwordConfirmation: 'password123' })
      .redirects(0)
    assert.equal(res.header('location'), '/verify-email')
    const invited = await User.findByOrFail('email', email)
    assert.equal(invited.referredById, referrer.id)

    // Bez potwierdzonego e-maila nie ma nagrody.
    assert.isFalse(await rewardReferral(invited))
    invited.emailVerifiedAt = DateTime.utc()
    await invited.save()
    assert.isTrue(await rewardReferral(invited))
    assert.isFalse(await rewardReferral(invited), 'drugi raz nic')

    const bonus = (userId: number) =>
      CreditGrant.query().where('user_id', userId).where('source', 'referral')
    assert.lengthOf(await bonus(invited.id), 1)
    assert.lengthOf(await bonus(referrer.id), 1)

    // Samego siebie polecić się nie da.
    const self = await makeUser('self')
    await attachReferrer(self, await referralCodeFor(self))
    assert.notExists(self.referredById)
  })

  test('podgląd UI: kosztuje kredyty, serwowany w piaskownicy, błąd = zwrot', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user)
    await seedBoard(client, cookies, board)

    // Bez gotowego dokumentu nie ma podglądu.
    const early = await client
      .post(`/api/boards/${board.id}/design-doc/preview`)
      .headers({ cookie: cookies })
      .json({})
    early.assertStatus(422)

    ;(await client.post(`/api/boards/${board.id}/design-doc`).headers({ cookie: cookies }).json({})).assertStatus(202)
    await runPendingJobs()
    const before = await balanceOf(user.id)

    const post = await client
      .post(`/api/boards/${board.id}/design-doc/preview`)
      .headers({ cookie: cookies })
      .json({})
    post.assertStatus(202)
    assert.equal(await balanceOf(user.id), before - costs.preview)
    await runPendingJobs()

    const show = await client
      .get(`/api/boards/${board.id}/design-doc/preview?version=1`)
      .headers({ cookie: cookies })
    const dto = show.body().data
    assert.equal(dto.status, 'ready', dto.error)
    assert.equal(dto.creditsCharged, costs.preview)

    const html = await client.get(dto.url).headers({ cookie: cookies })
    html.assertStatus(200)
    assert.include(html.text(), '<!doctype html>')
    assert.notInclude(html.text(), '<script')
    const csp = html.header('content-security-policy')
    assert.include(csp, 'sandbox')
    assert.include(csp, "default-src 'none'")

    // Gotowy podgląd bez `force` — bez opłaty.
    const again = await client
      .post(`/api/boards/${board.id}/design-doc/preview`)
      .headers({ cookie: cookies })
      .json({})
    again.assertStatus(200)
    assert.equal(await balanceOf(user.id), before - costs.preview)

    // Obcy nie zobaczy HTML.
    const stranger = await makeUser('stranger')
    const strangerCookies = await login(client, stranger)
    ;(await client.get(dto.url).headers({ cookie: strangerCookies })).assertStatus(404)

    // Błąd modelu → zwrot kredytów.
    const failing = new MockProvider()
    failing.composePreview = async () => {
      const { AiProviderError } = await import('#services/ai/types')
      throw new AiProviderError('boom', false)
    }
    setProviderOverride(failing)
    const mid = await balanceOf(user.id)
    ;(
      await client
        .post(`/api/boards/${board.id}/design-doc/preview`)
        .headers({ cookie: cookies })
        .json({ force: true })
    ).assertStatus(202)
    await runPendingJobs()
    const failed = await DesignPreview.query().orderBy('id', 'desc').firstOrFail()
    assert.equal(failed.status, 'failed')
    assert.equal(await balanceOf(user.id), mid)
  })

  test('sanitizePreviewHtml usuwa skrypty, handlery i obce zasoby', ({ assert }) => {
    const dirty = `<html><head><script>alert(1)</script><link rel="stylesheet" href="https://evil.test/x.css">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><meta http-equiv="refresh" content="0;url=https://evil.test"></head>
      <body onload="steal()"><a href="javascript:alert(1)">x</a><iframe src="https://evil.test"></iframe><img src=x onerror=alert(1)></body></html>`
    const clean = sanitizePreviewHtml(dirty)
    assert.notInclude(clean, '<script')
    assert.notInclude(clean, 'evil.test')
    assert.notInclude(clean, 'onload')
    assert.notInclude(clean, 'onerror')
    assert.notInclude(clean, 'javascript:')
    assert.include(clean, 'fonts.googleapis.com')
  })

  test('API v1 i MCP: token Bearer, płatny plan, DESIGN.md i tokeny', async ({ client, assert }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user, 'Studio Mono')
    await seedBoard(client, cookies, board)
    ;(await client.post(`/api/boards/${board.id}/design-doc`).headers({ cookie: cookies }).json({})).assertStatus(202)
    await runPendingJobs()

    const { token } = await createApiToken(user, 'test')
    const auth = { authorization: `Bearer ${token}` }

    // Bez tokenu / zły token → 401; plan Free → 403.
    ;(await client.get('/api/v1/boards')).assertStatus(401)
    ;(await client.get('/api/v1/boards').headers({ authorization: 'Bearer cvai_nope_nope_nope_nope' })).assertStatus(401)
    ;(await client.get('/api/v1/boards').headers(auth)).assertStatus(403)

    // Zakup pakietu → dostęp.
    ;(await webhook(client, orderPayload(user, `ord-api-${user.id}`, VARIANTS.pack_s))).assertStatus(200)

    const boards = await client.get('/api/v1/boards').headers(auth)
    boards.assertStatus(200)
    assert.equal(boards.body().data[0].title, 'Studio Mono')
    assert.equal(boards.body().data[0].designMd.version, 1)

    const md = await client.get(`/api/v1/boards/${board.id}/design-md`).headers(auth)
    md.assertStatus(200)
    assert.include(md.text(), 'Style Reference')
    const css = await client.get(`/api/v1/boards/${board.id}/tokens?format=css`).headers(auth)
    assert.include(css.text(), ':root {')

    // Cudza tablica niewidoczna.
    const other = await makeUser('other')
    const otherBoard = await createBoard(other)
    ;(await client.get(`/api/v1/boards/${otherBoard.id}/design-md`).headers(auth)).assertStatus(404)

    // MCP
    const rpc = (body: unknown) =>
      client.post('/mcp').headers({ ...auth, accept: 'application/json, text/event-stream' }).json(body)

    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    })
    init.assertStatus(200)
    assert.equal(init.body().result.protocolVersion, '2025-06-18')
    assert.equal(init.body().result.serverInfo.name, 'canvai')

    ;(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).assertStatus(202)

    const tools = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    assert.sameMembers(
      tools.body().result.tools.map((tl: { name: string }) => tl.name),
      ['list_boards', 'get_design_md', 'get_design_tokens']
    )

    const call = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_design_md', arguments: { board_id: board.id } },
    })
    assert.include(call.body().result.content[0].text, 'Style Reference')

    const tw = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_design_tokens', arguments: { board_id: board.id, format: 'tailwind' } },
    })
    assert.include(tw.body().result.content[0].text, '@theme {')

    const missing = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'get_design_md', arguments: { board_id: otherBoard.id } },
    })
    assert.isTrue(missing.body().result.isError)

    const res = await rpc({ jsonrpc: '2.0', id: 6, method: 'resources/list' })
    const uri = res.body().result.resources[0].uri
    assert.equal(uri, `canvai://boards/${board.id}/design-md`)
    const read = await rpc({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri } })
    assert.equal(read.body().result.contents[0].mimeType, 'text/markdown')

    const unknown = await rpc({ jsonrpc: '2.0', id: 8, method: 'nope' })
    assert.equal(unknown.body().error.code, -32601)
    ;(await client.get('/mcp')).assertStatus(405)

    // Odwołany token przestaje działać.
    await ApiToken.query().where('user_id', user.id).update({ revoked_at: DateTime.utc().toSQL() })
    ;(await client.get('/api/v1/boards').headers(auth)).assertStatus(401)
  })

  test('ustawienia: utworzenie i odwołanie tokenu API', async ({ client, assert }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const created = await client
      .post('/settings/api-tokens')
      .headers({ cookie: cookies })
      .form({ name: 'Laptop' })
      .redirects(0)
    created.assertStatus(302)
    const row = await ApiToken.query().where('user_id', user.id).firstOrFail()
    assert.equal(row.name, 'Laptop')
    assert.match(row.prefix, /^cvai_/)
    assert.lengthOf(row.tokenHash, 64)

    await client.delete(`/settings/api-tokens/${row.id}`).headers({ cookie: cookies }).redirects(0)
    await row.refresh()
    assert.isNotNull(row.revokedAt)
  })

  test('portal klienta: link, przesyłanie do skrzynki, akceptacja, odwołanie', async ({
    client,
    assert,
  }) => {
    const fake = mail.fake()
    try {
      const owner = await makeUser('owner')
      const cookies = await login(client, owner)
      const board = await createBoard(owner, 'Portal Test')

      // Free → portal zablokowany.
      ;(await client.put(`/api/boards/${board.id}/share`).headers({ cookie: cookies }).json({ enabled: true })).assertStatus(403)

      ;(await webhook(client, orderPayload(owner, `ord-portal-${owner.id}`, VARIANTS.pack_s))).assertStatus(200)
      const on = await client.put(`/api/boards/${board.id}/share`).headers({ cookie: cookies }).json({ enabled: true })
      on.assertStatus(200)
      const url: string = on.body().data.url
      const path = new URL(url).pathname
      assert.match(path, /^\/c\/[A-Za-z0-9_-]{20,}$/)

      // Klient bez konta widzi portal.
      ;(await client.get(path)).assertStatus(200)

      // Przesłanie pliku z notatką → skrzynka właściciela + mail.
      const sent = await client
        .post(`${path}/materials`)
        .field('name', 'Klient ACME')
        .field('note', 'Nasze nowe logo')
        .file('files[]', await png({ r: 10, g: 20, b: 30 }), { filename: 'logo.png', contentType: 'image/png' })
        .redirects(0)
      sent.assertStatus(302)
      const inbox = await Asset.query().where('board_id', board.id).where('inbox', true)
      assert.lengthOf(inbox, 1)
      assert.equal(inbox[0].submittedBy, 'Klient ACME')
      assert.equal(inbox[0].userNote, 'Nasze nowe logo')
      fake.messages.assertSentCount(1)

      // Ten sam plik ponownie (deduplikacja) nie tworzy nic nowego ani nie nadpisuje notatki.
      ;(
        await client
          .post(`${path}/materials`)
          .field('name', 'Ktoś inny')
          .field('note', 'Inna notatka')
          .file('files[]', await png({ r: 10, g: 20, b: 30 }), { filename: 'kopia.png', contentType: 'image/png' })
          .redirects(0)
      ).assertStatus(302)
      await inbox[0].refresh()
      assert.equal(inbox[0].userNote, 'Nasze nowe logo')
      assert.equal(inbox[0].submittedBy, 'Klient ACME')
      fake.messages.assertSentCount(2)
      assert.equal(await PortalFeedback.query().where('board_id', board.id).where('decision', 'note').count('* as n').then((r) => Number(r[0].$extras.n)), 1)

      // Sprzątanie sierot nie usuwa materiałów ze skrzynki.
      await pruneOrphanAssets(board.id)
      assert.lengthOf(await Asset.query().where('board_id', board.id), 1)

      // Właściciel umieszcza materiał na płótnie.
      const accepted = await client.post(`/api/assets/${inbox[0].id}/accept`).headers({ cookie: cookies })
      accepted.assertStatus(200)
      assert.isFalse(accepted.body().data.inbox)

      // Akceptacja DESIGN.md.
      await DesignDoc.create({ boardId: board.id, version: 1, status: 'ready', contentMd: '# Portal' })
      ;(
        await client
          .post(`${path}/feedback`)
          .json({ name: 'Klient ACME', decision: 'approved', version: 1 })
          .redirects(0)
      ).assertStatus(302)
      const feedback = await PortalFeedback.query().where('board_id', board.id).where('decision', 'approved').firstOrFail()
      assert.equal(feedback.version, 1)
      fake.messages.assertSentCount(3)

      // Nowy link: stary przestaje działać; wyłączenie: link znika.
      const rotated = await client.post(`/api/boards/${board.id}/share/rotate`).headers({ cookie: cookies })
      assert.notEqual(rotated.body().data.url, url)
      ;(await client.get(path)).assertStatus(404)
      const newPath = new URL(rotated.body().data.url).pathname
      ;(await client.put(`/api/boards/${board.id}/share`).headers({ cookie: cookies }).json({ enabled: false })).assertStatus(200)
      ;(await client.get(newPath)).assertStatus(404)
    } finally {
      mail.restore()
    }
  })
})
