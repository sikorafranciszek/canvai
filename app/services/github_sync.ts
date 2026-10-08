import { DateTime } from 'luxon'
import encryption from '@adonisjs/core/services/encryption'
import Board from '#models/board'
import BoardRepo from '#models/board_repo'
import DesignDoc from '#models/design_doc'
import { renderExport } from '#services/design/exports'
import { diffDocs, previousReady, type SpecChanges } from '#services/design/spec_diff'
import { AiProviderError } from '#services/ai/types'
import { t } from '#services/i18n'

/**
 * Synchronizacja z repozytorium GitHub (FEAT-5): gałąź `canvai/design-v<N>`,
 * commit z DESIGN.md, tokenami, regułą Cursora (i CLAUDE.md, jeśli repo go nie
 * ma — istniejącego nie nadpisujemy) oraz pull request z opisem zmian (FEAT-1).
 *
 * Uwierzytelnienie: fine-grained token z uprawnieniami Contents i Pull requests
 * (read & write) do jednego repozytorium — bez instalowania aplikacji GitHub.
 */

const API = 'https://api.github.com'

/** Podmieniane w testach (bez sieci). */
export const githubDeps = { fetch: (url: string, init?: RequestInit) => fetch(url, init) }

/** Błąd GitHuba do pokazania użytkownikowi (zły token, brak repo, brak uprawnień). */
export class GithubSyncError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'GithubSyncError'
  }
}

