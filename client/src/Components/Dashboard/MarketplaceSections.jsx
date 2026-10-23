import React, { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { ArrowUpRight, Calendar, AlertTriangle, Lightbulb } from 'lucide-react'
import axiosInstance from '../../config/axios.config.js'
import { COLORS, InfoTooltip, StatusPill, STATUS } from '../Shared/index.js'
import { MiniBar } from './SamePageComponents/CampaignAuditKpis.jsx'
import GlobalDailyChart from './GlobalDailyChart.jsx'
import { marketplaceMeta } from '../Marketplace/MarketplaceLabel.jsx'
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js'
import { getCurrencySymbolForCode } from '../../utils/amazonAllowedCountries.js'
import { shouldUseCalendarDateRange } from '../../utils/totalSalesFilterUrl.js'

/**
 * The Dashboard's "All marketplaces" view: one section per marketplace, each showing that
 * marketplace's own Performance and Ads figures in its OWN currency. Nothing is converted or added
 * up across marketplaces.
 *
 * Money figures carry a faint "≈ $1,234" so marketplaces can be compared by eye; that hint uses the
 * latest ECB rate and is never the figure itself. A value the server couldn't compute shows "—"
 * rather than a made-up zero.
 */

const HINT_CURRENCY = 'USD'
const ACOS_HEALTHY_MAX = 25
const ROAS_HEALTHY_MIN = 4

/* ------------------------------------------------------------------ pure helpers (tested) */

const present = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v))

export const formatMoney = (value, currencyCode, digits = 2) =>
  present(value) ? formatCurrencyWithLocale(Number(value), getCurrencySymbolForCode(currencyCode), digits) : '—'

export const formatPct = (value, digits = 1) => (present(value) ? `${Number(value).toFixed(digits)}%` : '—')

/** "≈ $661" for a money figure in another currency; null when there is nothing honest to show. */
export const hintFor = (value, m) => {
  if (!present(value) || Number(value) === 0 || m.currencyCode === HINT_CURRENCY || !(m.hint?.rate > 0)) return null
  const usd = Number(value) * m.hint.rate
  // Whole dollars are fine for big amounts, but would turn a £0.80 click cost into "≈ $1".
  return `≈ ${formatCurrencyWithLocale(usd, getCurrencySymbolForCode(HINT_CURRENCY), Math.abs(usd) < 100 ? 2 : 0)}`
}

/** Account health score → status. Bands follow Amazon's AHR mapping on the server (100/80 healthy, 50 at risk, 30 unhealthy). */
export const healthStatus = (pct) => {
  if (!present(pct)) return null
  if (pct >= 80) return STATUS.GOOD
  if (pct >= 50) return STATUS.WATCH
  return STATUS.FIX
}

export const marginStatus = (pct) => (!present(pct) ? null : pct >= 15 ? STATUS.GOOD : pct >= 0 ? STATUS.WATCH : STATUS.FIX)
export const acosStatus = (acos) => (!present(acos) ? null : acos > ACOS_HEALTHY_MAX ? STATUS.FIX : STATUS.GOOD)
export const roasStatus = (roas) => (!present(roas) ? null : roas >= ROAS_HEALTHY_MIN ? STATUS.GOOD : roas >= 1 ? STATUS.WATCH : STATUS.FIX)

const colorOf = (status) => ({ [STATUS.GOOD]: COLORS.good, [STATUS.WATCH]: COLORS.watch, [STATUS.FIX]: COLORS.fix }[status] || COLORS.textPrimary)

/** The marketplace to look at first: the lowest account-health score, when scores differ. */
export const needsAttentionFirst = (marketplaces) => {
  const scored = marketplaces.filter((m) => present(m.metrics?.healthPct))
  if (scored.length < 2) return null
  const lowest = scored.reduce((w, m) => (m.metrics.healthPct < w.metrics.healthPct ? m : w))
  return scored.every((m) => m.metrics.healthPct === lowest.metrics.healthPct) ? null : lowest
}

/** Honest caveat under Gross Profit: product costs only count where the seller has entered them. */
export const costsNote = (x) => {
  if (!present(x.grossProfit) || !(x.productsSold > 0)) return null
  if (x.productsCosted >= x.productsSold) return null
  return `Product costs entered for ${Number(x.productsCosted || 0).toLocaleString()} of ${Number(x.productsSold).toLocaleString()} products — profit excludes the rest`
}

