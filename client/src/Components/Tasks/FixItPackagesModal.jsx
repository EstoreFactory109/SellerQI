import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';
import {
  packageValue,
  paybackDays,
  formatPaybackDays,
  recommendPackageId,
} from '../../utils/taskUrgency.js';
import { trackEvent } from '../../utils/analytics.js';

/**
 * The "Fix it" packages: a seller buys a number of tasks for the eStore Factory
 * team to fix for them. Prices are USD and shown here; the server holds the same list
 * (server/Services/Stripe/fixItPackages.js) and decides what Stripe charges. The Tasks
 * page passes `onPurchase` (Stripe Checkout) plus `purchasing`/`purchaseError`; without
 * `onPurchase` the modal says buying is not available.
 *
 * Given the seller's open tasks, each package shows what its task count could
 * cover (the highest-value open tasks) and how fast that pays back the price.
 *
 * The Trial is a one-time payment; Standard and Accelerated are monthly subscriptions (N tasks
 * every month until cancelled). A seller who already has one (`currentSubscription`) cannot
 * pick a second; the server refuses it too.
 */
export const FIX_IT_PACKAGES = [
  {
    id: 'trial',
    name: 'Trial',
    price: 25,
    tasks: 2,
    billing: 'one_time',
    pace: 'A quick way to see the work first-hand',
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 299,
    tasks: 30,
    billing: 'monthly',
    pace: '1 task per day',
  },
  {
    id: 'accelerated',
    name: 'Accelerated',
    price: 499,
    tasks: 60,
    billing: 'monthly',
    pace: '2 tasks per day',
  },
];

const formatPrice = (n) => `$${n.toLocaleString('en-US')}`;
export const isMonthly = (pkg) => pkg?.billing === 'monthly';

// Prices are USD. Payback compares a price with recovered profit, so it is only
// meaningful when the seller's amounts are in USD too.
const PRICE_CURRENCY = '$';

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(pkg) => void} [props.onPurchase]
 * @param {Array} [props.openTasks] - tasks still to do, with `amount`
 * @param {string} [props.currency] - the marketplace currency symbol for task amounts
 */