export const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  let res: Response
  try {
    res = await githubDeps.fetch(`${API}${path}`, {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'canvai',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    // Sieć / timeout — zadanie spróbuje ponownie.
    throw new AiProviderError(`GitHub: ${(error as Error).message}`, true)
  }
  const data = (await res.json().catch(() => ({}))) as T
  if (res.status >= 500) throw new AiProviderError(`GitHub ${res.status}`, true, res.status)
  return { status: res.status, data }
}

function failure(status: number, data: unknown, what: string): GithubSyncError {
  const detail = (data as { message?: string } | null)?.message ?? ''
  if (status === 401) return new GithubSyncError(t('github.error.token'), status)
  if (status === 403 || status === 404) {
    return new GithubSyncError(t('github.error.access', { what, status }), status)
  }
  return new GithubSyncError(`GitHub: ${what} failed (${status}) ${detail}`.trim(), status)
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

/** Sprawdza token i repozytorium przy zapisie połączenia. Zwraca domyślną gałąź. */
export async function verifyRepoAccess(repo: string, token: string): Promise<string> {
  const { status, data } = await gh<{ permissions?: { push?: boolean }; default_branch?: string }>(
    token,
    'GET',
    `/repos/${repo}`
  )
  if (status !== 200) throw failure(status, data, repo)
  if (data.permissions && data.permissions.push === false) {
    throw new GithubSyncError(t('github.error.readOnly', { repo }), 403)
  }
  return data.default_branch ?? 'main'
}

export function encryptToken(token: string): string {
  return encryption.encrypt(token)
}

function decryptToken(repo: BoardRepo): string {
  const token = encryption.decrypt<string>(repo.token)
  if (!token) throw new GithubSyncError('Stored GitHub token cannot be read — connect again.')
  return token
}

/** Opis zmian do PR (dla programistów, po angielsku). */
export function changesMarkdown(changes: SpecChanges | null, from: number | null): string {
  if (!changes || changes.empty) {
    return from ? `No token changes since v${from}.` : 'First version of the design system.'
  }
  const lines: string[] = [`### Changes since v${from}`]
  const groups: [string, SpecChanges['colors']][] = [
    ['Colors', changes.colors],
    ['Fonts', changes.fonts],
    ['Radii', changes.radii],
    ['Spacing', changes.spacing],
  ]
  for (const [title, g] of groups) {
    const items = [
      ...g.changed.map((c) => `- \`${c.name}\`: ${c.from} → ${c.to}`),
      ...g.added.map((c) => `- added \`${c.name}\`: ${c.value}`),
      ...g.removed.map((c) => `- removed \`${c.name}\` (${c.value})`),
    ]
    if (items.length) lines.push('', `**${title}**`, ...items)
  }
  for (const [title, g] of [
    ['Components', changes.components],
    ['Screens', changes.screens],
  ] as const) {
    const items = [...g.added.map((n) => `- added ${n}`), ...g.removed.map((n) => `- removed ${n}`)]
    if (items.length) lines.push('', `**${title}**`, ...items)
  }
  const reasons = changes.reasons
    .map((r) => {
      switch (r.type) {
        case 'asset_added':
          return `new material A${r.assetId} “${r.filename}”`
        case 'asset_removed':
          return `removed material A${r.assetId} “${r.filename}”`
        case 'usage_changed':
          return `changed role of A${r.assetId} “${r.filename}”`
        case 'edited':
          return 'tokens edited by hand'
        case 'command':
          return `revision: “${r.instruction}”${r.section ? ` (${r.section})` : ''}`
        default:
          return null
      }
    })
    .filter(Boolean)
  if (reasons.length) lines.push('', '**Why**', ...reasons.map((r) => `- ${r}`))
  return lines.join('\n')
}

export interface SyncResult {
  prUrl: string | null
  branch: string
  files: string[]
  upToDate: boolean
}

/** Tworzy/aktualizuje gałąź z plikami wersji i otwiera pull request. */
export async function syncBoardToGitHub(boardId: number, version: number): Promise<SyncResult> {
  const repoRow = await BoardRepo.findByOrFail('boardId', boardId)
  const board = await Board.findOrFail(boardId)
  const doc = await DesignDoc.query()
    .where('board_id', boardId)
    .where('version', version)
    .where('status', 'ready')
    .first()
  if (!doc?.contentMd || !doc.spec) throw new GithubSyncError(`Version ${version} is not ready.`)

  const token = decryptToken(repoRow)
  const repo = repoRow.repo
  const base = repoRow.baseBranch
  const dir = repoRow.directory ? `${repoRow.directory.replace(/^\/+|\/+$/g, '')}/` : ''
  const branch = `canvai/design-v${version}`

  const baseRef = await gh<{ object?: { sha: string } }>(
    token,
    'GET',
    `/repos/${repo}/git/ref/heads/${encodePath(base)}`
  )
  if (baseRef.status !== 200 || !baseRef.data.object) {
    throw failure(baseRef.status, baseRef.data, `branch ${base}`)
  }
  const created = await gh(token, 'POST', `/repos/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseRef.data.object.sha,
  })
  // 422 = gałąź już jest (ponowna synchronizacja tej samej wersji) — aktualizujemy ją.
  if (created.status !== 201 && created.status !== 422) {
    throw failure(created.status, created.data, `creating branch ${branch}`)
  }

  const files: { path: string; body: string; onlyIfMissing?: boolean }[] = [
    { path: `${dir}DESIGN.md`, body: doc.contentMd },
    { path: `${dir}design-tokens.json`, body: renderExport(doc.spec, 'tokens').body },
    { path: `${dir}tokens.css`, body: renderExport(doc.spec, 'css').body },
    { path: '.cursor/rules/design-system.mdc', body: renderExport(doc.spec, 'cursor').body },
    { path: 'CLAUDE.md', body: renderExport(doc.spec, 'claude').body, onlyIfMissing: true },
  ]
  const written: string[] = []
  for (const file of files) {
    const current = await gh<{ sha?: string; content?: string }>(
      token,
      'GET',
      `/repos/${repo}/contents/${encodePath(file.path)}?ref=${encodeURIComponent(branch)}`
    )
    if (current.status !== 200 && current.status !== 404) {
      throw failure(current.status, current.data, file.path)
    }
    if (current.status === 200 && file.onlyIfMissing) continue
    const existing =
      current.status === 200 && current.data.content
        ? Buffer.from(current.data.content, 'base64').toString('utf8')
        : null
    if (existing === file.body) continue
    const put = await gh(token, 'PUT', `/repos/${repo}/contents/${encodePath(file.path)}`, {
      message: `design: ${file.path.split('/').pop()} from canvai v${version}`,
      content: Buffer.from(file.body, 'utf8').toString('base64'),
      branch,
      ...(current.data.sha ? { sha: current.data.sha } : {}),
    })
    if (put.status !== 200 && put.status !== 201) throw failure(put.status, put.data, file.path)
    written.push(file.path)
  }

  const previous = await previousReady(boardId, version)
  const changes = previous ? diffDocs(previous, doc) : null
  const approved = board.approvedVersion === version
  const body = [
    `DESIGN.md **v${version}** of the canvai board “${board.title}”${approved ? ` — approved${board.approvedBy ? ` by ${board.approvedBy}` : ''}` : ''}.`,
    '',
    changesMarkdown(changes, previous?.version ?? null),
    '',
    `Files: ${files.map((f) => `\`${f.path}\``).join(', ')}${files.at(-1)!.onlyIfMissing ? ' (CLAUDE.md only when the repository has none)' : ''}.`,
  ].join('\n')

  const pr = await gh<{ html_url?: string }>(token, 'POST', `/repos/${repo}/pulls`, {
    title: `Design system v${version} from canvai`,
    head: branch,
    base,
    body,
  })
  let prUrl = pr.data.html_url ?? null
  if (pr.status === 422 && !prUrl) {
    // Pull request z tej gałęzi już jest albo nie ma różnic względem bazy.
    const owner = repo.split('/')[0]
    const open = await gh<{ html_url: string }[]>(
      token,
      'GET',
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`
    )
    prUrl = Array.isArray(open.data) && open.data[0] ? open.data[0].html_url : null
  } else if (pr.status !== 201) {
    throw failure(pr.status, pr.data, 'creating the pull request')
  }

  repoRow.lastVersion = version
  repoRow.lastPrUrl = prUrl
  repoRow.lastError = null
  repoRow.lastSyncedAt = DateTime.utc()
  await repoRow.save()
  return { prUrl, branch, files: written, upToDate: written.length === 0 && !prUrl }
}

/** Zapisuje błąd ostatniej synchronizacji (widoczny w UI). */
export async function recordSyncError(boardId: number, message: string) {
  await BoardRepo.query()
    .where('board_id', boardId)
    .update({ lastError: message.slice(0, 500), lastSyncedAt: DateTime.utc().toSQL() })
}