const EXCLUDED_REASON = { fx_unavailable: 'no exchange rate', no_finance_data: 'no finance data yet', ad_spend_not_daily: 'its ad spend has no daily breakdown' }

/** "UK (no exchange rate), MX (no finance data yet)" — what the USD totals left out, and why. */
export const excludedNote = (excluded) =>
  (excluded || []).map((e) => `${e.country} (${EXCLUDED_REASON[e.reason] || e.reason})`).join(', ')

/**
 * How a USD total was built, so the sum can be checked by eye: "US $1,000.00 + UK £500.00 (≈ $660.00)".
 * `field` is 'sales' | 'profit' (finance rows) or 'ppcSales' | 'adSpend' (ads rows).
 */
export const usdBreakdown = (totals, field) => {
  const finance = field === 'sales' || field === 'profit'
  const rows = (finance ? totals?.included : totals?.ads) || []
  const key = { sales: ['salesLocal', 'salesUsd'], profit: ['profitLocal', 'profitUsd'], ppcSales: ['ppcSalesLocal', 'ppcSalesUsd'], adSpend: ['adSpendLocal', 'adSpendUsd'] }[field]
  if (!key) return ''
  return rows.map((m) => {
    const local = formatMoney(m[key[0]], m.currencyCode)
    return m.currencyCode === 'USD' ? `${m.country} ${local}` : `${m.country} ${local} (≈ ${formatMoney(m[key[1]], 'USD')})`
  }).join(' + ')
}

