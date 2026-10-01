import { DateTime } from 'luxon'
import sharp from 'sharp'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Asset from '#models/asset'
import Board from '#models/board'
import User from '#models/user'
import { extractStyles, figmaApi, parseFigmaUrl } from '#services/figma_import'

const FILE = 'AbCdEf1234567890XyZ'

function figmaNode(overrides: Record<string, unknown> = {}) {
  return {
    id: '1:2',
    name: 'Home',
    type: 'FRAME',
    absoluteBoundingBox: { width: 1440, height: 900 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    styles: { fill: 'S:bg' },
    children: [
      {
        id: '1:3',
        name: 'Title',
        type: 'TEXT',
        fills: [{ type: 'SOLID', color: { r: 0.059, g: 0.09, b: 0.165, a: 1 } }],
        styles: { text: 'S:h1' },
        style: { fontFamily: 'Fraunces', fontWeight: 700, fontSize: 48, lineHeightPx: 56 },
      },
      {
        id: '1:4',
        name: 'Button',
        type: 'RECTANGLE',
        cornerRadius: 12,
        fills: [{ type: 'SOLID', color: { r: 0.85, g: 0.35, b: 0.2, a: 1 } }],
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { r: 0, g: 0, b: 0, a: 0.12 },
            offset: { x: 0, y: 4 },
            radius: 12,
          },
        ],
      },
    ],
    ...overrides,
  }
}

test.group('Import z Figmy', (group) => {
  const saved = { ...figmaApi }
  let calls: string[] = []
  let tokenOk = 'figd_valid_token_1234567890'

  group.each.setup(async () => {
    calls = []
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 250, g: 250, b: 250 } },
    })
      .png()
      .toBuffer()
    figmaApi.fetch = async (url: string, init?: RequestInit) => {
      calls.push(url)
      const token = (init?.headers as Record<string, string>)['X-Figma-Token']
      if (token !== tokenOk) return new Response('{}', { status: 403 })
      const path = new URL(url).pathname
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
      if (path === `/v1/files/${FILE}`) {
        return json({
          name: 'Kawiarnia UI',
          document: {
            id: '0:0',
            name: 'Doc',
            type: 'DOCUMENT',
            children: [{ id: '0:1', name: 'Page', type: 'CANVAS', children: [figmaNode()] }],
          },
          styles: { 'S:bg': { name: 'Surface/Base' } },
        })
      }
      if (path === `/v1/files/${FILE}/nodes`) {
        return json({
          nodes: { '1:2': { document: figmaNode(), styles: { 'S:h1': { name: 'Heading/H1' } } } },
        })
      }
      if (path === `/v1/images/${FILE}`)
        return json({
          err: null,
          images: { '1:2': 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/x.png' },
        })
      return new Response('{}', { status: 404 })
    }
    figmaApi.download = async () => ({ status: 200, contentType: 'image/png', body: png })
    return testUtils.db().withGlobalTransaction()
  })
  group.each.teardown(() => {
    Object.assign(figmaApi, saved)
  })

  async function login(client: any) {
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `figma-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'password123',
    })
    const res = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    const board = await Board.create({ title: 'F', slug: `f-${Date.now()}`, userId: user.id })
    return { user, board, cookies: res.headers()['set-cookie'] }
  }

  test('parseFigmaUrl i style z drzewa węzłów', ({ assert }) => {
    assert.deepEqual(
      parseFigmaUrl(`https://www.figma.com/design/${FILE}/Kawiarnia?node-id=12-34&t=x`),
      {
        fileKey: FILE,
        nodeId: '12:34',
      }
    )
    assert.deepEqual(parseFigmaUrl(`https://figma.com/file/${FILE}/x`), {
      fileKey: FILE,
      nodeId: null,
    })
    assert.isNull(parseFigmaUrl('https://example.com/design/abc'))
    const styles = extractStyles([figmaNode() as any], {
      'S:bg': 'Surface/Base',
      'S:h1': 'Heading/H1',
    })
    assert.deepInclude(styles.text, {
      family: 'Fraunces',
      size: 48,
      weight: 700,
      lineHeight: 56,
      count: 1,
      style: 'Heading/H1',
    })
    assert.equal(styles.radii[0].value, 12)
    assert.equal(styles.shadows[0].css, '0px 4px 12px 0px rgba(0, 0, 0, 0.12)')
    assert.isTrue(styles.colors.some((c) => c.hex === '#ffffff' && c.style === 'Surface/Base'))
  })

  test('import: ramka jako obraz, notatka z dokładnymi stylami, token zapamiętany zaszyfrowany', async ({
    client,
    assert,
  }) => {
    const { user, board, cookies } = await login(client)
    const res = await client
      .post(`/api/boards/${board.id}/import-figma`)
      .headers({ cookie: cookies })
      .json({ url: `https://www.figma.com/design/${FILE}/Kawiarnia`, token: tokenOk })
    res.assertStatus(201)
    const data = res.body().data
    assert.equal(data.summary.frames, 1)
    assert.deepEqual(data.summary.fonts, ['Fraunces'])
    assert.include(data.note, 'Fraunces 48px/56px 700 “Heading/H1”')
    assert.include(data.note, 'Corner radius: 12px')
    const asset = await Asset.findOrFail(data.assets[0].id)
    assert.equal(asset.kind, 'image')
    assert.include(asset.userNote ?? '', 'Kawiarnia UI — Home')

    await user.refresh()
    assert.isNotNull(user.figmaToken)
    assert.notInclude(user.figmaToken!, tokenOk, 'token zaszyfrowany')

    // Drugi import bez tokenu — używa zapamiętanego.
    const again = await client
      .post(`/api/boards/${board.id}/import-figma`)
      .headers({ cookie: cookies })
      .json({ url: `https://www.figma.com/design/${FILE}/Kawiarnia?node-id=1-2` })
    again.assertStatus(201)
  })

  test('błędy: zły link, brak tokenu, odrzucony token', async ({ client }) => {
    const { board, cookies } = await login(client)
    const post = (body: Record<string, unknown>) =>
      client.post(`/api/boards/${board.id}/import-figma`).headers({ cookie: cookies }).json(body)
    ;(await post({ url: 'https://example.com/x' })).assertStatus(422)
    ;(await post({ url: `https://www.figma.com/design/${FILE}/x` })).assertBodyContains({
      code: 'E_FIGMA_TOKEN',
    })
    ;(
      await post({
        url: `https://www.figma.com/design/${FILE}/x`,
        token: 'figd_wrong_token_000000000',
      })
    ).assertStatus(401)
  })
})
