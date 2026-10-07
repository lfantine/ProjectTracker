import { useEffect, useRef, useState } from 'react'
import type { ChartConfig, ChartKind, ChartPoint } from '../lib/types'
import { uid } from '../lib/helpers'
import { Input } from './ui'
import { PlusIcon, TrashIcon } from './icons'

const CHART_KIND_LABEL: Record<ChartKind, string> = {
  bar: 'Barres',
  line: 'Courbe',
}

const HEIGHT = 200
const PAD = { top: 18, right: 12, bottom: 26, left: 40 }

export function parseChartValue(raw: string): number | null {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(n) ? n : null
}

function formatValue(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function formatTick(n: number): string {
  return Math.abs(n) >= 10000
    ? n.toLocaleString('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })
    : formatValue(n)
}

// Round axis bounds to clean steps (1, 2, 5 × 10^n) so ticks read 0 / 50 / 100…
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) as number
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v < max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

// Column path: 4px rounded data-end, square at the baseline.
function barPath(x: number, w: number, yValue: number, yBase: number): string {
  const up = yValue <= yBase
  const h = Math.abs(yBase - yValue)
  const r = Math.min(4, h, w / 2)
  if (up) {
    return `M${x},${yBase} V${yValue + r} Q${x},${yValue} ${x + r},${yValue} H${x + w - r} Q${x + w},${yValue} ${x + w},${yValue + r} V${yBase} Z`
  }
  return `M${x},${yBase} V${yValue - r} Q${x},${yValue} ${x + r},${yValue} H${x + w - r} Q${x + w},${yValue} ${x + w},${yValue - r} V${yBase} Z`
}

export function ChartModuleBody({
  config,
  editing,
  onChange,
}: {
  config: ChartConfig | undefined
  editing: boolean
  onChange: (config: ChartConfig) => void
}) {
  const chart: ChartConfig = config || { kind: 'bar', points: [] }
  if (editing) return <ChartEditor chart={chart} onChange={onChange} />
  return <ChartView chart={chart} />
}

function ChartView({ chart }: { chart: ChartConfig }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const points = chart.points
    .map((p) => ({ label: p.label.trim() || '—', value: parseChartValue(p.value) }))
    .filter((p): p is { label: string; value: number } => p.value !== null)

  if (points.length === 0) {
    return (
      <div ref={ref} className="text-[13px] text-text-faint py-6 text-center">
        Aucune donnée. Clique sur Edit pour ajouter des valeurs.
      </div>
    )
  }

  const values = points.map((p) => p.value)
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH
  const band = plotW / points.length
  const cx = (i: number) => PAD.left + band * i + band / 2
  const yBase = y(Math.max(yMin, Math.min(0, yMax)))
  const barW = Math.max(2, Math.min(24, band - 4))

  // Show every nth x label so they don't collide (~ 7px per character).
  const longest = Math.max(...points.map((p) => p.label.length))
  const labelEvery = Math.max(1, Math.ceil(((longest * 7 + 8) / Math.max(band, 1))))

  // Selective direct label: the peak for bars, the last point for a line.
  const labelled = chart.kind === 'bar' ? values.indexOf(Math.max(...values)) : points.length - 1

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${y(p.value)}`).join(' ')
  const areaPath = `${linePath} L${cx(points.length - 1)},${yBase} L${cx(0)},${yBase} Z`

  return (
    <div ref={ref} className="relative select-none" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${CHART_KIND_LABEL[chart.kind]} : ${points.map((p) => `${p.label} ${formatValue(p.value)}`).join(', ')}`}
          className="block overflow-visible"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-text-faint text-[10.5px] tabular-nums">
                {formatTick(t)}
              </text>
            </g>
          ))}

          {chart.kind === 'line' && hover !== null && (
            <line x1={cx(hover)} x2={cx(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-text-faint)" strokeWidth={1} />
          )}

          {chart.kind === 'bar' &&
            points.map((p, i) => (
              <path
                key={i}
                d={barPath(cx(i) - barW / 2, barW, y(p.value), yBase)}
                fill="var(--chart-series-1)"
                opacity={hover === null || hover === i ? 1 : 0.45}
                className="transition-opacity"
              />
            ))}

          {chart.kind === 'line' && (
            <>
              <path d={areaPath} fill="var(--chart-series-1)" opacity={0.1} />
              <path d={linePath} fill="none" stroke="var(--chart-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={cx(i)}
                  cy={y(p.value)}
                  r={hover === i ? 5 : 4}
                  fill="var(--chart-series-1)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              ))}
            </>
          )}

          {hover === null && (
            <text
              x={cx(labelled)}
              y={y(values[labelled]) + (values[labelled] < 0 ? 14 : -7)}
              textAnchor="middle"
              className="fill-text-muted text-[11px] font-semibold tabular-nums"
            >
              {formatValue(values[labelled])}
            </text>
          )}

          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={cx(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-text-faint text-[10.5px]">
                {p.label}
              </text>
            ) : null
          )}

          {/* Hit targets: the whole column band, larger than the mark. */}
          {points.map((_, i) => (
            <rect
              key={i}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      )}

      {hover !== null && (
        <div
          className="absolute pointer-events-none z-10 -translate-x-1/2 -translate-y-full bg-surface border border-border rounded-lg shadow-lg px-2.5 py-1.5 whitespace-nowrap"
          style={{ left: cx(hover), top: Math.min(y(points[hover].value), yBase) - 8 }}
        >
          <p className="text-[11px] text-text-faint">{points[hover].label}</p>
          <p className="text-[13px] font-bold text-text tabular-nums flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--chart-series-1)' }} />
            {formatValue(points[hover].value)}
          </p>
        </div>
      )}
    </div>
  )
}

