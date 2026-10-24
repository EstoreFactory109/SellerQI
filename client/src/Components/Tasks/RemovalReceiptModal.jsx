import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { trackEvent } from '../../utils/analytics.js';

/**
 * "Confirm what arrived" for FBA removal orders.
 *
 * Amazon's removal report only says what it shipped back; units lost on the way
 * still count as shipped, so the seller is the only one who knows a shortfall
 * happened. Lists the returned order lines still waiting for an answer (the same
 * lines the removal_confirm_receipt task counted) with "received" pre-filled to
 * what Amazon shipped, so a seller who got everything just confirms. A lower
 * number becomes a claim task on the next data refresh.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(result: {saved: number, short: number}) => void} [props.onConfirmed]
 */
const keyOf = (line) => `${line.orderId}\u0000${line.sku}`;

const isWholeInRange = (raw, max) => {
  if (raw === '' || raw === null || raw === undefined) return false;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= max;
};

const shortDate = (value) => {
  const t = Date.parse(value || '');
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
};

const RemovalReceiptModal = ({ open, onClose, onConfirmed }) => {
  const [lines, setLines] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setResult(null);
    axiosInstance.get('/api/removal-receipts/pending', { withCredentials: true })
      .then((res) => {
        if (cancelled) return;
        const data = Array.isArray(res.data?.data) ? res.data.data : [];
        setLines(data);
        setValues(Object.fromEntries(data.map((l) => [keyOf(l), String(l.shippedQuantity)])));
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || 'Could not load your removal orders. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const invalidKeys = useMemo(
    () => new Set(lines.filter((l) => !isWholeInRange(values[keyOf(l)], l.shippedQuantity)).map(keyOf)),
    [lines, values]
  );
  const missingUnits = useMemo(
    () => lines.reduce((sum, l) => {
      const v = values[keyOf(l)];
      return isWholeInRange(v, l.shippedQuantity) ? sum + (l.shippedQuantity - Number(v)) : sum;
    }, 0),
    [lines, values]
  );

  if (!open) return null;

  const submit = async () => {
    if (invalidKeys.size > 0 || lines.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const entries = lines.map((l) => ({ orderId: l.orderId, sku: l.sku, receivedQuantity: Number(values[keyOf(l)]) }));
      const res = await axiosInstance.post('/api/removal-receipts/confirm', { entries }, { withCredentials: true });
      const data = res.data?.data || { saved: 0, rejected: [] };
      const short = lines.filter((l) => Number(values[keyOf(l)]) < l.shippedQuantity).length;
      setResult({ saved: data.saved, rejected: data.rejected || [], short, missingUnits });
      trackEvent('removal_receipts_confirm', { lines: lines.length, saved: data.saved, short_lines: short });
      if (data.saved > 0 && (data.rejected || []).length === 0) onConfirmed?.({ saved: data.saved, short });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="removal-receipt-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: COLORS.surface, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 id="removal-receipt-title" className="m-0 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>
              Confirm what arrived
            </h2>
            <p className="m-0 mt-1.5 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
              Amazon's report only shows what it shipped back to you. Enter how many units actually arrived. If any are missing, we'll add a task to claim them from Amazon.
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

        <div className="px-6 pt-5">
          {loading && (
            <p className="m-0 text-sm" style={{ color: COLORS.textMuted }}>Loading your removal orders…</p>
          )}

          {!loading && !error && lines.length === 0 && !result && (
            <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>
              Nothing left to confirm. Every returned removal order from the last 60 days has an answer.
            </p>
          )}

          {!loading && lines.length > 0 && !result && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: COLORS.border }}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ background: COLORS.bgBase, color: COLORS.textMuted }}>
                    <th className="text-left font-medium px-3 py-2">Removal order</th>
                    <th className="text-left font-medium px-3 py-2">Product</th>
                    <th className="text-right font-medium px-3 py-2">Shipped</th>
                    <th className="text-right font-medium px-3 py-2">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const k = keyOf(l);
                    const bad = invalidKeys.has(k);
                    return (
                      <tr key={k} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <td className="px-3 py-2 align-top" style={{ color: COLORS.textPrimary }}>
                          <div className="tabular-nums">{l.orderId}</div>
                          <div className="text-[11px]" style={{ color: COLORS.textMuted }}>
                            {shortDate(l.lastUpdatedDate || l.requestDate)}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top" style={{ color: COLORS.textSecondary }}>
                          <div className="truncate max-w-[220px]" title={l.productName || l.sku}>{l.productName || l.sku}</div>
                          <div className="text-[11px]" style={{ color: COLORS.textMuted }}>SKU {l.sku}{l.asin ? ` · ${l.asin}` : ''}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums" style={{ color: COLORS.textPrimary }}>
                          {l.shippedQuantity}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={l.shippedQuantity}
                            step={1}
                            aria-label={`Units received for order ${l.orderId}, SKU ${l.sku}`}
                            value={values[k] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            className="w-20 px-2 py-1 rounded-md border text-right tabular-nums"
                            style={{
                              background: COLORS.bgBase,
                              color: COLORS.textPrimary,
                              borderColor: bad ? COLORS.fix : COLORS.border
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result && (
            <div role="status" className="text-sm" style={{ color: COLORS.textPrimary }}>
              <p className="m-0">
                Saved {result.saved} {result.saved === 1 ? 'line' : 'lines'}.
                {result.short > 0
                  ? ` ${result.missingUnits} ${result.missingUnits === 1 ? 'unit is' : 'units are'} missing: a task to claim ${result.missingUnits === 1 ? 'it' : 'them'} from Amazon will appear after your next data refresh.`
                  : ' Everything arrived, so there is nothing to claim.'}
              </p>
              {result.rejected.length > 0 && (
                <ul className="m-0 mt-2 pl-5 text-[13px]" style={{ color: COLORS.watch }}>
                  {result.rejected.map((r) => (
                    <li key={`${r.orderId}-${r.sku}`}>Order {r.orderId}, SKU {r.sku}: {r.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="m-0 mt-3 text-[13px]" style={{ color: COLORS.watch }}>{error}</p>
          )}
        </div>

        <div className="px-6 pt-4 pb-6 flex items-center justify-between gap-3 flex-wrap">
          <p className="m-0 text-xs" style={{ color: COLORS.textMuted }}>
            {!result && lines.length > 0
              ? (invalidKeys.size > 0
                ? 'Each "Received" must be a whole number from 0 to what was shipped.'
                : missingUnits > 0
                  ? `${missingUnits} ${missingUnits === 1 ? 'unit' : 'units'} will be marked as missing.`
                  : 'Everything shipped is marked as received.')
              : ''}
          </p>
          {result || lines.length === 0 ? (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}
            >
              Close
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={saving || loading || invalidKeys.size > 0}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: COLORS.accent, color: '#061021' }}
            >
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default RemovalReceiptModal;
