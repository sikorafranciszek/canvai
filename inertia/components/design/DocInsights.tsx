/**
 * Zakładki „Jakość” i „Tokeny” panelu DESIGN.md:
 * - ocena dokumentu (ugruntowanie w materiałach, luki, kontrast WCAG)
 *   z podpowiedziami, jakie materiały dodać;
 * - edytor tokenów: poprawa kolorów, fontów i promieni oraz potwierdzanie
 *   założeń † — zapis tworzy nową wersję bez AI i bez kredytów.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Info, RotateCcw, Save } from 'lucide-react'
import { contrastRatio, wcagLevel } from '@shared/color'
import type { DesignDocDto, DocEdits, QualityReport } from '~/lib/board/api'
import { useDesignStore } from '~/lib/board/design'
import { useT, type MessageKey } from '~/i18n'

const GRADE: Record<QualityReport['grade'], MessageKey> = {
  excellent: 'quality.grade.excellent',
  good: 'quality.grade.good',
  fair: 'quality.grade.fair',
  weak: 'quality.grade.weak',
}

const SEVERITY_TONE = { high: 'critical', medium: 'warning', low: 'neutral' } as const

export function QualityView({ doc, onEdit }: { doc: DesignDocDto; onEdit: () => void }) {
  const { t } = useT()
  const q = doc.quality
  if (!q) return <div className="panel-empty">{t('quality.unavailable')}</div>
  const failing = q.contrast.filter((c) => c.ratio < 4.5)
  const tone = q.score >= 70 ? 'good' : q.score >= 50 ? 'warning' : 'critical'

  return (
    <div className="quality" data-testid="design-doc-quality">
      <div className="quality__score">
        <div className={`quality__ring quality__ring--${tone}`} aria-hidden="true">
          <span>{q.score}</span>
        </div>
        <div>
          <div className="quality__grade">{t(GRADE[q.grade])}</div>
          <p className="t-small t-muted">
            {t('quality.grounded', { grounded: q.grounded, total: q.total })}
          </p>
        </div>
      </div>

      {q.gaps.length ? (
        <section className="quality__section">
          <h3 className="quality__title">{t('quality.gapsTitle')}</h3>
          <ul className="quality__gaps">
            {q.gaps.map((gap) => (
              <li key={gap.id} className="quality__gap">
                <span className={`level level--${SEVERITY_TONE[gap.severity]}`}>
                  {t(`quality.severity.${gap.severity}` as MessageKey)}
                </span>
                <div>
                  <div className="quality__gap-title">
                    {t(`quality.gap.${gap.id}` as MessageKey, gap.params)}
                  </div>
                  <div className="t-small t-muted">
                    {t(`quality.fix.${gap.id}` as MessageKey, gap.params)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="quality__ok">
          <CheckCircle2 size={16} />
          {t('quality.noGaps')}
        </p>
      )}

      {q.contrast.length ? (
        <section className="quality__section">
          <h3 className="quality__title">{t('quality.contrastTitle')}</h3>
          <p className="t-small t-muted">{t('quality.contrastHint')}</p>
          <table className="quality__table" data-testid="design-doc-contrast">
            <thead>
              <tr>
                <th>{t('quality.contrast.pair')}</th>
                <th>{t('quality.contrast.ratio')}</th>
                <th>WCAG</th>
              </tr>
            </thead>
            <tbody>
              {q.contrast.map((c) => (
                <tr key={`${c.text.token}-${c.background.hex}`}>
                  <td>
                    <span
                      className="quality__sample"
                      style={{ color: c.text.hex, background: c.background.hex }}
                    >
                      Aa
                    </span>
                    <span className="t-small">
                      {c.text.name} / {c.background.name}
                    </span>
                  </td>
                  <td className="t-mono">{c.ratio.toFixed(2)}:1</td>
                  <td>
                    {c.ratio >= 4.5 ? (
                      <span className="level level--good">{c.level}</span>
                    ) : (
                      <span className="level level--critical">
                        {c.level === 'AA-large'
                          ? t('quality.contrast.large')
                          : t('quality.contrast.fail')}
                      </span>
                    )}
                    {c.suggestion && c.ratio < 4.5 ? (
                      <div className="t-small t-muted">
                        {t('quality.contrast.suggest')}{' '}
                        <code>
                          <span className="swatch" style={{ background: c.suggestion }} />
                          {c.suggestion}
                        </code>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {q.assumed.length || failing.length ? (
        <button type="button" className="btn btn--sm" onClick={onEdit}>
          {t('quality.openEditor', { n: q.assumed.length })}
        </button>
      ) : null}
    </div>
  )
}

interface Draft {
  colors: Record<string, { hex: string; confirm: boolean }>
  families: Record<string, { name: string; confirm: boolean }>
  radii: Record<string, string>
}

function initialDraft(doc: DesignDocDto): Draft {
  const tokens = doc.tokens!
  return {
    colors: Object.fromEntries(tokens.colors.map((c) => [c.token, { hex: c.hex, confirm: false }])),
    families: Object.fromEntries(
      tokens.families.map((f) => [f.token, { name: f.name, confirm: false }])
    ),
    radii: Object.fromEntries(tokens.radii.map((r) => [r.name, r.value])),
  }
}

const HEX_RE = /^#?[0-9a-f]{6}$/i

export function TokenEditor({ doc }: { doc: DesignDocDto }) {
  const { t } = useT()
  const applyEdits = useDesignStore((s) => s.applyEdits)
  const [draft, setDraft] = useState<Draft>(() => initialDraft(doc))
  const [saving, setSaving] = useState(false)
  const tokens = doc.tokens

  // Tło do podglądu kontrastu: pierwszy kolor tła/powierzchni (jak w ocenie jakości).
  const background = useMemo(() => {
    const bg = tokens?.colors.find((c) =>
      /background|surface|canvas|page|paper|base/i.test(`${c.name} ${c.token}`)
    )
    return bg ? (draft.colors[bg.token]?.hex ?? bg.hex) : null
  }, [tokens, draft])

  if (!tokens) return <div className="panel-empty">{t('quality.unavailable')}</div>

  const edits: DocEdits = {
    colors: tokens.colors.flatMap((c) => {
      const d = draft.colors[c.token]
      const hex = d.hex.startsWith('#') ? d.hex.toLowerCase() : `#${d.hex.toLowerCase()}`
      const changed = HEX_RE.test(d.hex) && hex !== c.hex
      return changed || d.confirm
        ? [{ token: c.token, ...(changed ? { hex } : {}), confirm: true }]
        : []
    }),
    families: tokens.families.flatMap((f) => {
      const d = draft.families[f.token]
      const changed = d.name.trim() && d.name.trim() !== f.name
      return changed || d.confirm
        ? [{ token: f.token, ...(changed ? { name: d.name.trim() } : {}), confirm: true }]
        : []
    }),
    radii: tokens.radii.flatMap((r) =>
      draft.radii[r.name].trim() && draft.radii[r.name].trim() !== r.value
        ? [{ name: r.name, value: draft.radii[r.name].trim() }]
        : []
    ),
  }
  const count =
    (edits.colors?.length ?? 0) + (edits.families?.length ?? 0) + (edits.radii?.length ?? 0)
  const invalid = tokens.colors.some((c) => !HEX_RE.test(draft.colors[c.token].hex))

  const save = async () => {
    setSaving(true)
    const ok = await applyEdits(edits)
    setSaving(false)
    if (!ok) return
  }

  return (
    <div className="token-editor" data-testid="design-doc-token-editor">
      <p className="t-small t-muted">{t('tokens.intro')}</p>

      <h3 className="quality__title">{t('tokens.colors')}</h3>
      <ul className="token-editor__list">
        {tokens.colors.map((c) => {
          const d = draft.colors[c.token]
          const hex = HEX_RE.test(d.hex) ? (d.hex.startsWith('#') ? d.hex : `#${d.hex}`) : c.hex
          const ratio =
            background &&
            /text|ink|foreground|muted|body|heading|label/i.test(`${c.name} ${c.token}`)
              ? contrastRatio(hex, background)
              : null
          return (
            <li key={c.token} className="token-editor__row">
              <input
                type="color"
                className="token-editor__picker"
                value={hex}
                aria-label={c.name}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    colors: { ...prev.colors, [c.token]: { ...d, hex: e.target.value } },
                  }))
                }
              />
              <div className="token-editor__main">
                <div className="token-editor__name">
                  {c.name}
                  {c.assumed && !c.confirmed ? (
                    <span className="badge badge--outline" data-tip={t('tokens.assumedTip')}>
                      † {t('tokens.assumed')}
                    </span>
                  ) : c.confirmed ? (
                    <span className="badge badge--outline">
                      <Check size={11} /> {t('tokens.confirmed')}
                    </span>
                  ) : null}
                </div>
                <div className="t-small t-muted token-editor__role">{c.role}</div>
              </div>
              <input
                className="input input--sm token-editor__hex"
                value={d.hex}
                aria-invalid={!HEX_RE.test(d.hex)}
                aria-label={t('tokens.hexLabel', { name: c.name })}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    colors: { ...prev.colors, [c.token]: { ...d, hex: e.target.value.trim() } },
                  }))
                }
              />
              {ratio != null ? (
                <span
                  className={`level level--${ratio >= 4.5 ? 'good' : 'critical'} token-editor__ratio`}
                  data-tip={t('tokens.ratioTip')}
                >
                  {ratio.toFixed(1)}:1 {wcagLevel(ratio) === 'fail' ? '' : wcagLevel(ratio)}
                </span>
              ) : null}
              {c.assumed && !c.confirmed ? (
                <label className="token-editor__confirm">
                  <input
                    type="checkbox"
                    checked={d.confirm}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, [c.token]: { ...d, confirm: e.target.checked } },
                      }))
                    }
                  />
                  {t('tokens.confirm')}
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>

      <h3 className="quality__title">{t('tokens.fonts')}</h3>
      <ul className="token-editor__list">
        {tokens.families.map((f) => {
          const d = draft.families[f.token]
          return (
            <li key={f.token} className="token-editor__row">
              <div className="token-editor__main">
                <input
                  className="input input--sm"
                  value={d.name}
                  aria-label={t('tokens.fontLabel')}
                  style={{ fontFamily: `'${d.name}', system-ui` }}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      families: { ...prev.families, [f.token]: { ...d, name: e.target.value } },
                    }))
                  }
                />
                <div className="t-small t-muted token-editor__role">{f.role}</div>
              </div>
              {f.assumed && !f.confirmed ? (
                <label className="token-editor__confirm">
                  <input
                    type="checkbox"
                    checked={d.confirm}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        families: {
                          ...prev.families,
                          [f.token]: { ...d, confirm: e.target.checked },
                        },
                      }))
                    }
                  />
                  {t('tokens.confirm')}
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>

      {tokens.radii.length ? (
        <>
          <h3 className="quality__title">{t('tokens.radii')}</h3>
          <ul className="token-editor__list">
            {tokens.radii.map((r) => (
              <li key={r.name} className="token-editor__row">
                <div className="token-editor__main">{r.name}</div>
                <input
                  className="input input--sm token-editor__hex"
                  value={draft.radii[r.name]}
                  aria-label={t('tokens.radiusLabel', { name: r.name })}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      radii: { ...prev.radii, [r.name]: e.target.value },
                    }))
                  }
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="token-editor__actions">
        <span className="t-small t-muted">
          <Info size={13} /> {t('tokens.free')}
        </span>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          disabled={!count || saving}
          onClick={() => setDraft(initialDraft(doc))}
        >
          <RotateCcw />
          {t('tokens.reset')}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!count || invalid || saving}
          onClick={() => void save()}
          data-testid="design-doc-token-save"
        >
          {invalid ? <AlertTriangle /> : <Save />}
          {saving ? t('common.loading') : t('tokens.save', { n: count })}
        </button>
      </div>
    </div>
  )
}