function ChartEditor({ chart, onChange }: { chart: ChartConfig; onChange: (config: ChartConfig) => void }) {
  const [focusId, setFocusId] = useState<string | null>(null)

  function setPoints(points: ChartPoint[]) {
    onChange({ ...chart, points })
  }

  function addPoint() {
    const point = { id: uid('pt'), label: '', value: '' }
    setPoints(chart.points.concat([point]))
    setFocusId(point.id)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex bg-surface2 p-1 rounded-lg border border-border self-start">
        {(['bar', 'line'] as ChartKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange({ ...chart, kind: k })}
            className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer border-none ${
              chart.kind === k ? 'bg-surface text-text shadow-sm' : 'bg-transparent text-text-muted hover:text-text'
            }`}
          >
            {CHART_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {chart.points.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2 px-0.5 text-[11px] font-bold text-text-faint uppercase tracking-wide">
            <span className="flex-1">Libellé</span>
            <span className="w-28">Valeur</span>
            <span className="w-7" />
          </div>
          {chart.points.map((p, i) => {
            const invalid = p.value.trim() !== '' && parseChartValue(p.value) === null
            return (
              <div key={p.id} className="flex gap-2 items-center">
                <Input
                  aria-label={`Libellé ${i + 1}`}
                  autoFocus={focusId === p.id}
                  value={p.label}
                  placeholder="ex. Janvier"
                  className="flex-1 min-w-0"
                  onChange={(e) => setPoints(chart.points.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)))}
                />
                <Input
                  aria-label={`Valeur ${i + 1}`}
                  aria-invalid={invalid}
                  inputMode="decimal"
                  value={p.value}
                  placeholder="0"
                  className={`w-28 tabular-nums ${invalid ? 'border-danger!' : ''}`}
                  onChange={(e) => setPoints(chart.points.map((x) => (x.id === p.id ? { ...x, value: e.target.value } : x)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && i === chart.points.length - 1) addPoint()
                  }}
                />
                <button
                  type="button"
                  aria-label={`Supprimer la ligne ${i + 1}`}
                  onClick={() => setPoints(chart.points.filter((x) => x.id !== p.id))}
                  className="w-7 p-1.5 border-none bg-transparent text-text-faint hover:text-danger cursor-pointer rounded-md"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={addPoint}
        className="flex items-center justify-center gap-1.5 w-full rounded-xl border border-dashed border-border bg-transparent text-[13px] font-medium text-text-faint hover:text-accent hover:border-accent-soft cursor-pointer transition-colors py-2"
      >
        <PlusIcon size={14} /> Ajouter une valeur
      </button>
    </div>
  )
}
