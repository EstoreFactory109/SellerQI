import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { trackEvent } from '../../utils/analytics.js';

/**
 * Asks the seller's permission before SellerQI changes anything on Amazon.
 *
 * Shows exactly what will change (the server's own summary of the task's proposed
 * change) and sends it only on "Approve". The server re-derives the change from
 * the stored task, logs who approved it, and never sends it twice.
 *
 * @param {Object} props
 * @param {Object|null} props.task - task with proposedAction, or null when closed
 * @param {() => void} props.onClose
 * @param {(taskId: string) => void} props.onApproved - called once Amazon accepted the change
 */
const ApproveChangeModal = ({ task, onClose, onApproved }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setSaving(false);
    setError('');
    setDone(false);
  }, [task?.taskId]);

  useEffect(() => {
    if (!task) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task, saving, onClose]);

  if (!task?.proposedAction) return null;
  const action = task.proposedAction;

  const approve = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await axiosInstance.post('/api/pagewise/tasks/approve-actions', { taskIds: [task.taskId] }, { withCredentials: true });
      const result = (res.data?.data?.results || [])[0];
      trackEvent('task_action_approve', { type: action.type, status: result?.status || 'unknown' });
      if (result?.status === 'succeeded' || (result?.status === 'skipped' && /already/i.test(result.message || ''))) {
        setDone(true);
        onApproved?.(task.taskId);
      } else {
        setError(result?.message || 'Amazon did not accept the change. Nothing was changed.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reach Amazon. Nothing was changed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-change-title"
      onClick={() => { if (!saving) onClose?.(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-lg rounded-2xl border shadow-2xl"
        style={{ background: COLORS.surface, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <h2 id="approve-change-title" className="m-0 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>
            {done ? 'Done on Amazon' : 'Approve this change on Amazon?'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="p-1.5 rounded-lg border transition-colors flex-shrink-0"
            style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-6 pt-3 pb-6">
          <p className="m-0 text-sm leading-relaxed" style={{ color: COLORS.textPrimary }}>{action.summary}</p>
          {!done && (
            <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: COLORS.textSecondary }}>
              This changes your Amazon Ads account. Nothing is sent until you approve, and every change is recorded with who approved it.
            </p>
          )}
          {done && (
            <p role="status" className="m-0 mt-3 text-sm" style={{ color: COLORS.good }}>
              The change was made and this task is marked done.
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>
          )}
          <div className="flex justify-end gap-2 mt-5">
            {done ? (
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021' }}>
                Close
              </button>
            ) : (
              <>
                <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>
                  Cancel
                </button>
                <button type="button" onClick={approve} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Sending to Amazon…' : `Approve: ${action.label}`}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default ApproveChangeModal;
