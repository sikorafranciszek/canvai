import type { HttpContext } from '@adonisjs/core/http'
import { listBoards, readyDoc, tokensFor } from '#services/design/access'
import { EXPORT_FORMATS, type ExportFormat } from '#services/design/exports'
import { track } from '#services/analytics/collector'

/** Maksymalna liczba wywołań w jednym batchu JSON-RPC. */
const MAX_BATCH = 20

/**
 * Serwer MCP (Model Context Protocol) — transport „Streamable HTTP” bez stanu:
 * każdy POST to wiadomość JSON-RPC 2.0, odpowiedź to zwykły JSON (bez SSE).
 * Uwierzytelnianie: `Authorization: Bearer cvai_…` (middleware `apiToken`).
 *
 * Narzędzia: list_boards, get_design_md, get_design_tokens.
 * Zasoby: `canvai://boards/<id>/design-md` — DESIGN.md do wskazania w kliencie.
 */

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'canvai', title: 'canvai — DESIGN.md', version: '1.0.0' }

const INSTRUCTIONS = [
  'canvai turns client materials (screenshots, logos, links, notes) on a board into DESIGN.md —',
  'a design specification with color/typography tokens, components, screens and rules.',
  'Before building or restyling UI for a project, call list_boards, then get_design_md for the matching',
  'board and follow it strictly. Use get_design_tokens to drop CSS variables or a Tailwind v4 theme into code.',
].join(' ')

const TOOLS = [
  {
    name: 'list_boards',
    title: 'List boards',
    description:
      "List the user's canvai boards with the latest ready DESIGN.md version of each (null = not generated yet).",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_design_md',
    title: 'Get DESIGN.md',
    description:
      "Get the DESIGN.md (Style Reference) of a board: tokens, typography, components, screens, do/don't rules and a CSS/Tailwind Quick Start. Follow it when building UI.",
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'integer', description: 'Board id from list_boards' },
        version: { type: 'integer', description: 'Specific version (default: latest ready)' },
      },
      required: ['board_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_design_tokens',
    title: 'Get design tokens',
    description:
      'Get the design system of a board as a file: CSS custom properties (css), Tailwind v4 @theme (tailwind), Tailwind v3 config (tailwind3), SCSS variables (scss), W3C design tokens JSON (tokens), Tokens Studio JSON for Figma (figma), Cursor rules (cursor), CLAUDE.md (claude), AGENTS.md (agents) or a prompt for v0/Lovable/Bolt (prompt).',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'integer', description: 'Board id from list_boards' },
        format: { type: 'string', enum: [...EXPORT_FORMATS], default: 'css' },
        version: { type: 'integer', description: 'Specific version (default: latest ready)' },
      },
      required: ['board_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
]

type JsonRpcId = string | number | null
interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, any>
}

class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(message)
  }
}

const text = (value: string) => ({ content: [{ type: 'text', text: value }] })
const toolError = (value: string) => ({ ...text(value), isError: true })

function intArg(args: Record<string, unknown>, key: string, required = false): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) {
    if (required) throw new RpcError(-32602, `Missing argument: ${key}`)
    return undefined
  }
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new RpcError(-32602, `Invalid argument: ${key}`)
  return n
}

