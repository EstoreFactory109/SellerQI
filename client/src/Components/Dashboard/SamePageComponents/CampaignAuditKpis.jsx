import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, DollarSign, Gauge, Package, Target, Eye, MousePointerClick, Percent, Coins } from 'lucide-react';
import { COLORS, InfoTooltip } from '../../Shared/index.js';
import { SkeletonBar } from '../../Skeleton/Skeleton.jsx';
import { formatCurrencyWithLocale } from '../../../utils/currencyUtils.js';
import { computeTacos, formatPercentOrNA } from '../../../utils/ppcKpis.js';

/**
 * Builds the 10 Campaign Audit KPI boxes (6 primary + 4 engagement mini-stats).
 * Shared by the Campaign Audit page and the Dashboard so both always show the same figures.
 *
 * `ppcKPISummary` (date-range aggregate from /api/pagewise/ppc/summary) is the authoritative
 * source; `ppcSummary` and `sponsoredAdsMetrics` are zero-data fallbacks for accounts that
 * haven't been ingested yet.
 */
export const buildCampaignAuditKpis = ({
  ppcKPISummary,
  ppcSummary,
  sponsoredAdsMetrics,
  info,
  currency,
  totalWastedSpend = 0,
}) => {
  let spend = 0;
  let ppcSales = 0;
  let unitsSold = 0;
  let tacos = null; // null = compute on-frontend if backend didn't provide it
  let impressions = 0;
  let clicks = 0;
  let ctr = null; // null = derive from clicks/impressions
  let cpc = null;
  let roas = null;

  if (ppcKPISummary && (ppcKPISummary.spend > 0 || ppcKPISummary.sales > 0 || ppcKPISummary.unitsSold > 0)) {
    // PRIMARY: date-range aggregate from /api/pagewise/ppc/summary
    spend = Number(ppcKPISummary.spend || 0);
    ppcSales = Number(ppcKPISummary.sales || 0);
    unitsSold = Number(ppcKPISummary.unitsSold || 0);
    tacos = ppcKPISummary.tacos != null ? Number(ppcKPISummary.tacos) : null;
    impressions = Number(ppcKPISummary.impressions || 0);
    clicks = Number(ppcKPISummary.clicks || 0);
    ctr = ppcKPISummary.ctr != null ? Number(ppcKPISummary.ctr) : null;
    cpc = ppcKPISummary.cpc != null ? Number(ppcKPISummary.cpc) : null;
    roas = ppcKPISummary.roas != null ? Number(ppcKPISummary.roas) : null;
  } else if (ppcSummary?.totalSpend > 0 || ppcSummary?.totalSales > 0) {
    // Fallback 1: PPCMetrics model rollup (no date filter)
    spend = Number(ppcSummary.totalSpend || 0);
    ppcSales = Number(ppcSummary.totalSales || 0);
    unitsSold = Number(ppcSummary.totalUnits || 0);
    impressions = Number(ppcSummary.totalImpressions || 0);
    clicks = Number(ppcSummary.totalClicks || 0);
  } else {
    // Fallback 2: legacy sponsoredAdsMetrics (e.g. first-load / not-yet-ingested users)
    const adsPPCSpend = Number(sponsoredAdsMetrics?.totalCost || 0);
    spend = adsPPCSpend > 0 ? adsPPCSpend : Number(info?.accountFinance?.ProductAdsPayment || 0);
    ppcSales = Number(sponsoredAdsMetrics?.totalSalesIn30Days || 0);
    unitsSold = Number(sponsoredAdsMetrics?.totalProductsPurchased || 0);
    impressions = Number(sponsoredAdsMetrics?.totalImpressions || 0);
    clicks = Number(sponsoredAdsMetrics?.totalClicks || 0);
  }

  const acos = ppcSales > 0 ? (spend / ppcSales) * 100 : 0;

  // Real total-sales figure (all channels, same window as PPC sales) — prefer
  // the backend's own aggregate over back-deriving one from TACoS.
  // null = no sales data at all (TotalWeeklySale is null with no finance data).
  let totalSales = ppcKPISummary?.totalSales != null ? Number(ppcKPISummary.totalSales) : null;
  if (!totalSales) {
    const totalSalesData = info?.TotalSales;
    if (Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      totalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
    } else if (info?.TotalWeeklySale != null) {
      totalSales = Number(info.TotalWeeklySale);
    }
  }

  // TACoS: prefer the backend value; otherwise derive it from total sales. With no sales it is
  // "not available" (shown as —), never 0% or infinity.
  tacos = computeTacos({ backendTacos: tacos, spend, totalSales });

  // Derive engagement KPIs locally if backend didn't supply them (fallback paths).
  if (ctr == null) ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  if (cpc == null) cpc = clicks > 0 ? spend / clicks : 0;
  if (roas == null) roas = spend > 0 ? ppcSales / spend : 0;

  // Real captions — only shown when there's real data behind them (no invented numbers).
  const pctOfTotalSales = totalSales > 0 ? (ppcSales / totalSales) * 100 : null;
  const wastedSpendCaption = totalWastedSpend > 0
    ? `${formatCurrencyWithLocale(totalWastedSpend, currency)} wasted`
    : null;

  const primary = [
    {
      label: 'PPC Sales',
      value: formatCurrencyWithLocale(ppcSales, currency),
      icon: TrendingUp,
      caption: pctOfTotalSales != null ? `${pctOfTotalSales.toFixed(0)}% of total sales` : null,
    },
    {
      label: 'Ad Spend',
      value: formatCurrencyWithLocale(spend, currency),
      icon: DollarSign,
      caption: wastedSpendCaption,
      captionColor: wastedSpendCaption ? '#F87171' : undefined,
    },
    {
      label: 'ACoS',
      value: `${acos.toFixed(2)}%`,
      icon: Gauge,
      valueColor: acos > 25 ? '#F87171' : undefined,
      caption: 'Healthy: under 25%',
      tooltip: 'Ad cost as % of ad sales. Lower is better.',
    },
    {
      label: 'TACoS',
      value: formatPercentOrNA(tacos),
      icon: Gauge,
      valueColor: tacos != null && tacos > 15 ? COLORS.watch : undefined,
      caption: 'Share of total sales driven by ads',
      tooltip: 'Ad spend as % of total sales — how dependent the business is on ads.',
    },
    {
      label: 'ROAS',
      value: `${roas.toFixed(2)}x`,
      icon: Target,
      valueColor: roas >= 4 ? COLORS.good : undefined,
      caption: 'Healthy: above 4x',
      tooltip: `Return on ad spend — sales earned per ${currency || '$'}1 spent.`,
    },
    {
      label: 'Units from Ads',
      value: `${Number(unitsSold || 0).toLocaleString()}`,
      icon: Package,
    },
  ];

  const mini = [
    { label: 'Impressions', value: `${Number(impressions || 0).toLocaleString()}`, icon: Eye },
    { label: 'Clicks', value: `${Number(clicks || 0).toLocaleString()}`, icon: MousePointerClick },
    { label: 'CTR', value: `${Number(ctr || 0).toFixed(2)}%`, icon: Percent },
    { label: 'CPC', value: formatCurrencyWithLocale(cpc, currency), icon: Coins },
  ];

  // Data-driven one-liners for the Dashboard cards. Every figure is computed from the numbers
  // above (or the summary's own order/day counts), and each note is absent when the data to
  // back it isn't there — nothing here is a fixed marketing line.
  const money = (v) => formatCurrencyWithLocale(v, currency);
  const orders = ppcKPISummary?.orders != null ? Number(ppcKPISummary.orders) : null;
  const days = Number(ppcKPISummary?.dataAvailability?.ppcDaysWithData) || (Array.isArray(ppcKPISummary?.timeseries) ? ppcKPISummary.timeseries.length : 0);
  const notes = {
    salesVsSpend: spend > 0 || ppcSales > 0
      ? `${ppcSales - spend >= 0 ? `${money(ppcSales - spend)} left` : `${money(spend - ppcSales)} short`} after ad spend, before product costs`
      : null,
    acos: ppcSales > 0 ? (acos > 25 ? `ACoS is above the 25% healthy mark` : `ACoS is within the 25% healthy mark`) : null,
    roas: spend > 0
      ? (roas >= 4 ? 'Strong — above the 4x healthy mark'
        : roas >= 1 ? 'Covers ad spend, but below the 4x healthy mark'
        : "Ad sales don't cover ad spend yet")
      : null,
    units: unitsSold > 0
      ? `${money(spend / unitsSold)} ad cost per unit${orders ? ` · ${orders.toLocaleString()} orders` : ''}`
      : null,
    impressions: impressions > 0 && days > 0 ? `About ${Math.round(impressions / days).toLocaleString()} shown per day` : null,
    clicks: clicks > 0 ? (orders ? `About ${((orders / clicks) * 100).toFixed(1)}% of clicks became orders` : unitsSold ? `About ${Math.round((unitsSold / clicks) * 100)} units per 100 clicks` : null) : null,
    ctr: ctr > 0 ? `About 1 in ${Math.max(1, Math.round(100 / ctr)).toLocaleString()} shoppers who saw your ads clicked` : null,
    cpc: clicks > 0 && spend > 0 ? `${money(spend)} spent across ${clicks.toLocaleString()} clicks` : null,
  };

  // Nothing recorded at all -> say so on every card instead of leaving them blank.
  const noActivity = spend <= 0 && impressions <= 0 && clicks <= 0 ? 'No ad activity recorded for this period' : null;
  Object.keys(notes).forEach((k) => { notes[k] = notes[k] || noActivity; });

  return {
    notes,
    adsSharePct: pctOfTotalSales,
    primary,
    mini,
    roas,
    spend,
    wastedSpend: totalWastedSpend,
    wastedSpendValue: formatCurrencyWithLocale(totalWastedSpend, currency),
    wastedPctOfSpend: spend > 0 ? (totalWastedSpend / spend) * 100 : null,
  };
};

