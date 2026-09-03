import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Loader2, AlertCircle, Calendar } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { COLORS, TYPOGRAPHY } from '../../Components/Shared/tokens.js';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';

/** Preset windows. `days` is inclusive and always ends yesterday. */
const PRESETS = [
  { key: 'last7', label: 'Last 7 days', days: 7 },
  { key: 'last30', label: 'Last 30 days', days: 30 },
  { key: 'last90', label: 'Last 90 days', days: 90 },
];

const toYmd = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

/** The window for a preset: `days` long, ending yesterday. */
const presetRange = (days) => {
  const yesterday = addDays(new Date(`${toYmd(new Date())}T00:00:00.000Z`), -1);
  return { startDate: toYmd(addDays(yesterday, -(days - 1))), endDate: toYmd(yesterday) };
};

const formatDayLabel = (ymd) => {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

/**
 * Delta pill. Sales-type metrics are "up is good"; cost-type metrics (ACOS,
 * TACOS, ad spend) are "up is bad", so the colour is inverted for those.
 */
const DeltaBadge = ({ delta, invert = false, unit = 'percent' }) => {
  if (!delta) return null;

  const raw = unit === 'points' ? delta.points : delta.percent;
  if (raw === null || raw === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: COLORS.textMuted }}>
        <Minus className="w-3 h-3" />
        no prior data
      </span>
    );
  }

  const isFlat = Math.abs(raw) < 0.005;
  const isUp = raw > 0;
  const isGood = isFlat ? null : (invert ? !isUp : isUp);
  const color = isFlat ? COLORS.textMuted : isGood ? COLORS.good : COLORS.fix;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const text = unit === 'points'
    ? `${isUp ? '+' : ''}${raw.toFixed(2)} pt`
    : `${isUp ? '+' : ''}${raw.toFixed(2)}%`;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon className="w-3 h-3" />
      {text}
      <span style={{ color: COLORS.textMuted }} className="font-normal">vs prev</span>
    </span>
  );
};

const KpiCard = ({ label, value, delta, invert, unit, hint }) => (
  <div
    className="rounded-xl p-4 border"
    style={{ background: COLORS.surface, borderColor: COLORS.border }}
  >
    <p className={TYPOGRAPHY.cardLabel} style={{ color: COLORS.textSecondary }}>{label}</p>
    <p className={`${TYPOGRAPHY.kpiValue} mt-1.5`} style={{ color: COLORS.textPrimary }}>{value}</p>
    <div className="mt-1.5">
      <DeltaBadge delta={delta} invert={invert} unit={unit} />
    </div>
    {hint && <p className="mt-1 text-[11px]" style={{ color: COLORS.textMuted }}>{hint}</p>}
  </div>
);

