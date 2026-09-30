/**
 * Render DESIGN.md do elementów React (bez innerHTML). Odwołania [A<id>]
 * są klikalnymi chipami — wyśrodkowują asset na płótnie. Nagłówki H2 dostają
 * stabilne `id` (`doc-section-<n>`), żeby spis sekcji mógł do nich przewijać.
 */
import { Fragment, memo, useMemo } from 'react'
import { parseMarkdown, type Block, type Inline } from '@shared/markdown'
import { translate } from '~/i18n'

interface Props {
  source: string
  onAssetRef?: (assetId: number) => void
  assetLabel?: (assetId: number) => string | null
}

type Ctx = Omit<Props, 'source'>

function InlineNodes({ nodes, ctx }: { nodes: Inline[]; ctx: Ctx }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>
          case 'strong':
            return (
              <strong key={i}>
                <InlineNodes nodes={node.children} ctx={ctx} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <InlineNodes nodes={node.children} ctx={ctx} />
              </em>
            )
          case 'code': {
            const isHex = /^#[0-9a-f]{6}$/i.test(node.text)
            return (
              <code key={i}>
                {isHex ? (
                  <span className="md-swatch" style={{ background: node.text }} aria-hidden />
                ) : null}
                {node.text}
              </code>
            )
          }
          case 'link':
            return (
              <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
                <InlineNodes nodes={node.children} ctx={ctx} />
              </a>
            )
          case 'assetRef': {
            const label = ctx.assetLabel?.(node.assetId)
            return (
              <button
                key={i}
                type="button"
                className="ref-chip"
                data-testid={`design-ref-${node.assetId}`}
                onClick={() => ctx.onAssetRef?.(node.assetId)}
                title={
                  label
                    ? translate('doc.refTitle', { name: label })
                    : translate('assets.showOnCanvas')
                }
              >
                A{node.assetId}
              </button>
            )
          }
          default:
            return null
        }
      })}
    </>
  )
}

function BlockNode({
  block,
  ctx,
  sectionIndex,
}: {
  block: Block
  ctx: Ctx
  sectionIndex: number | null
}) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1'
      return (
        <Tag id={sectionIndex !== null ? `doc-section-${sectionIndex}` : undefined}>
          <InlineNodes nodes={block.children} ctx={ctx} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <InlineNodes nodes={block.children} ctx={ctx} />
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineNodes nodes={item} ctx={ctx} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote>
          {block.children.map((line, i) => (
            <div key={i}>
              <InlineNodes nodes={line} ctx={ctx} />
            </div>
          ))}
        </blockquote>
      )
    case 'table':
      return (
        <div className="md__table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>
                    <InlineNodes nodes={cell} ctx={ctx} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <InlineNodes nodes={cell} ctx={ctx} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'code':
      return <pre>{block.text}</pre>
    case 'rule':
      return <hr />
    default:
      return null
  }
}

/** Tytuły sekcji H2 dokumentu — do spisu treści. */
export function sectionTitles(source: string): string[] {
  return parseMarkdown(source)
    .filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading' && b.level === 2)
    .map((b) =>
      b.children.map((c) => (c.type === 'text' ? c.text : c.type === 'code' ? c.text : '')).join('')
    )
}

export const MarkdownView = memo(function MarkdownView({ source, onAssetRef, assetLabel }: Props) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  const ctx = { onAssetRef, assetLabel }
  let section = 0
  return (
    <div className="md">
      {blocks.map((block, i) => (
        <BlockNode
          key={i}
          block={block}
          ctx={ctx}
          sectionIndex={block.type === 'heading' && block.level === 2 ? section++ : null}
        />
      ))}
    </div>
  )
})