const formatWindow = (w) => {
  if (!w?.startDate || !w?.endDate) return null
  const f = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(w.startDate)} – ${f(w.endDate)}`
}

/* ------------------------------------------------------------------------------- export */

const EXPORT_ROWS = [
  ['Performance'],
  ['Total Sales', 'totalSales', 'money'],
  ['Gross Profit', 'grossProfit', 'money'],
  ['Margin', 'marginPct', 'pct'],
  ['Money Amazon owes you', 'moneyOwed', 'money'],
  ['Account Health', 'healthPct', 'pct0'],
  ['Open issues', 'totalIssues', 'count'],
  ['Ads'],
  ['PPC Sales', 'ppcSales', 'money'],
  ['Ad Spend', 'adSpend', 'money'],
  ['ACoS', 'acos', 'pct'],
  ['TACoS', 'tacos', 'pct'],
  ['ROAS', 'roas', 'ratio'],
  ['Wasted Ad Spend', 'wastedSpend', 'money'],
  ['Units from Ads', 'unitsFromAds', 'count'],
  ['CTR', 'ctr', 'pct'],
  ['CPC', 'cpc', 'money'],
  ['What to fix'],
  ['Profit in play', 'profitInPlay', 'money'],
]

const exportCell = (kind, value, m) => {
  if (!present(value)) return '—'
  if (kind === 'money') {
    const hint = hintFor(value, m)
    return hint ? `${formatMoney(value, m.currencyCode)} (${hint})` : formatMoney(value, m.currencyCode)
  }
  if (kind === 'pct') return formatPct(value)
  if (kind === 'pct0') return `${Math.round(value)}%`
  if (kind === 'ratio') return `${Number(value).toFixed(2)}x`
  return Number(value).toLocaleString()
}

/**
 * Rows for the page's Export button (CSV / Excel): the Global performance block first, exactly as
 * the page shows it, then one column per marketplace in its own currency.
 * The first row is styled as the header by DownloadReport, so it is the block's own title row.
 */
export const comparisonExportRows = (data) => {
  const mps = data?.marketplaces || []
  const t = data?.totals
  const rows = []

  if (t) {
    rows.push(['Global performance (USD)', 'Amount', 'Built from'])
    rows.push(['Total sales', formatMoney(t.totalSales, 'USD'), usdBreakdown(t, 'sales')])
    rows.push(['Gross profit', formatMoney(t.grossProfit, 'USD'), usdBreakdown(t, 'profit')])
    rows.push(['Margin', formatPct(t.marginPct), 'Combined gross profit over combined sales'])
    rows.push(['PPC sales', formatMoney(t.ppcSales, 'USD'), usdBreakdown(t, 'ppcSales')])
    rows.push(['Ad spend', formatMoney(t.adSpend, 'USD'), usdBreakdown(t, 'adSpend')])
    rows.push(['ACoS', formatPct(t.acos), 'Combined ad spend over combined PPC sales'])
    if (t.excluded?.length) rows.push(['Left out of sales & profit', excludedNote(t.excluded)])
    if (t.adsExcluded?.length) rows.push(['Left out of ad totals', excludedNote(t.adsExcluded)])
    if (t.costsIncompleteFor?.length) rows.push(['Profit excludes product costs not yet entered in', t.costsIncompleteFor.join(', ')])
    if (t.ratesAsOf) rows.push(['Exchange rate', `ECB reference rate of ${t.ratesAsOf}`])
    rows.push([])
  }

  rows.push(['Metric', ...mps.map((m) => `${m.country} (${m.currencyCode})`)])
  rows.push(['Data window', ...mps.map((m) => (m.window?.startDate && m.window?.endDate ? `${m.window.startDate} to ${m.window.endDate}` : 'Default (last 30 days)'))])
  for (const [label, key, kind] of EXPORT_ROWS) {
    if (!key) { rows.push([label]); continue }
    rows.push([label, ...mps.map((m) => exportCell(kind, m.metrics?.[key], m))])
  }
  rows.push(['Biggest fix', ...mps.map((m) => (m.metrics?.topFix ? `${m.metrics.topFix.title || 'Fix'} — ${formatMoney(m.metrics.topFix.amount, m.currencyCode)}` : '—'))])
  if (t?.daily?.length) {
    rows.push([])
    rows.push(['Daily, all marketplaces (USD)', 'Total sales', 'Gross profit', 'PPC sales', 'Ad spend'])
    for (const d of t.daily) rows.push([d.date, formatMoney(d.totalSales, 'USD'), formatMoney(d.grossProfit, 'USD'), formatMoney(d.ppcSales, 'USD'), formatMoney(d.adSpend, 'USD')])
  }
  rows.push([])
  rows.push(['Every figure above is in its marketplace\'s own currency; nothing is converted except the Global performance block.'])
  if (data?.ratesAsOf) rows.push([`≈ figures: approximate ${HINT_CURRENCY}, ECB reference rate of ${data.ratesAsOf}, for comparison only.`])
  return rows
}

/* ------------------------------------------------------------------------------- data */

function useMarketplaceSections() {
  const info = useSelector((s) => s.Dashboard?.DashBoardInfo)
  const range = shouldUseCalendarDateRange(info?.startDate, info?.endDate, info?.calendarMode)
    ? { startDate: info.startDate, endDate: info.endDate }
    : null
  const key = `${range?.startDate || ''}|${range?.endDate || ''}`
  const [state, setState] = useState({ data: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ data: prev.data, loading: true, error: null }))
    axiosInstance
      .get('/api/pagewise/dashboard-marketplaces', { params: { hintCurrency: HINT_CURRENCY, ...(range || {}) } })
      .then((res) => { if (!cancelled) setState({ data: res.data?.data || null, loading: false, error: null }) })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error: error?.response?.data?.message || 'Could not load your marketplaces' })
      })
    return () => { cancelled = true }
    // `key` captures the range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}

/* -------------------------------------------------------------------------------- UI */

const Tile = ({ label, tooltip, value, valueColor, hint, children, note }) => (
  <div className='rounded-xl border p-4 flex flex-col gap-1.5 min-w-0' style={{ background: COLORS.bgBase, borderColor: COLORS.border }}>
    <div className='flex items-start gap-1.5'>
      <span className='text-[11px] font-semibold uppercase tracking-wide flex-1' style={{ color: COLORS.textSecondary }}>{label}</span>
      {tooltip && <InfoTooltip text={tooltip} position='left' />}
    </div>
    <div className='flex items-baseline gap-2 flex-wrap'>
      <span className='text-[24px] leading-[30px] font-bold tracking-tight tabular-nums' style={{ color: value === '—' ? COLORS.textMuted : (valueColor || COLORS.textPrimary) }}>{value}</span>
      {hint && <span className='text-xs tabular-nums' style={{ color: COLORS.textMuted }}>{hint}</span>}
    </div>
    {children}
    {note && <div className='text-xs leading-[17px] mt-auto' style={{ color: COLORS.textMuted }}>{note}</div>}
  </div>
)

const MiniStat = ({ label, value, tooltip }) => (
  <div className='flex items-baseline justify-between gap-3 rounded-lg px-3 py-2' style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}` }}>
    <span className='text-xs inline-flex items-center gap-1' style={{ color: COLORS.textSecondary }}>{label}{tooltip && <InfoTooltip text={tooltip} position='left' />}</span>
    <span className='text-sm font-semibold tabular-nums' style={{ color: value === '—' ? COLORS.textMuted : COLORS.textPrimary }}>{value}</span>
  </div>
)

