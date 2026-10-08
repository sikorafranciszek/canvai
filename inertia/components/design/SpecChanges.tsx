/**
 * Zmiany między wersjami DESIGN.md „po ludzku” (FEAT-1): tokeny było → jest
 * z próbkami kolorów, dodane/usunięte komponenty i ekrany oraz przyczyny
 * z danych tablicy. Ten sam widok w panelu zespołu i w portalu klienta.
 */
import type { ChangeGroupDto, ChangeReasonDto, SpecChangesDto } from '~/lib/board/api'
import { useT, type MessageKey } from '~/i18n'
import type { AssetUsage } from '@shared/asset-usage'

const isHex = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v)

function Swatch({ value }: { value: string }) {
  return isHex(value) ? (
    <span className="spec-changes__swatch" style={{ background: value }} aria-hidden="true" />
  ) : null
}

function Value({ value }: { value: string }) {
  return (
    <span className="spec-changes__value">
      <Swatch value={value} />
      <code>{value}</code>
    </span>
  )
}

function Group({ title, group }: { title: string; group: ChangeGroupDto }) {
  const { t } = useT()
  if (!group.added.length && !group.removed.length && !group.changed.length) return null
  return (
    <section className="spec-changes__group">
      <h4>{title}</h4>
      <ul>
        {group.changed.map((c) => (
          <li key={`c-${c.name}`}>
            <span className="spec-changes__name">{c.name}</span>
            <Value value={c.from} />
            <span aria-hidden="true">→</span>
            <span className="sr-only">{t('changes.to')}</span>
            <Value value={c.to} />
          </li>
        ))}
        {group.added.map((c) => (
          <li key={`a-${c.name}`}>
            <span className="spec-changes__badge spec-changes__badge--added">
              {t('changes.added')}
            </span>
            <span className="spec-changes__name">{c.name}</span>
            <Value value={c.value} />
          </li>
        ))}
        {group.removed.map((c) => (
          <li key={`r-${c.name}`}>
            <span className="spec-changes__badge spec-changes__badge--removed">
              {t('changes.removed')}
            </span>
            <span className="spec-changes__name">{c.name}</span>
            <Value value={c.value} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SpecChanges({
  changes,
  from,
  to,
  audience = 'team',
}: {
  changes: SpecChangesDto
  from: number
  to: number
  audience?: 'team' | 'client'
}) {
  const { t } = useT()
  const usageLabel = (u?: AssetUsage) => {
    if (!u || (!u.role && !u.aspects.length)) return t('usage.role.auto')
    const role = t(`usage.role.${u.role ?? 'auto'}` as MessageKey)
    return u.aspects.length
      ? `${role} · ${u.aspects.map((a) => t(`usage.aspect.${a}` as MessageKey)).join(', ')}`
      : role
  }
  const reason = (r: ChangeReasonDto): string | null => {
    switch (r.type) {
      case 'asset_added':
        return t('changes.reason.added', {
          ref: `A${r.assetId}`,
          name: r.filename,
          usage: usageLabel(r.usage),
        })
      case 'asset_removed':
        return t('changes.reason.removed', { ref: `A${r.assetId}`, name: r.filename })
      case 'usage_changed':
        return t('changes.reason.usage', {
          ref: `A${r.assetId}`,
          name: r.filename,
          from: usageLabel(r.from),
          to: usageLabel(r.to),
        })
      case 'edited':
        return t('changes.reason.edited')
      case 'pro_mode':
        return audience === 'team'
          ? t(r.on ? 'changes.reason.proOn' : 'changes.reason.proOff')
          : null
      case 'prompt_version':
        return audience === 'team' ? t('changes.reason.prompt', { from: r.from, to: r.to }) : null
    }
  }
  const reasons = changes.reasons.map(reason).filter((x): x is string => Boolean(x))
  const list = (title: string, added: string[], removed: string[]) =>
    added.length || removed.length ? (
      <section className="spec-changes__group">
        <h4>{title}</h4>
        <ul>
          {added.map((n) => (
            <li key={`a-${n}`}>
              <span className="spec-changes__badge spec-changes__badge--added">
                {t('changes.added')}
              </span>
              {n}
            </li>
          ))}
          {removed.map((n) => (
            <li key={`r-${n}`}>
              <span className="spec-changes__badge spec-changes__badge--removed">
                {t('changes.removed')}
              </span>
              {n}
            </li>
          ))}
        </ul>
      </section>
    ) : null

  return (
    <div className="spec-changes" data-testid="spec-changes">
      <p className="spec-changes__title">{t('changes.title', { from, to })}</p>
      {changes.empty ? <p className="t-small t-muted">{t('changes.none')}</p> : null}
      <Group title={t('changes.colors')} group={changes.colors} />
      <Group title={t('changes.fonts')} group={changes.fonts} />
      <Group title={t('changes.radii')} group={changes.radii} />
      <Group title={t('changes.spacing')} group={changes.spacing} />
      {list(t('changes.components'), changes.components.added, changes.components.removed)}
      {list(t('changes.screens'), changes.screens.added, changes.screens.removed)}
      {reasons.length ? (
        <section className="spec-changes__group">
          <h4>{t('changes.why')}</h4>
          <ul className="spec-changes__reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
