import React, { useCallback, useEffect, useState } from 'react';
import { COLORS } from '../../Shared/index.js';
import axiosInstance from '../../../config/axios.config.js';
import { useChangeRequest } from '../../Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../../hooks/useActionCapabilities.js';

/**
 * "Live updates from Amazon": which events Amazon sends SellerQI as they happen.
 * Turning one on or off is a change on the seller's Amazon account, so it is
 * approved in the approval window like any other. Hidden until switched on.
 */
const LiveUpdatesPanel = () => {
  const { can } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [state, setState] = useState(null);
  const enabled = can('notifications.create_subscription');

  const load = useCallback(() => {
    axiosInstance.get('/api/actions/notifications/subscriptions')
      .then((res) => setState(res.data?.data || null))
      .catch(() => setState(null));
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled || !state) return null;
  const toggle = async (t) => {
    const outcome = await requestChange({
      feature: 'notifications',
      actionType: t.on ? 'notifications.delete_subscription' : 'notifications.create_subscription',
      input: { notificationType: t.type },
    });
    if (outcome?.status === 'succeeded') load();
  };

  return (
    <section className="mt-6 rounded-2xl border" style={{ background: COLORS.surface, borderColor: COLORS.border }} aria-labelledby="live-updates-title">
      {changeModal}
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 id="live-updates-title" className="m-0 text-base font-semibold" style={{ color: COLORS.textPrimary }}>Live updates from Amazon</h2>
        <p className="m-0 mt-1 text-sm" style={{ color: COLORS.textSecondary }}>Amazon tells SellerQI as soon as these happen, instead of SellerQI finding out on its next scheduled read.</p>
      </div>
      {!state.available && <p className="m-0 px-5 py-4 text-sm" style={{ color: COLORS.textSecondary }}>Not set up for this region yet.</p>}
      {state.available && (
        <ul className="m-0 p-0 list-none">
          {state.types.map((t) => (
            <li key={t.type} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm" style={{ borderTop: `1px solid ${COLORS.border}` }}>
              <span className="flex-1 min-w-0" style={{ color: COLORS.textPrimary }}>{t.label}</span>
              {t.lastEventAt && <span className="text-xs" style={{ color: COLORS.textMuted }}>last {new Date(t.lastEventAt).toLocaleString()}</span>}
              <span className="text-xs font-semibold" style={{ color: t.on ? COLORS.good : COLORS.textSecondary }}>{t.on ? 'On' : 'Off'}</span>
              <button type="button" onClick={() => toggle(t)} className="px-3 py-1.5 rounded-lg text-xs border" style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}>
                {t.on ? 'Turn off' : 'Turn on'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default LiveUpdatesPanel;
