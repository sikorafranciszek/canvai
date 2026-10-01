/**
 * „Użyj w narzędziu AI”: gotowe pliki i instrukcje dla Cursora, Claude Code,
 * Codexa (AGENTS.md), v0/Lovable/Bolt (prompt) oraz podłączenie przez MCP.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Download, Lock } from 'lucide-react'
import { router } from '@inertiajs/react'
import { Dialog } from '~/components/ui/Dialog'
import { exportUrl, type ExportFormat } from '~/lib/billing'
import { designDocDownloadUrl } from '~/lib/board/api'
import { useT, type MessageKey } from '~/i18n'

type Tool = 'cursor' | 'claude' | 'codex' | 'builder' | 'mcp'

const TOOLS: { id: Tool; label: string; format?: ExportFormat; file?: string }[] = [
  { id: 'cursor', label: 'Cursor', format: 'cursor', file: '.cursor/rules/design-system.mdc' },
  { id: 'claude', label: 'Claude Code', format: 'claude', file: 'CLAUDE.md' },
  { id: 'codex', label: 'Codex / AGENTS.md', format: 'agents', file: 'AGENTS.md' },
  { id: 'builder', label: 'v0 · Lovable · Bolt', format: 'prompt' },
  { id: 'mcp', label: 'MCP' },
]

export function AiToolsDialog({
  open,
  onClose,
  boardId,
  version,
  allowed,
}: {
  open: boolean
  onClose: () => void
  boardId: number
  version: number
  allowed: boolean
}) {
  const { t } = useT()
  const [tool, setTool] = useState<Tool>('cursor')
  const current = TOOLS.find((x) => x.id === tool)!
  const endpoint = typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`

  const copy = async (format: ExportFormat) => {
    try {
      const res = await fetch(exportUrl(boardId, format, version), { credentials: 'same-origin' })
      if (!res.ok) throw new Error(String(res.status))
      await navigator.clipboard.writeText(await res.text())
      toast.success(t('aiTools.copied'))
    } catch {
      toast.error(t('doc.copyFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('aiTools.title')}
      description={t('aiTools.desc')}
      testId="ai-tools-dialog"
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div
        className="segmented segmented--text ai-tools__tabs"
        role="group"
        aria-label={t('aiTools.title')}
      >
        {TOOLS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={tool === x.id}
            onClick={() => setTool(x.id)}
            data-testid={`ai-tool-${x.id}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {!allowed && tool !== 'mcp' ? (
        <div className="alert alert--notice">
          <Lock />
          <span style={{ flex: 1 }}>{t('doc.export.locked')}</span>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => router.visit('/billing')}
          >
            {t('billing.upgrade')}
          </button>
        </div>
      ) : null}

      <ol className="ai-tools__steps">
        {[1, 2, 3].map((n) => {
          const key = `aiTools.${tool}.step${n}` as MessageKey
          const text = t(key, { file: current.file ?? '' })
          return text === key ? null : <li key={n}>{text}</li>
        })}
      </ol>

      {tool === 'mcp' ? (
        <>
          <pre className="code-snippet">{`claude mcp add --transport http canvai ${endpoint} --header "Authorization: Bearer cvai_…"`}</pre>
          <a className="btn btn--sm" href="/settings#api">
            {t('aiTools.mcp.settings')}
          </a>
        </>
      ) : (
        <div className="ai-tools__actions">
          <a
            className="btn btn--sm"
            href={designDocDownloadUrl(boardId, version)}
            download="DESIGN.md"
          >
            <Download />
            DESIGN.md
          </a>
          {current.format && current.file ? (
            <a
              className="btn btn--sm"
              aria-disabled={!allowed}
              href={allowed ? exportUrl(boardId, current.format, version) : undefined}
              data-testid={`ai-tool-download-${tool}`}
            >
              <Download />
              {current.file.split('/').pop()}
            </a>
          ) : null}
          {current.format ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              disabled={!allowed}
              onClick={() => void copy(current.format!)}
              data-testid={`ai-tool-copy-${tool}`}
            >
              <Copy />
              {tool === 'builder' ? t('aiTools.copyPrompt') : t('aiTools.copyFile')}
            </button>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