export const useCampaignAuditKpis = (args) => {
  const { ppcKPISummary, ppcSummary, sponsoredAdsMetrics, info, currency, totalWastedSpend } = args;
  return useMemo(
    () => buildCampaignAuditKpis({ ppcKPISummary, ppcSummary, sponsoredAdsMetrics, info, currency, totalWastedSpend }),
    [ppcKPISummary, ppcSummary, sponsoredAdsMetrics, info?.TotalSales, info?.TotalWeeklySale, info?.accountFinance, currency, totalWastedSpend],
  );
};

/** The 6 primary cards plus the 4 engagement mini-stats (10 boxes). */
const GroupLabel = ({ children }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wider mb-2 mt-1" style={{ color: COLORS.textMuted }}>{children}</div>
);

// Dashboard card — same anatomy as the Performance KPI cards (label + plain meaning + info icon,
// big value, divider, footnote). `rows` gives the two-value variant (e.g. PPC Sales & Ad Spend).
/** Thin proportion bar: `pct` of the track filled in `color`, with a label under each end. */
export const MiniBar = ({ pct, color, leftLabel, rightLabel }) => {
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="w-full">
      <div className="h-[8px] rounded-full overflow-hidden" style={{ background: COLORS.border }}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
      {(leftLabel || rightLabel) && (
        <div className="flex items-center justify-between gap-2 mt-1.5 text-xs" style={{ color: COLORS.textMuted }}>
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
};

const DashboardCard = ({ label, meaning, tooltip, value, valueColor, rows, footnote, visual }) => (
  <div className="rounded-2xl border p-5 flex flex-col gap-2.5" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
    <div className="flex items-start gap-2 min-h-[32px]">
      <div>
        <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: COLORS.textSecondary }}>{label}</div>
        {meaning && <div className="text-xs mt-0.5" style={{ color: COLORS.textMuted }}>{meaning}</div>}
      </div>
      {tooltip && <div className="ml-auto"><InfoTooltip text={tooltip} position="right" /></div>}
    </div>
    {rows ? (
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <React.Fragment key={row.label}>
            {i > 0 && <div className="h-px" style={{ background: COLORS.border }} />}
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>{row.label}</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums" style={{ color: row.color || COLORS.textPrimary }}>{row.value}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    ) : (
      <div className="text-2xl font-bold tracking-tight tabular-nums" style={{ color: valueColor || COLORS.textPrimary }}>{value}</div>
    )}
    {visual}
    {footnote && (
      <>
        <div className="h-px" style={{ background: COLORS.border }} />
        <div className="text-sm" style={{ color: COLORS.textMuted }}>{footnote}</div>
      </>
    )}
  </div>
);

