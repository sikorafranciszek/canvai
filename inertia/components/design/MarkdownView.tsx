/**
 * Render DESIGN.md do elementów React (bez innerHTML). Odwołania [A<id>]
 * są klikalnymi chipami — wyśrodkowują asset na płótnie.
 */
import { Fragment, memo, useMemo } from 'react'
import type React from 'react'
import { parseMarkdown, type Block, type Inline } from '@shared/markdown'

interface Props {
  source: string
  onAssetRef?: (assetId: number) => void
  assetLabel?: (assetId: number) => string | null
}

const styles = {
  root: { fontSize: 13, lineHeight: 1.6, color: '#0f172a', wordBreak: 'break-word' },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    background: '#f1f5f9',
    borderRadius: 4,
    padding: '1px 4px',
  },
  pre: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    background: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 6,
    padding: 10,
    overflowX: 'auto',
  },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12, margin: '8px 0' },
  cell: {
    border: '1px solid #e2e8f0',
    padding: '4px 6px',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  quote: {
    borderLeft: '3px solid #cbd5e1',
    margin: '8px 0',
    padding: '2px 10px',
    color: '#475569',
    background: '#f8fafc',
  },
} satisfies Record<string, React.CSSProperties>

const HEADING_SIZES = [22, 17, 15, 14, 13, 13]

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 2,
        background: hex,
        border: '1px solid rgba(0,0,0,.15)',
        marginRight: 4,
        verticalAlign: 'baseline',
      }}
    />
  )
}

function InlineNodes({ nodes, ctx }: { nodes: Inline[]; ctx: Omit<Props, 'source'> }) {
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
              <code key={i} style={styles.code}>
                {isHex ? <Swatch hex={node.text} /> : null}
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
                data-testid={`design-ref-${node.assetId}`}
                onClick={() => ctx.onAssetRef?.(node.assetId)}
                title={label ? `${label} — pokaż na płótnie` : 'Pokaż na płótnie'}
                style={{
                  font: 'inherit',
                  fontSize: 11,
                  lineHeight: 1.3,
                  padding: '0 5px',
                  margin: '0 1px',
                  borderRadius: 999,
                  border: '1px solid #c7d2fe',
                  background: '#eef2ff',
                  color: '#3730a3',
                  cursor: 'pointer',
                  verticalAlign: 'baseline',
                }}
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

function BlockNode({ block, ctx }: { block: Block; ctx: Omit<Props, 'source'> }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1'
      return (
        <Tag
          style={{
            fontSize: HEADING_SIZES[block.level - 1],
            margin: block.level <= 2 ? '20px 0 8px' : '14px 0 6px',
            paddingBottom: block.level === 2 ? 4 : 0,
            borderBottom: block.level === 2 ? '1px solid #e2e8f0' : undefined,
          }}
        >
          <InlineNodes nodes={block.children} ctx={ctx} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p style={{ margin: '6px 0' }}>
          <InlineNodes nodes={block.children} ctx={ctx} />
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag style={{ margin: '6px 0', paddingLeft: 20 }}>
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
        <blockquote style={styles.quote}>
          {block.children.map((line, i) => (
            <div key={i}>
              <InlineNodes nodes={line} ctx={ctx} />
            </div>
          ))}
        </blockquote>
      )
    case 'table':
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} style={{ ...styles.cell, background: '#f8fafc' }}>
                    <InlineNodes nodes={cell} ctx={ctx} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={styles.cell}>
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
      return <pre style={styles.pre}>{block.text}</pre>
    case 'rule':
      return <hr style={{ border: 0, borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />
    default:
      return null
  }
}

export const MarkdownView = memo(function MarkdownView({ source, onAssetRef, assetLabel }: Props) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  const ctx = { onAssetRef, assetLabel }
  return (
    <div style={styles.root}>
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} ctx={ctx} />
      ))}
    </div>
  )
})
