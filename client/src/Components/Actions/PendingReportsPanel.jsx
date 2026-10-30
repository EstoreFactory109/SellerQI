import React, { useCallback, useEffect, useState } from 'react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { useChangeRequest } from './ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';

/**
 * For the SellerQI team only: this account's report requests still waiting at
 * Amazon, with Cancel for one that has not started (a stuck sync). Hidden for
 * sellers (reports.cancel_report is staff-only on the server).
 */
const PendingReportsPanel = () => {
  const { can } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [reports, setReports] = useState(null);
  const allowed = can('reports.cancel_report');

  const load = useCallback(() => {
    axiosInstance.get('/api/actions/reports/pending')
      .then((res) => setReports(res.data?.data?.reports || []))
      .catch(() => setReports([]));
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed || !reports || reports.length === 0) return null;
  return (
    <section className="rounded-xl border mb-4" style={{ background: COLORS.surface, borderColor: COLORS.border }} aria-label="Pending Amazon reports">
      {changeModal}
      <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 className="m-0 text-sm font-semibold" style={{ color: COLORS.textPrimary }}>Amazon reports still waiting (SellerQI team only)</h2>
      </div>
      <ul className="m-0 p-0 list-none">
        {reports.map((r) => (
          <li key={r.reportId} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm" style={{ borderTop: `1px solid ${COLORS.border}` }}>
            <span className="flex-1 min-w-0" style={{ color: COLORS.textPrimary }}>{r.reportType}</span>
            <span className="text-xs" style={{ color: COLORS.textMuted }}>{r.status === 'IN_QUEUE' ? 'Waiting' : 'Running'} since {new Date(r.createdTime).toLocaleString()}</span>
            {r.status === 'IN_QUEUE' && (
              <button type="button" onClick={async () => { await requestChange({ feature: 'reports', actionType: 'reports.cancel_report', input: { reportId: r.reportId } }); load(); }} className="px-2.5 py-1 rounded-lg text-xs border" style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}>Cancel</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default PendingReportsPanel;