const GroupTitle = ({ children }) => (
  <div className='text-[11px] font-semibold uppercase tracking-wider mb-2.5' style={{ color: COLORS.textMuted }}>{children}</div>
)

const MarketplaceSection = ({ m, onOpen }) => {
  const x = m.metrics || {}
  const cur = m.currencyCode
  const hs = healthStatus(x.healthPct)
  const window = formatWindow(m.window)
  const meta = marketplaceMeta[m.country]
  const partial = (m.failedSources || []).length > 0

  const marginBar = present(x.marginPct) ? (
    <MiniBar
      pct={Math.max(0, x.marginPct)}
      color={colorOf(marginStatus(x.marginPct))}
      leftLabel={x.marginPct >= 0 ? `${x.marginPct.toFixed(1)}% kept` : `${Math.abs(x.marginPct).toFixed(1)}% loss`}
      rightLabel={x.marginPct >= 0 ? `${(100 - x.marginPct).toFixed(1)}% costs` : undefined}
    />
  ) : null

  const wastedPct = present(x.wastedSpend) && x.adSpend > 0 ? (x.wastedSpend / x.adSpend) * 100 : null

  return (
    <section
      id={`marketplace-${m.country}`}
      className='rounded-2xl border overflow-hidden scroll-mt-6'
      style={{ background: COLORS.surface, borderColor: COLORS.border }}
    >
      {/* Header */}
      <div
        className='flex items-center gap-4 flex-wrap px-6 py-4 border-b'
        style={{ borderColor: COLORS.border, background: 'linear-gradient(90deg, rgba(59,130,246,.10), transparent 60%)' }}
      >
        <div className='flex items-center gap-3 min-w-0 flex-1'>
          <span className='text-[28px] leading-none' aria-hidden='true'>{meta?.flag || '🌐'}</span>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 flex-wrap'>
              <h2 className='m-0 text-lg font-semibold' style={{ color: COLORS.textPrimary }}>{meta?.domain || m.country}</h2>
              <span className='px-2 py-0.5 rounded-md text-[11px] font-semibold' style={{ background: 'rgba(255,255,255,.06)', color: COLORS.textSecondary }}>{cur}</span>
            </div>
            <div className='flex items-center gap-3 flex-wrap text-xs mt-0.5' style={{ color: COLORS.textMuted }}>
              {window && <span className='inline-flex items-center gap-1'><Calendar className='w-3 h-3' />{window}</span>}
              {partial && <span className='inline-flex items-center gap-1' style={{ color: COLORS.watch }}><AlertTriangle className='w-3 h-3' />Some data unavailable ({m.failedSources.join(', ')})</span>}
            </div>
          </div>
        </div>
        {hs && (
          <div className='flex items-center gap-2'>
            <span className='text-xs' style={{ color: COLORS.textMuted }}>Account health</span>
            <StatusPill status={hs} label={`${x.healthStatus || ''} ${Math.round(x.healthPct)}%`.trim()} compact />
          </div>
        )}
        <button
          type='button'
          onClick={() => onOpen?.(m)}
          className='inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold border transition-colors hover:border-[#3B82F6]'
          style={{ background: 'rgba(59,130,246,.12)', borderColor: 'rgba(59,130,246,.35)', color: '#7EA8F8' }}
        >
          Open full dashboard <ArrowUpRight className='w-3.5 h-3.5' />
        </button>
      </div>

      <div className='p-6 flex flex-col gap-6'>
        {/* Performance */}
        <div>
          <GroupTitle>Performance</GroupTitle>
          <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3'>
            <Tile label='Total Sales' value={formatMoney(x.totalSales, cur)} hint={hintFor(x.totalSales, m)}
              note={present(x.totalSales) ? (present(x.adSalesSharePct) ? `${x.adSalesSharePct.toFixed(0)}% of sales came from ads` : 'Everything you sold this period') : 'No finance data for this period yet'} />
            <Tile label='Gross Profit' tooltip='Sales minus Amazon fees, refunds, overhead, ad spend and product costs (where entered).'
              value={formatMoney(x.grossProfit, cur)} valueColor={colorOf(marginStatus(x.marginPct))} hint={hintFor(x.grossProfit, m)}
              note={costsNote(x)}>
              {marginBar}
            </Tile>
            <Tile label='Money Amazon owes you' tooltip='Unclaimed FBA reimbursements — you still have to file each claim.'
              value={formatMoney(x.moneyOwed, cur)} hint={hintFor(x.moneyOwed, m)}
              note={x.moneyOwed > 0 ? 'Ready to claim' : 'No unclaimed reimbursements found'} />
            <Tile label='Open issues' value={present(x.totalIssues) ? Number(x.totalIssues).toLocaleString() : '—'}
              valueColor={x.totalIssues > 0 ? COLORS.watch : COLORS.good}
              note={x.totalIssues > 0 ? `Across ${Number(x.productsWithIssues || 0).toLocaleString()} product${x.productsWithIssues === 1 ? '' : 's'} and your account` : 'Nothing needs attention'} />
          </div>
        </div>

        {/* Ads */}
        <div>
          <GroupTitle>Ads</GroupTitle>
          <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3'>
            <Tile label='PPC Sales' value={formatMoney(x.ppcSales, cur)} hint={hintFor(x.ppcSales, m)}
              note={x.ppcSales > 0 ? 'Sales your ads brought in' : 'No ad sales this period'} />
            <Tile label='Ad Spend' value={formatMoney(x.adSpend, cur)} hint={hintFor(x.adSpend, m)}
              note={x.adSpend > 0 ? `${formatMoney(x.ppcSales - x.adSpend, cur)} ${x.ppcSales - x.adSpend >= 0 ? 'left' : 'short'} after ad spend` : 'No ad spend this period'} />
            <Tile label='ACoS' tooltip={`Ad cost as % of ad sales. Healthy: under ${ACOS_HEALTHY_MAX}%.`}
              value={formatPct(x.acos)} valueColor={colorOf(acosStatus(x.acos))}
              note={present(x.acos) ? (x.acos > ACOS_HEALTHY_MAX ? `Above the ${ACOS_HEALTHY_MAX}% healthy mark` : `Within the ${ACOS_HEALTHY_MAX}% healthy mark`) : 'No ad sales to measure'} />
            <Tile label='ROAS' tooltip={`Ad sales per 1 of ad spend. Healthy: above ${ROAS_HEALTHY_MIN}x.`}
              value={present(x.roas) ? `${x.roas.toFixed(2)}x` : '—'} valueColor={colorOf(roasStatus(x.roas))}>
              {present(x.roas) && <MiniBar pct={(x.roas / ROAS_HEALTHY_MIN) * 100} color={colorOf(roasStatus(x.roas))} leftLabel='0x' rightLabel={`${ROAS_HEALTHY_MIN}x healthy`} />}
            </Tile>
            <Tile label='Wasted ad spend' tooltip='Spend on keywords that never sold in this period.'
              value={formatMoney(x.wastedSpend, cur)} valueColor={x.wastedSpend > 0 ? COLORS.fix : undefined} hint={hintFor(x.wastedSpend, m)}
              note={x.wastedSpend > 0 ? undefined : 'No wasted spend found'}>
              {wastedPct !== null && x.wastedSpend > 0 && (
                <MiniBar pct={wastedPct} color={COLORS.fix} leftLabel={`${Math.min(100, wastedPct).toFixed(0)}% wasted`} rightLabel={`${Math.max(0, 100 - wastedPct).toFixed(0)}% working`} />
              )}
            </Tile>
          </div>
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3'>
            <MiniStat label='Units from ads' value={present(x.unitsFromAds) ? Number(x.unitsFromAds).toLocaleString() : '—'} />
            <MiniStat label='TACoS' tooltip='Ad spend as % of total sales.' value={formatPct(x.tacos)} />
            <MiniStat label='CTR' tooltip='Clicks as % of impressions.' value={formatPct(x.ctr)} />
            <MiniStat label='CPC' tooltip='Average cost per click.' value={formatMoney(x.cpc, cur)} />
          </div>
        </div>

        {/* What to fix */}
        <div
          className='rounded-xl border px-4 py-3.5 flex items-center gap-3 flex-wrap'
          style={{ background: 'rgba(245,166,35,.06)', borderColor: 'rgba(245,166,35,.25)' }}
        >
          <Lightbulb className='w-4 h-4 flex-none' style={{ color: COLORS.watch }} />
          {x.topFix ? (
            <>
              <div className='flex-1 min-w-[220px]'>
                <div className='text-[11px] font-semibold uppercase tracking-wide' style={{ color: COLORS.textMuted }}>Biggest fix here</div>
                <div className='text-sm font-medium' style={{ color: COLORS.textPrimary }}>{x.topFix.title}</div>
              </div>
              <div className='text-right'>
                <div className='text-base font-bold tabular-nums' style={{ color: COLORS.good }}>{formatMoney(x.topFix.amount, cur)}</div>
                {hintFor(x.topFix.amount, m) && <div className='text-[11px] tabular-nums' style={{ color: COLORS.textMuted }}>{hintFor(x.topFix.amount, m)}</div>}
              </div>
            </>
          ) : (
            <span className='text-sm' style={{ color: COLORS.textSecondary }}>Nothing high-impact is outstanding here right now.</span>
          )}
          {present(x.profitInPlay) && x.profitInPlay > 0 && (
            <span className='text-xs' style={{ color: COLORS.textMuted }}>{formatMoney(x.profitInPlay, cur)} of profit in play across all fixes</span>
          )}
        </div>
      </div>
    </section>
  )
}

