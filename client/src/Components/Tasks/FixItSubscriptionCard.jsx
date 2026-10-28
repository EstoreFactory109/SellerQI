import React, { useCallback, useEffect, useState } from 'react';
import { Wrench, Loader2 } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import stripeService from '../../services/stripeService.js';

/**
 * The seller's monthly "Fix it" subscription (Standard / Accelerated): what they pay for, when
 * it renews, and how to stop it. Cancelling ends it after the month already paid for — the
 * team keeps working until then, and the seller can resume before that date.
 *
 * Shown on the Tasks page (where the subscription is bought) and in Plans & Billing.
 */
const formatDay = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Loads the subscription once; `refresh` re-reads it, `setSubscription` takes an updated one. */
export const useFixItSubscription = () => {
  const [subscription, setSubscription] = useState(null);
  const refresh = useCallback(async () => {
    try {
      setSubscription(await stripeService.getFixItSubscription());
    } catch {
      setSubscription(null);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { subscription, setSubscription, refresh };
};

export default function FixItSubscriptionCard({ subscription, onChange }) {
  const [busy, setBusy] = useState(null); // 'cancel' | 'resume' | 'card'
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  if (!subscription?.live) return null;
  const { packageName, tasks, priceUsd, cancelAtPeriodEnd, currentPeriodEnd, status, monthsPaid } = subscription;
  const until = formatDay(currentPeriodEnd);

  const act = async (kind, call) => {
    setBusy(kind);
    setError('');
    try {
      const updated = await call();
      if (updated) onChange?.(updated);
      setConfirming(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const line = status === 'past_due' || status === 'unpaid'
    ? `Your last payment didn't go through. Update your card so the team can keep going.`
    : cancelAtPeriodEnd
      ? `Cancelled — the team keeps working until ${until}, then it stops.`
      : `Renews on ${until} for $${priceUsd}.`;

  return (
    <div
      role="region"
      aria-label="Your Fix it subscription"
      className="mb-3 rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3"
      style={{ borderColor: COLORS.border, background: COLORS.surface }}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59,130,246,.12)' }}>
        <Wrench size={16} style={{ color: COLORS.accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-semibold" style={{ color: COLORS.textPrimary }}>
          Fix it {packageName}: {tasks} tasks a month, ${priceUsd}/month
          {monthsPaid > 0 && <span className="font-normal" style={{ color: COLORS.textMuted }}> · month {monthsPaid}</span>}
        </p>
        <p className="m-0 mt-0.5 text-xs" style={{ color: status === 'past_due' || status === 'unpaid' ? COLORS.watch : COLORS.textSecondary }}>{line}</p>
        {error && <p role="status" className="m-0 mt-1 text-xs" style={{ color: COLORS.fix }}>{error}</p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => act('card', () => stripeService.openFixItBillingPortal())}
          disabled={!!busy}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-50"
          style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}
        >
          {busy === 'card' ? <Loader2 size={14} className="animate-spin" /> : 'Update card'}
        </button>
        {cancelAtPeriodEnd ? (
          <button
            type="button"
            onClick={() => act('resume', () => stripeService.resumeFixItSubscription())}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ background: COLORS.accent, color: '#061021' }}
          >
            {busy === 'resume' ? <Loader2 size={14} className="animate-spin" /> : 'Keep my subscription'}
          </button>
        ) : confirming ? (
          <>
            <span className="text-xs" style={{ color: COLORS.textSecondary }}>Stop after {until}?</span>
            <button
              type="button"
              onClick={() => act('cancel', () => stripeService.cancelFixItSubscription())}
              disabled={!!busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: COLORS.fix, color: '#fff' }}
            >
              {busy === 'cancel' ? <Loader2 size={14} className="animate-spin" /> : 'Yes, cancel'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border"
              style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
            >
              No
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border"
            style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
          >
            Cancel subscription
          </button>
        )}
      </div>
    </div>
  );
}
