import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Wrench, TrendingDown, ArrowRight } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';
import { daysLeftInMonth, lossOverSeconds, packageValue } from '../../utils/taskUrgency.js';

const MAX_LEAKS = 3;
const MAX_RISK_LABELS = 3;
const TRIAL_PRICE = 25;
const TRIAL_TASKS = 2;
// Below this the live counter barely moves and reads as noise, not urgency.
const TICKER_MIN_PER_HOUR = 1;

const RED = COLORS.fix;
const AMBER = COLORS.watch;

const fmt = (n, currency, decimals = 0) => formatCurrencyWithLocale(n, currency, decimals);

/**
 * Money lost at the account's current rate since the page opened, ticking once a
 * second. It is the measured monthly figure spread over time, labelled as such.
 */
function LiveLossCounter({ monthly, currency }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds((Date.now() - started) / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
      style={{ background: 'rgba(239,68,68,.12)', color: '#FCA5A5' }}
      data-testid="live-loss"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: RED }} />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: RED }} />
      </span>
      <span>
        ≈ <strong className="tabular-nums" style={{ color: '#FEE2E2' }}>{fmt(lossOverSeconds(monthly, seconds), currency, 2)}</strong>{' '}
        lost since you opened this page
      </span>
    </div>
  );
}

/**
 * The single "Fix it" card at the top of the Tasks page: what the open tasks are
 * costing, what threatens the account, and the way out. All figures come from the
 * seller's own open tasks (utils/taskUrgency.js); nothing is invented.
 *
 * @param {Object} props
 * @param {Object} props.urgency - summarizeUrgency() result
 * @param {Array} props.openTasks
 * @param {number} props.totalTasks - every task for the marketplace, any status
 * @param {string} props.currency - marketplace currency symbol
 * @param {(source: string) => void} [props.onFix] Without it there is no "Fix it now" button
 *   and no price line — the Fix it packages are switched off (VITE_FIX_IT_PACKAGES).
 */
