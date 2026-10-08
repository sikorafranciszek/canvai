import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Board from '#models/board'
import BoardRepo from '#models/board_repo'
import DesignDoc from '#models/design_doc'
import { githubDeps } from '#services/github_sync'
import { runPendingJobs } from '#services/queue'
import { validateDesignSpec } from '#services/design/spec'

/** Atrapa API GitHuba: gałęzie, pliki per gałąź, pull requesty. */
function fakeGitHub(opts: { existingClaude?: boolean; permissions?: boolean } = {}) {
  const calls: { method: string; path: string; body?: any; auth?: string }[] = []
  const files = new Map<string, string>() // `${branch}:${path}` → treść
  if (opts.existingClaude) files.set('main:CLAUDE.md', '# Our rules')
  const refs = new Set(['main'])
  const pulls: { head: string; body: string; title: string }[] = []
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const auth = (init?.headers as Record<string, string>)?.Authorization
    calls.push({ method, path: u.pathname, body, auth })
    if (auth !== 'Bearer github_pat_good_token_123456')
      return json(401, { message: 'Bad credentials' })
    const p = u.pathname.replace('/repos/acme/web', '')
    if (method === 'GET' && p === '')
      return json(200, { default_branch: 'main', permissions: { push: opts.permissions ?? true } })
    if (method === 'GET' && p.startsWith('/git/ref/heads/'))
      return refs.has(p.slice(15)) ? json(200, { object: { sha: 'abc' } }) : json(404, {})
    if (method === 'POST' && p === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '')
      if (refs.has(name)) return json(422, { message: 'Reference already exists' })
      refs.add(name)
      for (const [k, v] of [...files])
        if (k.startsWith('main:')) files.set(`${name}:${k.slice(5)}`, v)
      return json(201, {})
    }
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice(10))
      const branch = method === 'GET' ? u.searchParams.get('ref')! : body.branch
      const key = `${branch}:${path}`
      if (method === 'GET') {
        return files.has(key)
          ? json(200, {
              sha: 'sha-' + path,
              content: Buffer.from(files.get(key)!).toString('base64'),
            })
          : json(404, {})
      }
      files.set(key, Buffer.from(body.content, 'base64').toString('utf8'))
      return json(files.has(key) && body.sha ? 200 : 201, {})
    }
    if (method === 'POST' && p === '/pulls') {
      if (pulls.some((x) => x.head === body.head)) return json(422, { message: 'exists' })
      pulls.push(body)
      return json(201, { html_url: `https://github.com/acme/web/pull/${pulls.length}` })
    }
    if (method === 'GET' && p === '/pulls')
      return json(200, [{ html_url: `https://github.com/acme/web/pull/${pulls.length}` }])
    return json(404, {})
  }
  return { fetch, calls, files, pulls }
}