const Skeleton = () => (
  <div className='flex flex-col gap-5'>
    {[0, 1].map((i) => (
      <div key={i} className='rounded-2xl border p-6 flex flex-col gap-4' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
        <div className='h-8 w-56 rounded animate-pulse' style={{ background: COLORS.border }} />
        <div className='grid grid-cols-4 gap-3'>{[0, 1, 2, 3].map((j) => <div key={j} className='h-24 rounded-xl animate-pulse' style={{ background: COLORS.border }} />)}</div>
        <div className='grid grid-cols-5 gap-3'>{[0, 1, 2, 3, 4].map((j) => <div key={j} className='h-24 rounded-xl animate-pulse' style={{ background: COLORS.border }} />)}</div>
      </div>
    ))}
  </div>
)

/** All marketplaces added together in USD — four separate boxes above the per-marketplace sections. */
const UsdTotals = ({ totals, windowsDiffer }) => {
  if (!totals) return null
  const hasFinance = present(totals.totalSales)
  const hasAds = present(totals.ppcSales)
  const note = { color: COLORS.textMuted }
  const warn = { color: COLORS.watch }
  const subLine = (field) => (
    <div className='text-[11px] leading-[15px] mt-auto break-words' style={note}>{usdBreakdown(totals, field)}</div>
  )

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-3 flex-wrap'>
        <h2 className='m-0 text-base font-semibold' style={{ color: COLORS.textPrimary }}>Global performance</h2>
        <span className='px-2 py-0.5 rounded-md text-[11px] font-semibold' style={{ background: 'rgba(255,255,255,.06)', color: COLORS.textSecondary }}>USD</span>
        {totals.ratesAsOf && <span className='text-xs ml-auto' style={note}>Converted at the ECB reference rate of {totals.ratesAsOf}</span>}
      </div>

      {/* Daily chart on the left; the four headline boxes stacked one after another on the right. */}
      <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 items-stretch'>
        <GlobalDailyChart daily={totals.daily} ratesAsOf={totals.ratesAsOf} windowsDiffer={windowsDiffer} />

        <div className='flex flex-col gap-3'>
          <Tile label='Total sales' value={formatMoney(totals.totalSales, 'USD')}>{hasFinance && subLine('sales')}</Tile>
          <Tile
            label='Gross profit'
            tooltip='Sales minus Amazon fees, refunds, overhead, ad spend and product costs (where entered), added across marketplaces in USD.'
            value={formatMoney(totals.grossProfit, 'USD')}
            valueColor={colorOf(marginStatus(totals.marginPct))}
          >
            {present(totals.marginPct) && <div className='text-xs font-medium' style={{ color: COLORS.textSecondary }}>{totals.marginPct.toFixed(1)}% margin</div>}
            {hasFinance && subLine('profit')}
          </Tile>
          <Tile label='PPC sales' value={formatMoney(totals.ppcSales, 'USD')}>{hasAds && subLine('ppcSales')}</Tile>
          <Tile label='Ad spend' value={formatMoney(totals.adSpend, 'USD')}>
            {present(totals.acos) && <div className='text-xs font-medium' style={{ color: colorOf(acosStatus(totals.acos)) }}>{totals.acos.toFixed(1)}% ACoS combined</div>}
            {hasAds && subLine('adSpend')}
          </Tile>
        </div>
      </div>

      {(!hasFinance || totals.excluded?.length > 0 || totals.adsExcluded?.length > 0 || totals.dailyExcluded?.length > 0 || totals.anyStaleRate || totals.costsIncompleteFor?.length > 0) && (
        <div className='flex flex-col gap-1 text-xs'>
          {!hasFinance && <span style={note}>No marketplace has finance data and an exchange rate yet, so sales and profit have nothing to add up.</span>}
          {totals.excluded?.length > 0 && <span style={warn}>Left out of sales &amp; profit: {excludedNote(totals.excluded)}.</span>}
          {totals.adsExcluded?.length > 0 && <span style={warn}>Left out of ad totals: {excludedNote(totals.adsExcluded)}.</span>}
          {totals.dailyExcluded?.length > 0 && <span style={warn}>Left out of the daily chart&apos;s sales and profit: {excludedNote(totals.dailyExcluded)}.</span>}
          {totals.anyStaleRate && <span style={warn}>Exchange rates are a few days old, so the converted amounts are approximate.</span>}
          {totals.costsIncompleteFor?.length > 0 && <span style={note}>Profit excludes product costs you haven&apos;t entered yet in: {totals.costsIncompleteFor.join(', ')}.</span>}
        </div>
      )}
    </div>
  )
}