const ClientDashboard = () => {
  const navigate = useNavigate();
  const user = useSelector((state) => state.Auth?.user);
  const currency = useSelector((state) => state.currency?.currency) || '$';

  const [preset, setPreset] = useState('last30');
  const [customRange, setCustomRange] = useState({ startDate: '', endDate: '' });
  const [range, setRange] = useState(() => presetRange(30));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('sales');

  const fetchData = useCallback(async (window) => {
    try {
      setLoading(true);
      setError('');
      const res = await axiosInstance.get('/api/pagewise/esf/client-dashboard', {
        params: { startDate: window.startDate, endDate: window.endDate },
      });
      if (res.data?.statusCode === 200 && res.data?.data) {
        setData(res.data.data);
      } else {
        setError(res.data?.message || 'Failed to load dashboard data');
      }
    } catch (err) {
      // 403 = this account is not an ESF client; the page should not exist for them.
      if (err.response?.status === 403) {
        navigate('/seller-central-checker/dashboard', { replace: true });
        return;
      }
      setError(err.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const applyPreset = (key) => {
    const found = PRESETS.find((p) => p.key === key);
    if (!found) return;
    setPreset(key);
    setRange(presetRange(found.days));
  };

  const applyCustom = () => {
    if (!customRange.startDate || !customRange.endDate) return;
    if (customRange.startDate > customRange.endDate) {
      setError('Start date must be before end date.');
      return;
    }
    setPreset('custom');
    setRange({ startDate: customRange.startDate, endDate: customRange.endDate });
  };

  const money = (value) => formatCurrencyWithLocale(Number(value || 0), currency);

  const chartData = useMemo(() => {
    if (!data?.timeseries) return [];
    return data.timeseries.map((row) => ({ ...row, label: formatDayLabel(row.date) }));
  }, [data]);

  const current = data?.current;
  const previous = data?.previous;
  const deltas = data?.deltas;

  const chartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ background: COLORS.surfaceElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
      >
        <p className="font-semibold mb-1">{label}</p>
        {payload.map((entry) => (
          <p key={entry.dataKey} style={{ color: entry.color }} className="tabular-nums">
            {entry.name}: {entry.dataKey === 'acos' || entry.dataKey === 'tacos'
              ? formatPercent(entry.value)
              : money(entry.value)}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full min-h-full p-4 md:p-6" style={{ background: COLORS.bgBase }}>
      <div className="max-w-[1600px] mx-auto w-full">
        {/* Header + range controls */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-6">
          <div>
            <h1 className={TYPOGRAPHY.pageTitle} style={{ color: COLORS.textPrimary }}>
              Client Dashboard
            </h1>
            <p className="mt-1 text-sm" style={{ color: COLORS.textSecondary }}>
              {user?.firstName ? `${user.firstName} ${user.lastName || ''} — ` : ''}
              Total sales, PPC sales and ACOS over time
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
                style={{
                  background: preset === p.key ? COLORS.accent : COLORS.surface,
                  borderColor: preset === p.key ? COLORS.accent : COLORS.border,
                  color: preset === p.key ? '#fff' : COLORS.textSecondary,
                }}
              >
                {p.label}
              </button>
            ))}

            <div
              className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
              style={{ background: COLORS.surface, borderColor: preset === 'custom' ? COLORS.accent : COLORS.border }}
            >
              <Calendar className="w-4 h-4 shrink-0" style={{ color: COLORS.textMuted }} />
              <input
                type="date"
                value={customRange.startDate}
                max={customRange.endDate || undefined}
                onChange={(e) => setCustomRange((r) => ({ ...r, startDate: e.target.value }))}
                className="bg-transparent text-xs outline-none"
                style={{ color: COLORS.textPrimary, colorScheme: 'dark' }}
                aria-label="Custom start date"
              />
              <span style={{ color: COLORS.textMuted }} className="text-xs">to</span>
              <input
                type="date"
                value={customRange.endDate}
                min={customRange.startDate || undefined}
                onChange={(e) => setCustomRange((r) => ({ ...r, endDate: e.target.value }))}
                className="bg-transparent text-xs outline-none"
                style={{ color: COLORS.textPrimary, colorScheme: 'dark' }}
                aria-label="Custom end date"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customRange.startDate || !customRange.endDate}
                className="px-2.5 py-1 rounded-md text-xs font-semibold disabled:opacity-40"
                style={{ background: COLORS.accent, color: '#fff' }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>

        {/* Comparison caption — always says exactly what is being compared */}
        {data && (
          <p className="mb-4 text-xs" style={{ color: COLORS.textMuted }}>
            Showing <span style={{ color: COLORS.textSecondary }}>{data.range.startDate} → {data.range.endDate}</span>
            {' '}({data.range.days} days), compared with{' '}
            <span style={{ color: COLORS.textSecondary }}>{data.compareRange.startDate} → {data.compareRange.endDate}</span>
          </p>
        )}

        {error && (
          <div
            className="rounded-xl border p-4 mb-6 flex items-start gap-2"
            style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: COLORS.fix }} />
            <div>
              <p className="text-sm font-medium" style={{ color: COLORS.fix }}>{error}</p>
              <button
                onClick={() => fetchData(range)}
                className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: COLORS.fix, color: '#fff' }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div
            className="flex items-center justify-center rounded-xl border py-20"
            style={{ background: COLORS.surface, borderColor: COLORS.border }}
          >
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: COLORS.accent }} />
            <p className="ml-3 text-sm" style={{ color: COLORS.textSecondary }}>Loading client dashboard…</p>
          </div>
        )}

        {!loading && !error && current && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <KpiCard
                label="Total Sales"
                value={money(current.totalSales)}
                delta={deltas?.totalSales}
                hint={`Previous: ${money(previous?.totalSales)}`}
              />
              <KpiCard
                label="PPC Sales"
                value={money(current.ppcSales)}
                delta={deltas?.ppcSales}
                hint={`Previous: ${money(previous?.ppcSales)}`}
              />
              <KpiCard
                label="ACOS"
                value={formatPercent(current.acos)}
                delta={deltas?.acos}
                unit="points"
                invert
                hint={`Ad spend ÷ PPC sales · prev ${formatPercent(previous?.acos)}`}
              />
              <KpiCard
                label="TACOS"
                value={formatPercent(current.tacos)}
                delta={deltas?.tacos}
                unit="points"
                invert
                hint={`Ad spend ÷ total sales · prev ${formatPercent(previous?.tacos)}`}
              />
            </div>

            {/* Chart */}
            <div
              className="rounded-xl border mb-6 overflow-hidden"
              style={{ background: COLORS.surface, borderColor: COLORS.border }}
            >
              <div
                className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap"
                style={{ borderColor: COLORS.border }}
              >
                <h2 className={TYPOGRAPHY.sectionTitle} style={{ color: COLORS.textPrimary }}>
                  Performance over time
                </h2>
                <div className="flex items-center gap-1">
                  {[
                    { key: 'sales', label: 'Sales' },
                    { key: 'acos', label: 'ACOS' },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{
                        background: tab === t.key ? COLORS.surfaceElevated : 'transparent',
                        color: tab === t.key ? COLORS.textPrimary : COLORS.textMuted,
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4" style={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="esfTotalSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: COLORS.textMuted, fontSize: 11 }}
                      stroke={COLORS.border}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: COLORS.textMuted, fontSize: 11 }}
                      stroke={COLORS.border}
                      width={64}
                      tickFormatter={(v) => (tab === 'acos' ? `${v}%` : `${currency}${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`)}
                    />
                    <Tooltip content={chartTooltip} />
                    <Legend wrapperStyle={{ fontSize: 12, color: COLORS.textSecondary }} />

                    {tab === 'sales' ? (
                      <>
                        <Area
                          type="monotone"
                          dataKey="totalSales"
                          name="Total Sales"
                          stroke={COLORS.accent}
                          fill="url(#esfTotalSales)"
                          strokeWidth={2}
                        />
                        <Line
                          type="monotone"
                          dataKey="ppcSales"
                          name="PPC Sales"
                          stroke={COLORS.good}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="adSpend"
                          name="Ad Spend"
                          stroke={COLORS.watch}
                          strokeWidth={2}
                          dot={false}
                        />
                      </>
                    ) : (
                      <>
                        <Line
                          type="monotone"
                          dataKey="acos"
                          name="ACOS"
                          stroke={COLORS.fix}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="tacos"
                          name="TACOS"
                          stroke={COLORS.setup}
                          strokeWidth={2}
                          dot={false}
                        />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Period comparison table */}
            <div
              className="rounded-xl border mb-6 overflow-hidden"
              style={{ background: COLORS.surface, borderColor: COLORS.border }}
            >
              <div className="px-4 py-3 border-b" style={{ borderColor: COLORS.border }}>
                <h2 className={TYPOGRAPHY.sectionTitle} style={{ color: COLORS.textPrimary }}>
                  Period comparison
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr style={{ background: COLORS.bgBase }}>
                      {['Metric', 'Selected period', 'Previous period', 'Change'].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}
                          style={{ color: COLORS.textSecondary }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Total Sales', cur: money(current.totalSales), prev: money(previous?.totalSales), delta: deltas?.totalSales, unit: 'percent', invert: false },
                      { label: 'PPC Sales', cur: money(current.ppcSales), prev: money(previous?.ppcSales), delta: deltas?.ppcSales, unit: 'percent', invert: false },
                      { label: 'Ad Spend', cur: money(current.adSpend), prev: money(previous?.adSpend), delta: deltas?.adSpend, unit: 'percent', invert: true },
                      { label: 'ACOS', cur: formatPercent(current.acos), prev: formatPercent(previous?.acos), delta: deltas?.acos, unit: 'points', invert: true },
                      { label: 'TACOS', cur: formatPercent(current.tacos), prev: formatPercent(previous?.tacos), delta: deltas?.tacos, unit: 'points', invert: true },
                      { label: 'Units Sold', cur: (current.unitsSold || 0).toLocaleString(), prev: (previous?.unitsSold || 0).toLocaleString(), delta: deltas?.unitsSold, unit: 'percent', invert: false },
                    ].map((row) => (
                      <tr key={row.label} className="border-t" style={{ borderColor: COLORS.border }}>
                        <td className="px-4 py-2.5 text-sm font-medium" style={{ color: COLORS.textPrimary }}>{row.label}</td>
                        <td className="px-4 py-2.5 text-sm text-right tabular-nums" style={{ color: COLORS.textPrimary }}>{row.cur}</td>
                        <td className="px-4 py-2.5 text-sm text-right tabular-nums" style={{ color: COLORS.textSecondary }}>{row.prev}</td>
                        <td className="px-4 py-2.5 text-right">
                          <DeltaBadge delta={row.delta} unit={row.unit} invert={row.invert} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Daily breakdown table */}
            <div
              className="rounded-xl border overflow-hidden"
              style={{ background: COLORS.surface, borderColor: COLORS.border }}
            >
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: COLORS.border }}>
                <h2 className={TYPOGRAPHY.sectionTitle} style={{ color: COLORS.textPrimary }}>
                  Daily breakdown
                </h2>
                <span className="text-xs" style={{ color: COLORS.textMuted }}>
                  {chartData.length} days
                </span>
              </div>
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="sticky top-0" style={{ background: COLORS.bgBase }}>
                    <tr>
                      {['Date', 'Total Sales', 'PPC Sales', 'Ad Spend', 'ACOS', 'TACOS', 'Units'].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}
                          style={{ color: COLORS.textSecondary }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row) => (
                      <tr key={row.date} className="border-t" style={{ borderColor: COLORS.border }}>
                        <td className="px-4 py-2 text-sm" style={{ color: COLORS.textPrimary }}>{row.label}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums" style={{ color: COLORS.textPrimary }}>{money(row.totalSales)}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums" style={{ color: COLORS.textSecondary }}>{money(row.ppcSales)}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums" style={{ color: COLORS.textSecondary }}>{money(row.adSpend)}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums" style={{ color: COLORS.textSecondary }}>{formatPercent(row.acos)}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums" style={{ color: COLORS.textSecondary }}>{formatPercent(row.tacos)}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums" style={{ color: COLORS.textSecondary }}>{(row.unitsSold || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                    {chartData.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: COLORS.textMuted }}>
                          No data for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ClientDashboard;