test.group('GitHub sync (FEAT-5)', (group) => {
  const original = githubDeps.fetch
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    githubDeps.fetch = original
  })

  async function setup(client: any) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `gh-${suffix}@test.com`,
      password: 'password123',
      fullName: 'Ola',
    })
    const res = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    const board = await Board.create({ title: 'Sklep', slug: `gh-${suffix}`, userId: user.id })
    const spec = (hex: string) =>
      validateDesignSpec({
        name: 'Sklep',
        overview: 'Shop [A1]',
        colors: [{ name: 'Brand', hex, sources: [] }],
        typography: { families: [{ name: 'Inter', sources: [] }], scale: [] },
        components: [{ name: 'Button', description: 'Primary', sources: [] }],
        dos: ['Use Brand for actions'],
        donts: ['No gradients'],
      })
    for (const [version, hex] of [
      [1, '#112233'],
      [2, '#445566'],
    ] as const) {
      await DesignDoc.create({
        boardId: board.id,
        version,
        status: 'ready',
        contentMd: `# DESIGN v${version}`,
        spec: spec(hex),
        promptVersion: 'v7',
        proMode: false,
      })
    }
    return { user, board, cookies: res.headers()['set-cookie'] }
  }

  test('połączenie, PR po akceptacji z plikami i opisem zmian; CLAUDE.md nie nadpisany', async ({
    client,
    assert,
  }) => {
    const gh = fakeGitHub({ existingClaude: true })
    githubDeps.fetch = gh.fetch as never
    const { board, cookies } = await setup(client)

    // Zły token → 422 z przyczyną; dobry → połączenie (token nie wraca do klienta).
    const bad = await client
      .put(`/api/boards/${board.id}/repo`)
      .headers({ cookie: cookies })
      .json({ repo: 'acme/web', token: 'github_pat_wrong_token_00000' })
    bad.assertStatus(422)
    assert.include(bad.body().message, '401')
    const ok = await client
      .put(`/api/boards/${board.id}/repo`)
      .headers({ cookie: cookies })
      .json({ repo: 'acme/web', token: 'github_pat_good_token_123456', directory: 'docs' })
    ok.assertStatus(200)
    assert.equal(ok.body().data.baseBranch, 'main')
    assert.notProperty(ok.body().data, 'token')
    const row = await BoardRepo.findByOrFail('boardId', board.id)
    assert.notInclude(row.token, 'github_pat_good')

    // Akceptacja v2 → zadanie → PR.
    ;(
      await client
        .post(`/api/boards/${board.id}/design-doc/approve`)
        .headers({ cookie: cookies })
        .json({ version: 2 })
    ).assertStatus(200)
    await runPendingJobs()
    await row.refresh()
    assert.isNull(row.lastError)
    assert.equal(row.lastVersion, 2)
    assert.equal(row.lastPrUrl, 'https://github.com/acme/web/pull/1')
    assert.equal(gh.files.get('canvai/design-v2:docs/DESIGN.md'), '# DESIGN v2')
    assert.include(gh.files.get('canvai/design-v2:docs/tokens.css')!, '#445566')
    assert.isTrue(gh.files.has('canvai/design-v2:.cursor/rules/design-system.mdc'))
    assert.equal(gh.files.get('canvai/design-v2:CLAUDE.md'), '# Our rules', 'bez nadpisania')
    const pr = gh.pulls[0]
    assert.equal(pr.head, 'canvai/design-v2')
    assert.include(pr.body, '#112233 → #445566')
    assert.include(pr.body, 'approved by Ola')

    // Ponowna synchronizacja tej samej wersji: gałąź i PR już są — bez błędu.
    ;(
      await client.post(`/api/boards/${board.id}/repo/sync`).headers({ cookie: cookies }).json({})
    ).assertStatus(202)
    await runPendingJobs()
    await row.refresh()
    assert.isNull(row.lastError)
    assert.lengthOf(gh.pulls, 1)

    // Ustawienia bez tokenu dla tego samego repo; odłączenie.
    ;(
      await client
        .put(`/api/boards/${board.id}/repo`)
        .headers({ cookie: cookies })
        .json({ repo: 'acme/web', autoOnApprove: false })
    ).assertStatus(200)
    ;(
      await client.delete(`/api/boards/${board.id}/repo`).headers({ cookie: cookies })
    ).assertStatus(200)
    assert.isNull(await BoardRepo.findBy('boardId', board.id))
  })

  test('błąd GitHuba trafia do lastError; obcy nie widzi repozytorium', async ({
    client,
    assert,
  }) => {
    const gh = fakeGitHub()
    githubDeps.fetch = gh.fetch as never
    const { board, cookies } = await setup(client)
    ;(
      await client
        .put(`/api/boards/${board.id}/repo`)
        .headers({ cookie: cookies })
        .json({ repo: 'acme/web', token: 'github_pat_good_token_123456', baseBranch: 'develop' })
    ).assertStatus(200)
    ;(
      await client
        .post(`/api/boards/${board.id}/repo/sync`)
        .headers({ cookie: cookies })
        .json({ version: 1 })
    ).assertStatus(202)
    await runPendingJobs()
    const row = await BoardRepo.findByOrFail('boardId', board.id)
    assert.include(row.lastError ?? '', 'develop')
    const shown = await client.get(`/api/boards/${board.id}/repo`).headers({ cookie: cookies })
    assert.include(shown.body().data.lastError, 'develop')

    const other = await setup(client)
    ;(
      await client.get(`/api/boards/${board.id}/repo`).headers({ cookie: other.cookies })
    ).assertStatus(404)
  })
})
