import { fmtNum } from '../utils/format'

interface Point {
  label: string
  value: number
}

/* ---------- BarChart (แท่งตั้ง) ---------- */
export function BarChart({
  data,
  height = 200,
  color = 'var(--accent)',
  formatValue,
  max,
}: {
  data: Point[]
  height?: number
  color?: string
  formatValue?: (v: number) => string
  max?: number
}) {
  const maxValue = max ?? Math.max(1, ...data.map((d) => d.value))
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} className="bar-col" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div
              className="bar"
              title={`${d.label}: ${formatValue ? formatValue(d.value) : fmtNum(d.value)}`}
              style={{
                height: `${Math.max(2, (d.value / maxValue) * 100)}%`,
                background: color,
                borderRadius: '6px 6px 3px 3px',
                minHeight: 3,
                opacity: d.value === 0 ? 0.25 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- LineChart (เส้นแนวโน้ม) ---------- */
export function LineChart({
  data,
  height = 200,
  color = 'var(--accent)',
  formatValue,
  label,
}: {
  data: Point[]
  height?: number
  color?: string
  formatValue?: (v: number) => string
  /** ชื่อกราฟสำหรับ screen reader (WCAG 1.1.1) */
  label?: string
}) {
  const W = 600
  const H = 200
  const padL = 10
  const padR = 10
  const padT = 12
  const padB = 8
  const maxValue = Math.max(1, ...data.map((d) => d.value))
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const points = data.map((d, i) => {
    const x = data.length <= 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW
    const y = padT + innerH - (d.value / maxValue) * innerH
    return { x, y, ...d }
  })

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${padT + innerH} L${points[0]!.x.toFixed(1)},${padT + innerH} Z`
    : ''

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={label}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* เส้นตาราง */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + innerH * (1 - f)} y2={padT + innerH * (1 - f)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
        ))}
        <path d={areaPath} fill="url(#areaFill)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="line-path" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="var(--surface)" stroke={color} strokeWidth="2">
              <title>{`${p.label}: ${formatValue ? formatValue(p.value) : fmtNum(p.value)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  )
}

/* ---------- DonutChart (วงแหวนสัดส่วน) ---------- */
export function DonutChart({
  segments,
  size = 170,
  thickness = 24,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; color: string }[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0))
  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  let acc = 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div className="donut-wrap" style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
          {segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
              const frac = s.value / total
              const dash = frac * C
              const offset = -acc * C
              acc += frac
              return (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={offset}
                  strokeLinecap="butt"
                >
                  <title>{`${s.label}: ${fmtNum(s.value)}`}</title>
                </circle>
              )
            })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }}>{centerValue}</div>
          {centerLabel && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{centerLabel}</div>}
        </div>
      </div>
      <div className="chart-legend" style={{ flexDirection: 'column', gap: 8, marginTop: 0 }}>
        {segments.map((s, i) => (
          <div key={i} className="item" style={{ fontSize: 13 }}>
            <span className="swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <b style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{fmtNum(s.value)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}
