import React, { useMemo, useState } from 'react'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { COLORS } from '../Shared/index.js'
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js'

/**
 * Daily Total sales, PPC sales, Gross profit and Ad spend — every marketplace added together, in USD.
 *
 * One shared USD axis (two axes would let the lines and bars suggest relationships that aren't
 * there). Bars are the two revenue measures, which compare directly with each other; lines are the
 * two measures read as a trend over them: gross profit (what's kept) and ad spend (what ads cost).
 */

const USD = '$'

// Order = legend order. `kind` decides how recharts draws it.
export const SERIES = [
  { key: 'totalSales', label: 'Total sales', kind: 'bar', color: '#3B82F6' },
  { key: 'ppcSales', label: 'PPC sales', kind: 'bar', color: '#22D3EE' },
  { key: 'grossProfit', label: 'Gross profit', kind: 'line', color: '#22C55E' },
  { key: 'adSpend', label: 'Ad spend', kind: 'line', color: '#F5A623', dashed: true },
]

/** "2026-09-14" -> "Sep 14". Parsed as a plain date so the timezone can't shift the day. */
export const formatDay = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number)
  if (!y || !m || !d) return String(ymd || '')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Show roughly 8 date labels however many days there are. */
export const tickInterval = (count) => (count <= 10 ? 0 : Math.ceil(count / 8) - 1)

/** Drops rows that have nothing at all in them, and reports whether anything is left to draw. */
export const shapeChartData = (daily) => {
  const rows = (daily || []).filter((d) => d && d.date && SERIES.some((s) => Number(d[s.key]) !== 0 && d[s.key] !== null && d[s.key] !== undefined))
  return { rows, hasData: rows.length > 0 }
}

/** "$1,250.50" / "-$20.60" — the sign goes in front of the symbol, not after it. */
export const money = (v) => {
  const n = Number(v) || 0
  return `${n < 0 ? '-' : ''}${formatCurrencyWithLocale(Math.abs(n), USD, 2)}`
}

/** Axis tick: $950, $1.2k, -$3.4k. (A loss day pushes gross profit below zero.) */
export const compactUsd = (v) => {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  const body = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k` : String(Math.round(abs))
  return `${n < 0 ? '-' : ''}${USD}${body}`
}

const ChartTooltip = ({ active, payload, label, hidden }) => {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className='rounded-lg border px-3 py-2.5 shadow-xl text-xs' style={{ background: '#1C2230', borderColor: COLORS.border, minWidth: 190 }}>
      <div className='font-semibold mb-1.5' style={{ color: COLORS.textPrimary }}>{formatDay(label)}</div>
      {SERIES.filter((s) => !hidden[s.key]).map((s) => (
        <div key={s.key} className='flex items-center justify-between gap-4 py-0.5'>
          <span className='inline-flex items-center gap-1.5' style={{ color: COLORS.textSecondary }}>
            <span className='inline-block w-2.5 h-2.5 rounded-sm' style={{ background: s.color }} />
            {s.label}
          </span>
          <span className='font-semibold tabular-nums' style={{ color: s.key === 'grossProfit' && row.grossProfit < 0 ? COLORS.fix : COLORS.textPrimary }}>{money(row[s.key])}</span>
        </div>
      ))}
    </div>
  )
}

const GlobalDailyChart = ({ daily, ratesAsOf, windowsDiffer }) => {
  const [hidden, setHidden] = useState({})
  const { rows, hasData } = useMemo(() => shapeChartData(daily), [daily])

  const toggle = (e) => {
    const key = e?.dataKey
    if (key) setHidden((h) => ({ ...h, [key]: !h[key] }))
  }

  if (!hasData) {
    return (
      <div className='rounded-2xl border h-full min-h-[280px] flex items-center justify-center text-sm' style={{ background: COLORS.surface, borderColor: COLORS.border, color: COLORS.textMuted }}>
        No daily data for this period yet.
      </div>
    )
  }

  return (
    <div className='rounded-2xl border p-5 h-full flex flex-col' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
      <div className='flex items-baseline justify-between gap-3 flex-wrap mb-3'>
        <div>
          <div className='text-sm font-semibold' style={{ color: COLORS.textPrimary }}>Daily sales, profit and ad spend</div>
          <div className='text-xs' style={{ color: COLORS.textMuted }}>All marketplaces, in USD · click a legend item to show or hide it</div>
        </div>
      </div>

      <div className='flex-1 min-h-[300px]'>
        <ResponsiveContainer width='100%' height='100%'>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap='18%' barGap={2}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='date' tickFormatter={formatDay} interval={tickInterval(rows.length)} tick={{ fill: COLORS.textMuted, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
            <YAxis tickFormatter={compactUsd} tick={{ fill: COLORS.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
            <ReferenceLine y={0} stroke={COLORS.borderStrong || '#3B4658'} />
            <Tooltip content={<ChartTooltip hidden={hidden} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
            <Legend onClick={toggle} wrapperStyle={{ fontSize: 12, cursor: 'pointer', paddingTop: 6 }} formatter={(value, entry) => <span style={{ color: hidden[entry.dataKey] ? COLORS.textMuted : COLORS.textSecondary, textDecoration: hidden[entry.dataKey] ? 'line-through' : 'none' }}>{value}</span>} />
            {SERIES.filter((s) => s.kind === 'bar').map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} fillOpacity={0.85} radius={[3, 3, 0, 0]} hide={Boolean(hidden[s.key])} isAnimationActive={false} />
            ))}
            {SERIES.filter((s) => s.kind === 'line').map((s) => (
              <Line key={s.key} type='monotone' dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '6 4' : undefined} dot={{ r: rows.length > 20 ? 0 : 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5 }} hide={Boolean(hidden[s.key])} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className='text-[11px] mt-2' style={{ color: COLORS.textMuted }}>
        {ratesAsOf ? `Converted at the ECB reference rate of ${ratesAsOf}. ` : ''}
        {windowsDiffer ? 'Each marketplace uses its own data window; a day with no data for a marketplace adds nothing.' : 'A day with no data for a marketplace adds nothing.'}
      </div>
    </div>
  )
}

export default GlobalDailyChart
