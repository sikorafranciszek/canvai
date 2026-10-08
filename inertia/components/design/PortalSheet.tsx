/**
 * Widok wizualny DESIGN.md dla klienta w portalu (FEAT-4): próbki kolorów,
 * krojów i skali, komponenty, ekrany i ton — do akceptacji bez czytania
 * markdownu dla maszyn. † = założenie do potwierdzenia.
 */
import { useT } from '~/i18n'

export interface PortalSheetDto {
  theme: 'light' | 'dark' | 'mixed'
  tagline: string
  colors: { name: string; hex: string; role: string; assumed: boolean }[]
  families: { name: string; substitute: string; role: string; assumed: boolean }[]
  scale: { role: string; family: string; size: string; weight: string }[]
  radii: { name: string; value: string }[]
  components: { name: string; description: string; assumed: boolean }[]
  screens: { name: string; purpose: string }[]
  voice: { tone: string; examples: string[] }
  dos: string[]
  donts: string[]
}

const dagger = (assumed: boolean) => (assumed ? ' †' : '')

/** Rodzina do próbki: nazwa z dokumentu, potem zamiennik i krój ogólny. */
function fontStack(name: string, substitute: string) {
  const quote = (f: string) => (/^[\w-]+$/.test(f) ? f : `"${f.replace(/["\\]/g, '')}"`)
  return [name, ...substitute.split(',')]
    .map((f) => f.trim())
    .filter(Boolean)
    .map(quote)
    .concat('system-ui', 'sans-serif')
    .join(', ')
}

export function PortalSheet({
  sheet,
  previewUrl,
}: {
  sheet: PortalSheetDto
  previewUrl?: string | null
}) {
  const { t } = useT()
  const anyAssumed =
    sheet.colors.some((c) => c.assumed) ||
    sheet.families.some((f) => f.assumed) ||
    sheet.components.some((c) => c.assumed)
  const familyOf = (name: string) => sheet.families.find((f) => f.name === name)

  return (
    <div className="portal-sheet" data-testid="portal-sheet">
      {sheet.tagline ? <p className="portal-sheet__tagline">{sheet.tagline}</p> : null}

      {sheet.colors.length ? (
        <section className="portal-sheet__section">
          <h3>{t('revise.section.colors')}</h3>
          <ul className="portal-sheet__swatches">
            {sheet.colors.map((c) => (
              <li key={`${c.name}-${c.hex}`}>
                <span className="portal-sheet__swatch" style={{ background: c.hex }} />
                <strong>
                  {c.name}
                  {dagger(c.assumed)}
                </strong>
                <code>{c.hex}</code>
                {c.role ? <span className="t-small t-muted">{c.role}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sheet.families.length ? (
        <section className="portal-sheet__section">
          <h3>{t('revise.section.typography')}</h3>
          <ul className="portal-sheet__fonts">
            {sheet.families.map((f) => (
              <li key={f.name}>
                <span
                  className="portal-sheet__font-sample"
                  style={{ fontFamily: fontStack(f.name, f.substitute) }}
                >
                  Aa Bb Cc 123
                </span>
                <strong>
                  {f.name}
                  {dagger(f.assumed)}
                </strong>
                {f.role ? <span className="t-small t-muted">{f.role}</span> : null}
              </li>
            ))}
          </ul>
          {sheet.scale.length ? (
            <ul className="portal-sheet__scale">
              {sheet.scale.map((r) => {
                const family = familyOf(r.family)
                return (
                  <li key={`${r.role}-${r.size}`}>
                    <span className="t-small t-muted">
                      {r.role} · {r.size}
                      {r.weight ? ` · ${r.weight}` : ''}
                    </span>
                    <span
                      style={{
                        fontSize: /^\d+(\.\d+)?(px|rem|em)$/.test(r.size) ? r.size : undefined,
                        fontWeight: /^\d{3}$/.test(r.weight) ? Number(r.weight) : undefined,
                        fontFamily: family ? fontStack(family.name, family.substitute) : undefined,
                        lineHeight: 1.2,
                      }}
                    >
                      {t('portal.sheet.sample')}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {previewUrl ? (
        <section className="portal-sheet__section">
          <h3>{t('portal.sheet.preview')}</h3>
          <iframe
            className="portal-sheet__preview"
            src={previewUrl}
            title={t('portal.sheet.preview')}
            sandbox=""
            loading="lazy"
            data-testid="portal-preview"
          />
        </section>
      ) : null}

      {sheet.components.length ? (
        <section className="portal-sheet__section">
          <h3>{t('revise.section.components')}</h3>
          <ul className="portal-sheet__list">
            {sheet.components.map((c) => (
              <li key={c.name}>
                <strong>
                  {c.name}
                  {dagger(c.assumed)}
                </strong>
                {c.description ? <span className="t-muted"> — {c.description}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sheet.screens.length ? (
        <section className="portal-sheet__section">
          <h3>{t('revise.section.screens')}</h3>
          <ul className="portal-sheet__list">
            {sheet.screens.map((s) => (
              <li key={s.name}>
                <strong>{s.name}</strong>
                {s.purpose ? <span className="t-muted"> — {s.purpose}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sheet.voice.tone || sheet.voice.examples.length ? (
        <section className="portal-sheet__section">
          <h3>{t('revise.section.voice')}</h3>
          {sheet.voice.tone ? <p>{sheet.voice.tone}</p> : null}
          {sheet.voice.examples.length ? (
            <ul className="portal-sheet__list">
              {sheet.voice.examples.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {sheet.dos.length || sheet.donts.length ? (
        <section className="portal-sheet__section portal-sheet__rules">
          <div>
            <h3>{t('portal.sheet.dos')}</h3>
            <ul className="portal-sheet__list">
              {sheet.dos.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>{t('portal.sheet.donts')}</h3>
            <ul className="portal-sheet__list">
              {sheet.donts.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {anyAssumed ? <p className="t-small t-muted">{t('portal.sheet.assumed')}</p> : null}
    </div>
  )
}
