import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { trackEvent } from '../../utils/analytics.js';

// The server takes at most this many changes per request (TaskActionService).
const PER_REQUEST = 25;

/**
 * Approve several Amazon changes at once (ad changes only: listing fixes need
 * their own text). Lists every change before anything is sent, then sends them
 * in groups of 25 and shows each result.
 *
 * @param {Object} props
 * @param {Array|null} props.tasks - tasks with a proposedAction, or null when closed
 * @param {() => void} props.onClose
 * @param {(taskId: string) => void} props.onApproved - once per change Amazon accepted
 */
const BulkApproveModal = ({ tasks, onClose, onApproved }) => {
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState(null); // { [taskId]: { status, message } }
  const [error, setError] = useState('');

  useEffect(() => { setSaving(false); setResults(null); setError(''); }, [tasks]);

  if (!tasks || tasks.length === 0) return null;

  const approve = async () => {
    setSaving(true);
    setError('');
    const out = {};
    try {
      for (let i = 0; i < tasks.length; i += PER_REQUEST) {
        const taskIds = tasks.slice(i, i + PER_REQUEST).map((t) => t.taskId);
        const res = await axiosInstance.post('/api/pagewise/tasks/approve-actions', { taskIds }, { withCredentials: true });
        for (const r of res.data?.data?.results || []) {
          out[r.taskId] = r;
          if (r.status === 'succeeded') onApproved?.(r.taskId);
        }
        setResults({ ...out });
      }
      const ok = Object.values(out).filter((r) => r.status === 'succeeded').length;
      trackEvent('task_action_bulk_approve', { count: tasks.length, succeeded: ok });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reach Amazon. Changes not shown as done were not made.');
    } finally {
      setSaving(false);
    }
  };

  const done = !!results && Object.keys(results).length === tasks.length;
  const okCount = results ? Object.values(results).filter((r) => r.status === 'succeeded').length : 0;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="bulk-approve-title" onClick={() => { if (!saving) onClose?.(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: COLORS.surface, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <h2 id="bulk-approve-title" className="m-0 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>
            {done ? `${okCount} of ${tasks.length} changes made on Amazon` : `Approve ${tasks.length} change${tasks.length === 1 ? '' : 's'} on Amazon?`}
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="p-1.5 rounded-lg border flex-shrink-0" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>
            <X size={16} />
          </button>
        </div>
        <ul className="m-0 mt-3 px-6 flex flex-col gap-2 list-none">
          {tasks.map((t) => {
            const r = results?.[t.taskId];
            return (
              <li key={t.taskId} className="text-sm rounded-lg border px-3 py-2" style={{ borderColor: COLORS.border, color: COLORS.textPrimary }}>
                {t.proposedAction.summary}
                {r && (
                  <span className="block mt-1 text-xs" style={{ color: r.status === 'succeeded' ? COLORS.good : COLORS.fix }}>
                    {r.status === 'succeeded' ? 'Done on Amazon.' : r.message}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="px-6 pt-3 pb-6">
          {!done && (
            <p className="m-0 text-xs" style={{ color: COLORS.textSecondary }}>
              These change your Amazon Ads account. Nothing is sent until you approve, and every change is recorded with who approved it.
            </p>
          )}
          {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            {done ? (
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021' }}>Close</button>
            ) : (
              <>
                <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>Cancel</button>
                <button type="button" onClick={approve} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Sending to Amazon…' : `Approve ${tasks.length} change${tasks.length === 1 ? '' : 's'}`}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default BulkApproveModal;