async function callTool(userId: number, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_boards':
      return text(JSON.stringify(await listBoards(userId), null, 2))

    case 'get_design_md': {
      const { board, doc } = await readyDoc(
        userId,
        intArg(args, 'board_id', true)!,
        intArg(args, 'version')
      )
      if (!board) return toolError('Board not found.')
      if (!doc?.contentMd)
        return toolError('This board has no ready DESIGN.md yet — generate it in canvai first.')
      return text(doc.contentMd)
    }

    case 'get_design_tokens': {
      const format = (args.format ?? 'css') as ExportFormat
      if (!(EXPORT_FORMATS as readonly string[]).includes(format))
        throw new RpcError(-32602, 'Invalid format')
      const { board, doc } = await readyDoc(
        userId,
        intArg(args, 'board_id', true)!,
        intArg(args, 'version')
      )
      if (!board) return toolError('Board not found.')
      const file = doc ? tokensFor(doc, format) : null
      if (!file) return toolError('No tokens for this board — generate DESIGN.md in canvai first.')
      return text(file.body)
    }

    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`)
  }
}

async function dispatch(userId: number, message: JsonRpcRequest): Promise<unknown> {
  const params = message.params ?? {}
  switch (message.method) {
    case 'initialize': {
      const requested = String(params.protocolVersion ?? '')
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call':
      if (typeof params.name !== 'string') throw new RpcError(-32602, 'Missing tool name')
      track('mcp_tool_call', { tool: params.name }, { userId })
      return callTool(userId, params.name, (params.arguments ?? {}) as Record<string, unknown>)
    case 'resources/list': {
      const boards = await listBoards(userId)
      return {
        resources: boards
          .filter((b) => b.designMd)
          .map((b) => ({
            uri: `canvai://boards/${b.id}/design-md`,
            name: `${b.title} — DESIGN.md`,
            description: `DESIGN.md v${b.designMd!.version} of the board “${b.title}”`,
            mimeType: 'text/markdown',
          })),
      }
    }
    case 'resources/templates/list':
      return {
        resourceTemplates: [
          {
            uriTemplate: 'canvai://boards/{board_id}/design-md',
            name: 'Board DESIGN.md',
            mimeType: 'text/markdown',
          },
        ],
      }
    case 'resources/read': {
      const match = String(params.uri ?? '').match(/^canvai:\/\/boards\/(\d+)\/design-md$/)
      if (!match) throw new RpcError(-32002, 'Resource not found')
      const { doc } = await readyDoc(userId, Number(match[1]))
      if (!doc?.contentMd) throw new RpcError(-32002, 'Resource not found')
      return {
        contents: [{ uri: params.uri, mimeType: 'text/markdown', text: doc.contentMd }],
      }
    }
    default:
      throw new RpcError(-32601, `Method not found: ${message.method}`)
  }
}

export default class McpController {
  /** POST /mcp — wiadomość (lub paczka wiadomości) JSON-RPC. */
  async handle({ apiUser, request, response }: HttpContext) {
    let body: unknown
    try {
      body = JSON.parse(request.raw() ?? '')
    } catch {
      return response.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })
    }

    const handleOne = async (message: JsonRpcRequest) => {
      // Powiadomienie (bez id) — nie ma odpowiedzi.
      const isNotification = message?.id === undefined
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return isNotification
          ? null
          : {
              jsonrpc: '2.0',
              id: message?.id ?? null,
              error: { code: -32600, message: 'Invalid request' },
            }
      }
      if (isNotification) return null
      try {
        return { jsonrpc: '2.0', id: message.id, result: await dispatch(apiUser!.id, message) }
      } catch (error) {
        const rpc = error instanceof RpcError ? error : new RpcError(-32603, 'Internal error')
        return { jsonrpc: '2.0', id: message.id, error: { code: rpc.code, message: rpc.message } }
      }
    }

    if (Array.isArray(body)) {
      // Batch: najwyżej MAX_BATCH wywołań, wykonywanych po kolei (SEC-12) —
      // jedno żądanie nie zrównolegli setek zapytań do bazy.
      if (body.length > MAX_BATCH) {
        return response.status(400).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: `Batch too large (max ${MAX_BATCH} calls)` },
        })
      }
      const results: unknown[] = []
      for (const message of body) {
        const result = await handleOne(message as JsonRpcRequest)
        if (result) results.push(result)
      }
      return results.length ? response.json(results) : response.status(202).send('')
    }
    const result = await handleOne(body as JsonRpcRequest)
    return result ? response.json(result) : response.status(202).send('')
  }

  /** GET/DELETE /mcp — bez strumienia SSE i bez sesji. */
  async notAllowed({ response }: HttpContext) {
    response.header('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed — use POST with JSON-RPC' })
  }
}