const FixItUrgencyCard = ({ urgency, openTasks = [], totalTasks = 0, currency = '$', onFix }) => {
  const hasMoney = urgency.monthlyRecoverable > 0;
  const risks = urgency.accountRisks || [];
  const hasRisk = risks.length > 0;
  const hasOpen = urgency.openCount > 0;
  const severe = hasMoney || hasRisk;
  const tone = severe ? RED : AMBER;

  if (totalTasks === 0 || !hasOpen) {
    return (
      <div className="rounded-2xl border px-5 py-[18px] mb-3 flex items-center justify-between gap-4"
        style={{ background: COLORS.surface, borderColor: COLORS.border }}>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: COLORS.textPrimary }} data-testid="urgency-headline">
            {totalTasks === 0 ? 'No tasks yet' : 'Every task is done — nice work.'}
          </div>
          <div className="mt-1 text-xs" style={{ color: COLORS.textMuted }}>
            {totalTasks === 0
              ? 'Tasks are generated from the issues we find on your account.'
              : 'New issues will appear here as soon as we find them.'}
          </div>
        </div>
        <TotalTasks totalTasks={totalTasks} />
      </div>
    );
  }

  const daysLeft = daysLeftInMonth();
  const byMonthEnd = urgency.dailyCost * daysLeft;
  const trial = packageValue(openTasks, TRIAL_TASKS);
  const usd = currency === '$';
  const leaks = (urgency.leaks || []).filter((l) => l.title).slice(0, MAX_LEAKS);
  const riskLabels = [...new Set(risks.map((r) => r.label))];

  return (
    <section
      aria-label="What your open tasks are costing you"
      className="relative rounded-2xl overflow-hidden mb-3 border"
      style={{
        borderColor: severe ? 'rgba(239,68,68,.45)' : 'rgba(245,166,35,.4)',
        background: severe
          ? 'linear-gradient(135deg, rgba(239,68,68,.16) 0%, rgba(21,26,35,1) 45%, rgba(21,26,35,1) 100%)'
          : 'linear-gradient(135deg, rgba(245,166,35,.14) 0%, rgba(21,26,35,1) 50%)',
        boxShadow: severe ? '0 0 0 1px rgba(239,68,68,.08), 0 12px 40px -12px rgba(239,68,68,.35)' : 'none',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${tone}, ${severe ? '#F97316' : '#FBBF24'})` }} />

      <div className="px-5 sm:px-6 pt-6 pb-5 grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
        {/* Left: the loss */}
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
            style={{ background: severe ? 'rgba(239,68,68,.18)' : 'rgba(245,166,35,.18)', color: severe ? '#FCA5A5' : '#FCD34D' }}
          >
            <AlertTriangle size={12} />
            {hasRisk ? 'Action needed — account at risk' : 'Action needed'}
          </span>

          {hasMoney ? (
            <>
              <div className="mt-3 text-sm font-medium" style={{ color: COLORS.textSecondary }}>
                Your open tasks are costing you
              </div>
              <div className="flex items-baseline gap-2 flex-wrap" data-testid="urgency-headline">
                <span className="text-[44px] sm:text-[52px] font-extrabold leading-none tracking-tight tabular-nums" style={{ color: '#F87171' }}>
                  {fmt(urgency.monthlyRecoverable, currency)}
                </span>
                <span className="text-lg font-semibold" style={{ color: COLORS.textPrimary }}>
                  every month{urgency.estimatedShare > 0.5 ? ' (est.)' : ''}
                </span>
              </div>
              <div className="mt-1.5 text-[13px]" style={{ color: COLORS.textSecondary }}>
                across <strong style={{ color: COLORS.textPrimary }}>{urgency.openCount}</strong> open {urgency.openCount === 1 ? 'task' : 'tasks'}, and it keeps going until they&apos;re fixed.
              </div>

              {/* Projection: the same rate over the periods sellers think in. */}
              <div className="mt-4 grid grid-cols-3 gap-2 max-w-[460px]">
                <Stat label="Every day" value={fmt(urgency.dailyCost, currency)} />
                <Stat label={`Rest of this month (${daysLeft}d)`} value={fmt(byMonthEnd, currency)} />
                <Stat label="Over a year" value={fmt(urgency.yearlyRecoverable, currency)} strong />
              </div>

              {urgency.hourlyCost >= TICKER_MIN_PER_HOUR && (
                <div className="mt-3">
                  <LiveLossCounter monthly={urgency.monthlyRecoverable} currency={currency} />
                </div>
              )}

              {urgency.capitalTiedUp > 0 && (
                <div className="mt-3 text-[13px]" style={{ color: COLORS.textSecondary }}>
                  Plus <strong style={{ color: COLORS.textPrimary }}>{fmt(urgency.capitalTiedUp, currency)}</strong> of capital stuck in unsellable stock.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-3 text-[28px] font-extrabold leading-tight" style={{ color: COLORS.textPrimary }} data-testid="urgency-headline">
                <span className="tabular-nums">{urgency.openCount}</span> open {urgency.openCount === 1 ? 'task is' : 'tasks are'} holding back your listings
              </div>
              <div className="mt-1.5 text-[13px]" style={{ color: COLORS.textSecondary }}>
                Every day they stay open, shoppers see a weaker listing than your competitors&apos;.
                {urgency.capitalTiedUp > 0 && <> {fmt(urgency.capitalTiedUp, currency)} of capital is stuck in unsellable stock.</>}
              </div>
            </>
          )}
        </div>

        {/* Right: where it's going, and what threatens the account */}
        <div className="min-w-0 flex flex-col gap-4">
          {leaks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: COLORS.textMuted }}>
                <TrendingDown size={13} /> Where it&apos;s leaking
              </div>
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                {leaks.map((leak) => (
                  <li key={leak.key}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="truncate" style={{ color: COLORS.textPrimary }} title={leak.title}>{leak.title}</span>
                      <span className="font-semibold tabular-nums flex-shrink-0" style={{ color: '#F87171' }}>
                        {fmt(leak.amount, currency)}/mo
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.06)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.round(leak.share * 100))}%`, background: `linear-gradient(90deg, ${RED}, #F97316)` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasRisk && (
            <div
              role="alert"
              className="rounded-xl px-3.5 py-3 border"
              style={{ background: 'rgba(239,68,68,.10)', borderColor: 'rgba(239,68,68,.4)' }}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: '#FEE2E2' }}>
                <ShieldAlert size={16} style={{ color: '#F87171' }} />
                {risks.length} {risks.length === 1 ? 'issue puts' : 'issues put'} your selling account at risk
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {riskLabels.slice(0, MAX_RISK_LABELS).map((label) => (
                  <span key={label} className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: 'rgba(239,68,68,.18)', color: '#FCA5A5' }}>
                    {label}
                  </span>
                ))}
                {riskLabels.length > MAX_RISK_LABELS && (
                  <span className="px-2 py-0.5 text-[11px]" style={{ color: '#FCA5A5' }}>+{riskLabels.length - MAX_RISK_LABELS} more</span>
                )}
              </div>
              <div className="mt-1.5 text-[11px]" style={{ color: '#FCA5A5' }}>
                Left unresolved, issues like these can get a seller account suspended.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CTA strip */}
      <div
        className="px-5 sm:px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-t"
        style={{ borderColor: 'rgba(255,255,255,.06)', background: 'rgba(0,0,0,.18)' }}
      >
        {onFix ? (
        <div className="text-[13px]" style={{ color: COLORS.textSecondary }} data-testid="price-anchor">
          {usd && trial.monthlyValue > 0 ? (
            <>
              Your top {trial.covered} {trial.covered === 1 ? 'task is' : 'tasks are'} worth{' '}
              <strong style={{ color: COLORS.good }}>~{fmt(trial.monthlyValue, currency)}/mo</strong>.{' '}
              Our team will fix {trial.covered === 1 ? 'it' : 'them'} for <strong style={{ color: COLORS.textPrimary }}>${TRIAL_PRICE}</strong>
              {urgency.dailyCost > TRIAL_PRICE ? <> — less than one day of what you&apos;re losing.</> : '.'}
            </>
          ) : (
            <>Hand these to our team and stop the leak. Plans start at <strong style={{ color: COLORS.textPrimary }}>${TRIAL_PRICE}</strong> for {TRIAL_TASKS} tasks.</>
          )}
        </div>
        ) : <span />}
        <div className="flex items-center gap-4 flex-shrink-0">
          <TotalTasks totalTasks={totalTasks} />
          {onFix && (
          <button
            type="button"
            onClick={() => onFix(hasRisk ? 'card_risk' : 'hero')}
            className="group flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[15px] font-bold transition-transform hover:scale-[1.02] active:scale-[.99]"
            style={{
              background: 'linear-gradient(135deg, #EF4444, #F97316)',
              color: '#fff',
              boxShadow: '0 8px 24px -8px rgba(239,68,68,.7)',
            }}
          >
            <Wrench size={17} />
            Fix it now
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          )}
        </div>
      </div>

      {hasMoney && (
        <div className="px-5 sm:px-6 pb-3 text-[11px]" style={{ color: COLORS.textMuted, background: 'rgba(0,0,0,.18)' }}>
          Based on the last 30 days of your data. Amounts are estimates of what fixing could recover, not guarantees; yearly and monthly figures assume nothing changes.
        </div>
      )}
    </section>
  );
};

function Stat({ label, value, strong }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,.22)', border: '1px solid rgba(255,255,255,.05)' }}>
      <div className={`tabular-nums font-bold ${strong ? 'text-[17px]' : 'text-[15px]'}`} style={{ color: strong ? '#F87171' : COLORS.textPrimary }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: COLORS.textMuted }}>{label}</div>
    </div>
  );
}

function TotalTasks({ totalTasks }) {
  return (
    <div className="text-right">
      <div className="text-xl font-bold tabular-nums leading-7" style={{ color: COLORS.textPrimary }} data-testid="total-tasks">
        {totalTasks}
      </div>
      <div className="text-[11px] whitespace-nowrap" style={{ color: COLORS.textMuted }}>
        {totalTasks === 1 ? 'task' : 'tasks'} in total
      </div>
    </div>
  );
}

export default FixItUrgencyCard;
