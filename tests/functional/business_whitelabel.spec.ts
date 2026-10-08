import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import { domainDeps, verificationRecord } from '#services/portal_domain'

const originalResolve = domainDeps.resolveTxt
import testUtils from '@adonisjs/core/services/test_utils'
import Board from '#models/board'
import BoardShare from '#models/board_share'
import Subscription from '#models/subscription'
import User from '#models/user'
import { billing, polar, products } from '#config/billing'
import { normalizeTaxId } from '#services/billing/polar'
import { printBrand } from '#services/portal'
import { renderDesignMd } from '#services/design/renderer'
import { validateDesignSpec } from '#services/design/spec'

let seq = 0
async function account(client: any) {
  const user = await User.create({
    emailVerifiedAt: DateTime.utc(),
    email: `biz-${Date.now()}-${++seq}@test.com`,
    password: 'password123',
  })
  const res = await client
    .post('/login')
    .json({ email: user.email, password: 'password123' })
    .redirects(0)
  return { user, cookies: res.headers()['set-cookie'] as string[] }
}

test.group('Zakupy firmowe i white-label', (group) => {
  const saved = {
    token: polar.accessToken,
    pro: products.pro.polarProductId,
    enforced: billing.enforced,
    fetch: globalThis.fetch,
  }
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    polar.accessToken = saved.token
    products.pro.polarProductId = saved.pro
    billing.enforced = saved.enforced
    globalThis.fetch = saved.fetch
  })

  test('NIP: normalizacja i walidacja', ({ assert }) => {
    assert.equal(normalizeTaxId('123-456-78-90'), 'PL1234567890')
    assert.equal(normalizeTaxId('pl 1234567890'), 'PL1234567890')
    assert.equal(normalizeTaxId('DE123456789'), 'DE123456789')
    assert.isNull(normalizeTaxId('abc'))
  })

  test('checkout firmowy przekazuje dane do Polar i zapamiętuje profil', async ({
    client,
    assert,
  }) => {
    polar.accessToken = 'polar_test_token'
    products.pro.polarProductId = 'prod_pro'
    const bodies: any[] = []
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).includes('/v1/checkouts/')) {
        bodies.push(JSON.parse(init.body))
        return new Response(JSON.stringify({ url: 'https://polar.sh/checkout/abc' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      return saved.fetch(url, init)
    }) as typeof fetch
    const { user, cookies } = await account(client)

    const bad = await client
      .post('/billing/checkout')
      .headers({ cookie: cookies })
      .form({ product: 'pro', business: 'true', company: 'ACME', taxId: 'x' })
      .redirects(0)
    assert.equal(bad.header('location'), '/billing')
    assert.lengthOf(bodies, 0)

    const ok = await client
      .post('/billing/checkout')
      .headers({ 'cookie': cookies, 'x-inertia': 'true' })
      .form({ product: 'pro', business: 'true', company: 'ACME sp. z o.o.', taxId: '1234567890' })
      .redirects(0)
    assert.equal(ok.status(), 409, 'inertia.location')
    assert.lengthOf(bodies, 1)
    assert.include(bodies[0], {
      is_business_customer: true,
      require_billing_address: true,
      customer_tax_id: 'PL1234567890',
      customer_name: 'ACME sp. z o.o.',
      external_customer_id: String(user.id),
    })
    await user.refresh()
    assert.equal(user.billingTaxId, 'PL1234567890')
  })

  test('white-label: plan Agency + nazwa marki → portal, PDF i DESIGN.md bez canvai', async ({
    client,
    assert,
  }) => {
    billing.enforced = true
    const { user, cookies } = await account(client)

    // Bez planu Agency marka się nie włącza (i nie da się jej zapisać).
    user.brandName = 'Studio Północ'
    await user.save()
    assert.isFalse((await printBrand(user.id)).whiteLabel)
    const denied = await client
      .patch('/settings/brand')
      .headers({ cookie: cookies })
      .form({ brandName: 'X' })
      .redirects(0)
    assert.equal(denied.status(), 302)
    await user.refresh()
    assert.equal(user.brandName, 'Studio Północ')

    await Subscription.create({
      userId: user.id,
      provider: 'polar',
      externalId: `sub-agency-${seq}`,
      plan: 'agency',
      status: 'active',
    } as any)
    ;(
      await client
        .patch('/settings/brand')
        .headers({ cookie: cookies })
        .form({
          brandName: 'Studio Północ',
          brandAccent: '#123456',
          portalDomain: 'projekty.polnoc.pl',
        })
        .redirects(0)
    ).assertStatus(302)
    const brand = await printBrand(user.id)
    assert.deepInclude(brand, { name: 'Studio Północ', accent: '#123456', whiteLabel: true })

    // Link portalu używa własnej domeny.
    const board = await Board.create({ title: 'Klient', slug: `k-${seq}`, userId: user.id })
    await BoardShare.create({
      boardId: board.id,
      token: `tok${'x'.repeat(28)}${seq}`,
      allowUpload: true,
      showDoc: true,
    })
    // SEC-10: bez weryfikacji TXT link zostaje na adresie aplikacji.
    const before = await client.get(`/api/boards/${board.id}/share`).headers({ cookie: cookies })
    assert.notInclude(before.body().data.url, 'polnoc.pl')
    await user.refresh()
    const record = verificationRecord('projekty.polnoc.pl', user.portalDomainToken!)
    domainDeps.resolveTxt = async (name: string) =>
      name === record.name ? [['canvai-verify=wrong'], [record.value]] : []
    try {
      ;(
        await client.post('/settings/brand/domain/verify').headers({ cookie: cookies }).redirects(0)
      ).assertStatus(302)
    } finally {
      domainDeps.resolveTxt = originalResolve
    }
    await user.refresh()
    assert.isNotNull(user.portalDomainVerifiedAt)
    const share = await client.get(`/api/boards/${board.id}/share`).headers({ cookie: cookies })
    assert.match(share.body().data.url, /^https:\/\/projekty\.polnoc\.pl\/c\//)

    // Ograniczenie ścieżek na domenie agencji: tests/unit/host_middleware.spec.ts
    // (serwer Vite w testach sam blokuje obce hosty).

    // Nagłówek DESIGN.md.
    const spec = validateDesignSpec({
      name: 'K',
      overview: 'x',
      colors: [{ name: 'A', hex: '#000000' }],
      typography: { families: [{ name: 'Inter' }] },
      components: [{ name: 'B', description: 'c' }],
      dos: ['a'],
      donts: ['b'],
    })
    const { markdown } = renderDesignMd(spec, [], {
      boardTitle: 'Klient',
      version: 1,
      generatedAt: 'now',
      preparedBy: brand.name,
    })
    assert.include(markdown, 'Prepared by Studio Północ from the board')
    assert.notInclude(markdown, 'canvai')
  })
})
