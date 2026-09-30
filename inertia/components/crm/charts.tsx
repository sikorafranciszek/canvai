/**
 * Wykresy CRM (SVG, bez bibliotek). Zasady: jedna oś Y, cienkie znaczniki
 * (linia 2px, słupki ≤ 24px z zaokrąglonym końcem 4px), pomocnicza siatka
 * 1px, podpowiedź z celownikiem przy najechaniu, legenda dla ≥ 2 serii.
 * Kolory serii zweryfikowane skryptem palety (kontrast, CVD, nasycenie).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export const CHART = {
  series: ['#0097a0', '#d0691f'],
  grid: '#ebe8e2',
  axis: '#92918b',
  surface: '#fdfbfa',
} as const

export interface Point {
  day: string
  value: number
}

export interface Series {
  name: string
  points: Point[]
}

const nf = new Intl.NumberFormat('pl-PL')

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(n)
}

/** Górna granica osi: „ładna” liczba, której połowa też jest całkowita (≥ 2). */
function niceMax(max: number): number {
  if (max <= 0) return 1
  if (max <= 2) return 2
  const exp = 10 ** Math.floor(Math.log10(max))
  const f = max / exp
  const nice = [1, 2, 4, 6, 8, 10].find((c) => f <= c) ?? 10
  return nice * exp
}