const MEANINGS = {
  ROAS: 'Return on ad spend',
  'Units from Ads': 'Units sold through your ads',
  Impressions: 'Times your ads were shown',
  Clicks: 'Shoppers who clicked your ads',
  CTR: 'Clicks as % of impressions',
  CPC: 'Average cost per click',
};

const DashboardLayout = ({ kpiData, loading, groupLabels }) => {
  const byLabel = (list, label) => list.find((k) => k.label === label) || {};
  const sales = byLabel(kpiData.primary, 'PPC Sales');
  const spend = byLabel(kpiData.primary, 'Ad Spend');
  const acos = byLabel(kpiData.primary, 'ACoS');
  const tacos = byLabel(kpiData.primary, 'TACoS');
  const roas = byLabel(kpiData.primary, 'ROAS');
  const units = byLabel(kpiData.primary, 'Units from Ads');
  const hasWaste = kpiData.wastedSpend > 0;
  const gridClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4';

  if (loading) {
    return (
      <div className={gridClass}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="rounded-2xl border h-[150px] animate-pulse" style={{ background: COLORS.surface, borderColor: COLORS.border }} aria-hidden />
        ))}
      </div>
    );
  }

  return (
    <>
      {groupLabels && <GroupLabel>Spend &amp; returns</GroupLabel>}
      <div className={gridClass}>
        <DashboardCard
          label="PPC Sales & Ad Spend"
          meaning="What ads earned vs. what they cost"
          rows={[{ label: 'PPC Sales', value: sales.value }, { label: 'Ad Spend', value: spend.value }]}
          footnote={[sales.caption, kpiData.notes.salesVsSpend].filter(Boolean).join(' · ') || undefined}
        />
        <DashboardCard
          label="ACoS & TACoS"
          meaning="Ad cost as a share of sales"
          tooltip={`${acos.tooltip} ${tacos.tooltip}`}
          rows={[
            { label: 'ACoS', value: acos.value, color: acos.valueColor },
            { label: 'TACoS', value: tacos.value, color: tacos.valueColor },
          ]}
          footnote={kpiData.notes.acos || acos.caption}
        />
        <DashboardCard
          label="ROAS"
          meaning={MEANINGS.ROAS}
          tooltip={roas.tooltip}
          value={roas.value}
          valueColor={roas.valueColor}
          visual={kpiData.spend > 0 ? (
            <MiniBar
              pct={(kpiData.roas / 4) * 100}
              color={kpiData.roas >= 4 ? COLORS.good : kpiData.roas >= 1 ? COLORS.watch : '#F87171'}
              leftLabel="0x"
              rightLabel="4x healthy mark"
            />
          ) : null}
          footnote={kpiData.notes.roas || roas.caption}
        />
        <DashboardCard
          label="Wasted Ad Spend"
          meaning="Spend on keywords that never sold"
          tooltip="Money spent on clicks from keywords and search terms that produced no sales. Fix it by pausing or negating them in Campaign Audit."
          value={kpiData.wastedSpendValue}
          valueColor={hasWaste ? '#F87171' : undefined}
          visual={kpiData.wastedPctOfSpend != null && kpiData.spend > 0 ? (
            <MiniBar
              pct={kpiData.wastedPctOfSpend}
              color="#F87171"
              leftLabel={`${Math.min(100, kpiData.wastedPctOfSpend).toFixed(0)}% wasted`}
              rightLabel={`${Math.max(0, 100 - kpiData.wastedPctOfSpend).toFixed(0)}% working`}
            />
          ) : null}
          footnote={hasWaste
            ? (kpiData.wastedPctOfSpend != null ? `${kpiData.wastedPctOfSpend.toFixed(0)}% of your ad spend` : undefined)
            : 'No wasted spend found for this period.'}
        />
      </div>

      {groupLabels && <div className="mt-5"><GroupLabel>Reach &amp; traffic</GroupLabel></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpiData.mini.map((kpi) => (
          <DashboardCard key={kpi.label} label={kpi.label} meaning={MEANINGS[kpi.label]} value={kpi.value} footnote={kpiData.notes[kpi.label.toLowerCase()]} />
        ))}
        <DashboardCard label="Units from Ads" meaning={MEANINGS['Units from Ads']} value={units.value} footnote={kpiData.notes.units} />
      </div>
    </>
  );
};