const FixItPackagesModal = ({ open, onClose, onPurchase, openTasks, currency = '$', purchasing = false, purchaseError = '', currentSubscription = null }) => {
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState('');

  // A fresh open starts with nothing chosen, so a package picked last time is not
  // one click away from being bought.
  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setNotice('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selected = FIX_IT_PACKAGES.find((p) => p.id === selectedId) || null;
  const hasTasks = Array.isArray(openTasks) && openTasks.length > 0;
  const recommendedId = hasTasks ? recommendPackageId(openTasks.length) : null;

  const subscribed = Boolean(currentSubscription?.live);
  const unavailable = (pkg) => subscribed && isMonthly(pkg);

  const selectPackage = (pkg) => {
    if (unavailable(pkg)) return;
    setSelectedId(pkg.id);
    setNotice('');
    trackEvent('fixit_package_select', { package_id: pkg.id });
  };

  const handlePurchase = () => {
    if (!selected || purchasing) return;
    trackEvent('fixit_purchase_click', { package_id: selected.id, price: selected.price });
    if (onPurchase) {
      onPurchase(selected);
    } else {
      setNotice('Online purchase is not available yet. Please contact support to get started.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fix-it-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: COLORS.surface, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 id="fix-it-title" className="m-0 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>
              Let us fix it for you
            </h2>
            <p className="m-0 mt-1.5 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
              Pick a package and our team will work through your tasks for you.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg border transition-colors flex-shrink-0"
            style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>

        <div role="radiogroup" aria-label="Fix it packages" className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 pt-5">
          {FIX_IT_PACKAGES.map((pkg) => {
            const isOn = pkg.id === selectedId;
            const isRecommended = pkg.id === recommendedId;
            const value = hasTasks ? packageValue(openTasks, pkg.tasks) : null;
            const payback = value && currency === PRICE_CURRENCY
              ? formatPaybackDays(paybackDays(pkg.price, value.monthlyValue))
              : null;
            return (
              <button
                key={pkg.id}
                type="button"
                role="radio"
                aria-checked={isOn}
                aria-disabled={unavailable(pkg) || undefined}
                onClick={() => selectPackage(pkg)}
                className="relative text-left rounded-xl border px-4 py-4 transition-colors"
                style={{
                  borderColor: isOn ? COLORS.accent : COLORS.border,
                  background: isOn ? 'rgba(59,130,246,.10)' : COLORS.bgBase,
                  boxShadow: isOn ? `0 0 0 1px ${COLORS.accent}` : 'none',
                  opacity: unavailable(pkg) ? 0.55 : 1,
                  cursor: unavailable(pkg) ? 'not-allowed' : 'pointer',
                }}
              >
                {subscribed && currentSubscription.packageId === pkg.id ? (
                  <span
                    className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: COLORS.good, color: '#061021' }}
                  >
                    Your plan
                  </span>
                ) : isRecommended && !unavailable(pkg) && (
                  <span
                    className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: COLORS.accent, color: '#061021' }}
                  >
                    Recommended for your {openTasks.length} {openTasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium" style={{ color: COLORS.textSecondary }}>{pkg.name}</span>
                  <span
                    className="w-[18px] h-[18px] rounded-full border flex items-center justify-center flex-shrink-0"
                    style={{
                      borderColor: isOn ? COLORS.accent : COLORS.borderStrong,
                      background: isOn ? COLORS.accent : 'transparent',
                    }}
                    aria-hidden="true"
                  >
                    {isOn && <Check size={12} color="#061021" strokeWidth={3} />}
                  </span>
                </div>
                <div className="mt-2 text-3xl font-bold tabular-nums leading-9" style={{ color: COLORS.textPrimary }}>
                  <span>{formatPrice(pkg.price)}</span>
                  {isMonthly(pkg) && <span className="text-sm font-medium" style={{ color: COLORS.textSecondary }}>/month</span>}
                </div>
                <div className="mt-1 text-sm font-medium" style={{ color: COLORS.textPrimary }}>
                  {pkg.tasks} tasks{isMonthly(pkg) ? ' a month' : ''}
                </div>
                <div className="mt-0.5 text-[11px] font-medium" style={{ color: isMonthly(pkg) ? COLORS.accent : COLORS.textMuted }}>
                  {isMonthly(pkg) ? 'Billed monthly · cancel anytime' : 'One-time payment'}
                </div>
                <div className="mt-0.5 text-xs" style={{ color: COLORS.textMuted }}>{pkg.pace}</div>
                {value && (
                  <div className="mt-3 pt-3 border-t text-xs leading-5" style={{ borderColor: COLORS.border }}>
                    {value.monthlyValue > 0 ? (
                      <div style={{ color: COLORS.textSecondary }}>
                        Covers your top {value.covered} {value.covered === 1 ? 'task' : 'tasks'}, worth{' '}
                        <span className="font-semibold" style={{ color: COLORS.good }}>
                          ~{formatCurrencyWithLocale(value.monthlyValue, currency, 0)}/mo
                        </span>
                      </div>
                    ) : (
                      <div style={{ color: COLORS.textSecondary }}>
                        Covers your top {value.covered} {value.covered === 1 ? 'task' : 'tasks'}
                      </div>
                    )}
                    {payback && (
                      <div className="font-medium" style={{ color: COLORS.textPrimary }}>
                        Could pay for itself in ~{payback}
                      </div>
                    )}
                    {value.unpriced > 0 && value.monthlyValue > 0 && (
                      <div style={{ color: COLORS.textMuted }}>
                        Includes {value.unpriced} {value.unpriced === 1 ? 'task' : 'tasks'} with no dollar estimate
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="px-6 pt-4 pb-6">
          {hasTasks && (
            <p className="m-0 mb-3 text-[11px]" style={{ color: COLORS.textMuted }}>
              Values are your highest-value open tasks, based on the last 30 days of your data. They are estimates of what fixing could recover, not guarantees.
            </p>
          )}
          {(purchaseError || notice) && (
            <p role="status" className="m-0 mb-3 text-[13px]" style={{ color: COLORS.watch }}>{purchaseError || notice}</p>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="m-0 text-xs" style={{ color: COLORS.textMuted }}>
              {selected
                ? (isMonthly(selected)
                  ? `${selected.name}: ${selected.tasks} tasks a month for ${formatPrice(selected.price)}/month`
                  : `${selected.name}: ${selected.tasks} tasks for ${formatPrice(selected.price)}`)
                : subscribed
                  ? `You're subscribed to ${currentSubscription.packageName}. Manage it at the top of the Tasks page.`
                  : 'Select a package to continue.'}
              {onPurchase && selected && ' · Secure payment by Stripe'}
            </p>
            <button
              type="button"
              onClick={handlePurchase}
              disabled={!selected || purchasing}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: COLORS.accent, color: '#061021' }}
            >
              {purchasing
                ? 'Redirecting to secure checkout…'
                : selected
                  ? (isMonthly(selected) ? `Subscribe for ${formatPrice(selected.price)}/month` : `Purchase for ${formatPrice(selected.price)}`)
                  : 'Purchase'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default FixItPackagesModal;