const MarketplaceSections = ({ onOpenMarketplace, onData }) => {
  const { data, loading, error } = useMarketplaceSections()
  const marketplaces = useMemo(() => data?.marketplaces || [], [data])

  useEffect(() => { onData?.(data) }, [data, onData])

  if (error) {
    return <div className='rounded-2xl border p-6 text-sm' style={{ background: COLORS.surface, borderColor: COLORS.border, color: COLORS.fix }}>{error}</div>
  }
  if (loading && !data) return <Skeleton />

  const hasHints = marketplaces.some((m) => m.hint)

  return (
    <div className='flex flex-col gap-5'>
      <UsdTotals totals={data?.totals} windowsDiffer={data?.windowsDiffer} />

      {marketplaces.map((m) => <MarketplaceSection key={`${m.country}:${m.region}`} m={m} onOpen={onOpenMarketplace} />)}

      <div className='text-xs flex flex-col gap-1' style={{ color: COLORS.textMuted }}>
        <span>Every figure is in its marketplace&apos;s own currency — nothing is converted or added together.</span>
        {hasHints && data?.ratesAsOf && <span>≈ figures are approximate {HINT_CURRENCY}, at the ECB reference rate of {data.ratesAsOf} — for comparison only.</span>}
        {data?.windowsDiffer && <span>Each marketplace uses its own latest data window.</span>}
        {(data?.failedMarketplaces || []).length > 0 && (
          <span style={{ color: COLORS.watch }}>Couldn&apos;t load: {data.failedMarketplaces.map((m) => m.country).join(', ')}.</span>
        )}
      </div>
    </div>
  )
}

export default MarketplaceSections
