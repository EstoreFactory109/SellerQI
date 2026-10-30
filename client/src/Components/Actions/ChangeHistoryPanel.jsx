import React, { useCallback, useEffect, useState } from 'react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { useChangeRequest } from './ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';

const STATUS = {
  succeeded: ['Done', COLORS.good],
  awaiting_amazon: ['Amazon is processing', COLORS.watch],
  running: ['Sending', COLORS.watch],
  failed: ['Not changed', COLORS.fix],
  stale: ['Not sent: changed since', COLORS.textSecondary],
  unknown: ['Checking', COLORS.watch],
  cancelled: ['Cancelled', COLORS.textSecondary],
  expired: ['Expired', COLORS.textSecondary],
};

/**
 * Recent changes SellerQI made on Amazon for one area (who, what, when, result),
 * with Cancel for a bulk update Amazon has not started yet. Renders nothing when
 * there are no changes.
 */
const ChangeHistoryPanel = ({ feature, title = 'Recent changes on Amazon', refreshKey = 0 }) => {
  const { can } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [changes, setChanges] = useState([]);

  const load = useCallback(() => {
    axiosInstance.get('/api/actions/history', { params: { feature, limit: 10 } })
      .then((res) => setChanges(res.data?.data?.changes || []))
      .catch(() => setChanges([]));
  }, [feature]);
  useEffect(() => { load(); }, [load, refreshKey]);
  // While Amazon is processing something, check again every 30 s.
  useEffect(() => {
    if (!changes.some((c) => c.status === 'awaiting_amazon')) return undefined;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [changes, load]);

  if (changes.length === 0) return null;
  const cancel = async (c) => {
    const outcome = await requestChange({ feature: 'feeds', actionType: 'feeds.cancel_feed', input: { changeRequestId: c.id } });
    if (outcome?.status !== 'closed') load();
  };

  return (
    <section className="rounded-xl border mb-4" style={{ background: COLORS.surface, borderColor: COLORS.border }} aria-label={title}>
      {changeModal}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 className="m-0 text-sm font-semibold" style={{ color: COLORS.textPrimary }}>{title}</h2>
        <button type="button" onClick={load} className="text-xs" style={{ color: COLORS.accent, background: 'transparent' }}>Refresh</button>
      </div>
      <ul className="m-0 p-0 list-none">
        {changes.map((c) => {
          const [label, color] = STATUS[c.status] || [c.status, COLORS.textSecondary];
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm" style={{ borderTop: `1px solid ${COLORS.border}` }}>
              <span className="text-xs w-36 shrink-0" style={{ color: COLORS.textMuted, fontVariantNumeric: 'tabular-nums' }}>{new Date(c.approvedAt || c.createdAt).toLocaleString()}</span>
              <span className="flex-1 min-w-0" style={{ color: COLORS.textPrimary }}>{c.preview?.title || c.actionType}</span>
              <span className="text-xs font-semibold" style={{ color }}>{label}</span>
              {c.status !== 'succeeded' && c.error && <span className="basis-full text-xs" style={{ color: COLORS.textSecondary }}>{c.error}</span>}
              {c.status === 'succeeded' && c.message && c.message !== 'Done on Amazon.' && <span className="basis-full text-xs" style={{ color: COLORS.textSecondary }}>{c.message}</span>}
              {c.status === 'awaiting_amazon' && c.feature === 'feeds' && c.actionType === 'feeds.bulk_fbm_stock' && can('feeds.cancel_feed') && (
                <button type="button" onClick={() => cancel(c)} className="px-2.5 py-1 rounded-lg text-xs border" style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}>Cancel</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ChangeHistoryPanel;