/**
 * `variant="dashboard"` renders the Performance-card style with PPC Sales + Ad Spend and
 * ACoS + TACoS merged; the default compact layout is what the Campaign Audit page uses.
 * `groupLabels` adds the small sub-headings (dashboard only).
 */
const CampaignAuditKpis = ({ kpiData, loading, groupLabels = false, variant = 'compact' }) => {
  if (variant === 'dashboard') return <DashboardLayout kpiData={kpiData} loading={loading} groupLabels={groupLabels} />;
  return (
  <>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '10px' }}>
      {loading ? (
        Array.from({ length: 6 }).map((_, index) => (
          <motion.div
            key={`skeleton-${index}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className="transition-all duration-300 h-full flex flex-col"
            style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '14px 16px' }}
            aria-hidden
          >
            <div className="mb-2 flex-shrink-0">
              <SkeletonBar height="0.75rem" width="70%" className="bg-[#21262d]" />
            </div>
            <div className="mt-auto">
              <SkeletonBar height="1.25rem" width="55%" className="bg-[#21262d]" />
            </div>
          </motion.div>
        ))
      ) : (
        kpiData.primary.map((kpi, index) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="transition-all duration-300 h-full flex flex-col"
              style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '14px 16px' }}
            >
              <div className="flex items-center gap-1.5 mb-2 flex-shrink-0">
                {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: COLORS.textMuted }} />}
                <span className="text-[11px] font-semibold uppercase tracking-wide truncate flex-1" style={{ color: COLORS.textSecondary }}>{kpi.label}</span>
                {kpi.tooltip && <InfoTooltip text={kpi.tooltip} />}
              </div>
              <div className="mt-auto">
                <div className="text-[22px] font-bold leading-tight truncate" style={{ color: kpi.valueColor || COLORS.textPrimary }}>{kpi.value}</div>
                {kpi.caption && (
                  <div className="text-xs mt-1.5 truncate" style={{ color: kpi.captionColor || COLORS.textMuted }}>{kpi.caption}</div>
                )}
              </div>
            </motion.div>
          );
        })
      )}
    </div>

    {!loading && (
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '10px' }}>
        {kpiData.mini.map((kpi) => (
          <div
            key={kpi.label}
            className="flex items-baseline justify-between"
            style={{ border: `1px solid ${COLORS.border}`, borderRadius: '10px', background: COLORS.bgBase, padding: '11px 14px' }}
          >
            <span className="text-xs" style={{ color: COLORS.textSecondary }}>{kpi.label}</span>
            <span className="text-[15px] font-semibold" style={{ color: COLORS.textPrimary }}>{kpi.value}</span>
          </div>
        ))}
      </div>
    )}
  </>
  );
};

export default CampaignAuditKpis;