/** Szerokość kontenera w px — wykres rysowany 1:1, tekst ma stały rozmiar. */
function useWidth(ref: React.RefObject<HTMLElement | null>, fallback = 640) {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const PAD = { top: 12, right: 16, bottom: 24, left: 52 }

/** Linia/obszar w czasie (1–2 serie) z celownikiem i podpowiedzią. */
export function TimeChart({
  series,
  height = 200,
  format = (v: number) => formatNumber(v),
  kind = 'line',
  label,
}: {
  series: Series[]
  height?: number
  format?: (value: number) => string
  kind?: 'line' | 'column'
  label: string
}) {
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const W = useWidth(wrap)
  const [hover, setHover] = useState<number | null>(null)
  const points = series[0]?.points ?? []
  const n = points.length
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value))))
  const innerW = W - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const band = n > 0 ? innerW / n : innerW
  const xc = (i: number) => PAD.left + band * i + band / 2
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const allZeroData = series.every((s) => s.points.every((p) => p.value === 0))
  const ticks = allZeroData ? [0] : [0, max / 2, max]
  const labelIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : points.map((_, i) => i)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i =
      kind === 'column'
        ? Math.floor((px - PAD.left) / band)
        : Math.round(((px - PAD.left) / innerW) * (n - 1))
    setHover(i >= 0 && i < n ? i : null)
  }

  const allZero = allZeroData

  return (
    <div className="chart" ref={wrap}>
      {series.length > 1 ? (
        <div className="chart__legend">
          {series.map((s, si) => (
            <span key={s.name}>
              <i style={{ background: CHART.series[si] }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="chart__svg"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={CHART.grid}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart__tick">
              {format(t)}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={kind === 'column' ? xc(i) : x(i)}
            y={height - 6}
            textAnchor="middle"
            className="chart__tick"
          >
            {points[i] ? shortDay(points[i].day) : ''}
          </text>
        ))}

        {kind === 'column'
          ? series.slice(0, 1).map((s) =>
              s.points.map((p, i) => {
                const bw = Math.min(24, Math.max(2, band - 2))
                const h = Math.max(0, PAD.top + innerH - y(p.value))
                const r = Math.min(4, bw / 2, h)
                const x0 = xc(i) - bw / 2
                const y0 = y(p.value)
                return h > 0 ? (
                  <path
                    key={p.day}
                    d={`M${x0},${y0 + h} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y0 + h} Z`}
                    fill={CHART.series[0]}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                ) : null
              })
            )
          : series.map((s, si) => {
              const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')
              return (
                <g key={s.name}>
                  {si === 0 ? (
                    <path
                      d={`${d} L${x(n - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`}
                      fill={CHART.series[0]}
                      opacity={0.1}
                    />
                  ) : null}
                  <path
                    d={d}
                    fill="none"
                    stroke={CHART.series[si]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {n > 0 ? (
                    <circle
                      cx={x(n - 1)}
                      cy={y(s.points[n - 1].value)}
                      r={4}
                      fill={CHART.series[si]}
                      stroke={CHART.surface}
                      strokeWidth={2}
                    />
                  ) : null}
                </g>
              )
            })}

        {hover != null && points[hover] ? (
          <g pointerEvents="none">
            <line
              x1={kind === 'column' ? xc(hover) : x(hover)}
              x2={kind === 'column' ? xc(hover) : x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke={CHART.axis}
              strokeWidth={1}
            />
            {kind === 'line'
              ? series.map((s, si) => (
                  <circle
                    key={s.name}
                    cx={x(hover)}
                    cy={y(s.points[hover]?.value ?? 0)}
                    r={4}
                    fill={CHART.series[si]}
                    stroke={CHART.surface}
                    strokeWidth={2}
                  />
                ))
              : null}
          </g>
        ) : null}
        <defs>
          <title id={`${id}-t`}>{label}</title>
        </defs>
      </svg>
      {hover != null && points[hover] ? (
        <div
          className="chart__tooltip"
          style={{
            left: `${(((kind === 'column' ? xc(hover) : x(hover)) / W) * 100).toFixed(2)}%`,
          }}
        >
          <strong>{shortDay(points[hover].day)}</strong>
          {series.map((s, si) => (
            <span key={s.name}>
              <i style={{ background: CHART.series[si] }} />
              {series.length > 1 ? `${s.name}: ` : ''}
              {format(s.points[hover]?.value ?? 0)}
            </span>
          ))}
        </div>
      ) : null}
      {allZero ? <div className="chart__empty">Brak danych w tym okresie</div> : null}
    </div>
  )
}

/** Poziome słupki (ranking, lejek) — etykieta, słupek, wartość. */
export function BarList({
  rows,
  format = (v: number) => formatNumber(v),
  secondary,
  empty = 'Brak danych',
}: {
  rows: { label: ReactNode; value: number; hint?: string }[]
  format?: (value: number) => string
  secondary?: (index: number) => ReactNode
  empty?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="t-small t-muted">{empty}</p>
  return (
    <ul className="barlist">
      {rows.map((r, i) => (
        <li key={i} title={r.hint}>
          <div className="barlist__label">
            <span className="t-truncate">{r.label}</span>
            <span className="barlist__value">
              {format(r.value)}
              {secondary ? <span className="t-faint"> {secondary(i)}</span> : null}
            </span>
          </div>
          <div className="barlist__track">
            <span style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Retencja kohort: jedna barwa, jasna → ciemna wraz z odsetkiem. */
export function RetentionHeatmap({
  rows,
}: {
  rows: { cohort: string; size: number; weeks: number[] }[]
}) {
  const cols = rows[0]?.weeks.length ?? 0
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th>Kohorta (tydzień)</th>
            <th>Użytk.</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>T{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <th scope="row">{shortDay(r.cohort.slice(0, 10))}</th>
              <td className="heatmap__size">{nf.format(r.size)}</td>
              {r.weeks.map((pct, i) => {
                const future = i > 0 && pct === 0 && r.weeks.slice(i).every((v) => v === 0)
                return (
                  <td
                    key={i}
                    className="heatmap__cell"
                    style={
                      future
                        ? undefined
                        : {
                            background: `rgba(0, 151, 160, ${0.08 + (pct / 100) * 0.85})`,
                            color: pct > 55 ? '#fff' : 'var(--color-ink)',
                          }
                    }
                    title={`${pct}% kohorty aktywne w tygodniu ${i}`}
                  >
                    {future ? '' : `${pct}%`}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Kafel z liczbą (nie wykres). */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'critical' | 'good'
}) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${tone ? ` stat__value--${tone}` : ''}`}>{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  )
}

/** Poziom logu: kolor statusu + etykieta (nigdy sam kolor). */
export function LevelBadge({ level }: { level: string }) {
  const tone =
    level === 'error' || level === 'fatal' ? 'critical' : level === 'warn' ? 'warning' : 'neutral'
  return <span className={`level level--${tone}`}>{level}</span>
}
