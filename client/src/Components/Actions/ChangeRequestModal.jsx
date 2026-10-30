import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { trackEvent } from '../../utils/analytics.js';

/**
 * Asks the seller's approval before SellerQI changes anything on Amazon from a
 * screen (the PPC page, QMate, Fix It...).
 *
 * Opening it asks the server for a preview (what exactly would change; nothing is
 * sent). "Send to Amazon" approves that preview; the server sends the change it
 * built itself, once, and records who approved it.
 *
 * Use through the hook: const { requestChange, changeModal } = useChangeRequest();
 *   const result = await requestChange({ feature: 'ads', actionType: 'ads.pause_keywords', input });
 *   // result.status: 'succeeded' | 'failed' | 'stale' | 'unknown' | 'awaiting_amazon' | 'cancelled' | 'closed'
 * and render {changeModal} once in the page.
 */
const POLL_MS = 3000;
const MAX_POLLS = 40;
const DONE = ['succeeded', 'failed', 'stale', 'unknown', 'cancelled', 'expired'];

const messageOf = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

export const ChangeRequestModal = ({ request, onFinish }) => {
  const [phase, setPhase] = useState('loading'); // loading | ready | sending | result | error
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const finished = useRef(false);

  const finish = useCallback((value) => {
    if (finished.current) return;
    finished.current = true;
    onFinish?.(value);
  }, [onFinish]);

  useEffect(() => {
    if (!request) return undefined;
    finished.current = false;
    let cancelled = false;
    setPhase('loading'); setDraft(null); setResult(null); setError('');
    axiosInstance.post(`/api/actions/${request.feature}/preview`, {
      actionType: request.actionType, input: request.input, source: request.source || 'screen'
    }).then((res) => {
      if (cancelled) return;
      setDraft(res.data?.data || null);
      setPhase('ready');
      trackEvent('amazon_change_preview', { actionType: request.actionType });
    }).catch((err) => {
      if (cancelled) return;
      setError(messageOf(err, 'Could not prepare this change. Nothing was sent.'));
      setPhase('error');
    });
    return () => { cancelled = true; };
  }, [request]);

  const close = useCallback(() => {
    if (phase === 'sending') return;
    // An unsent draft is cancelled on the server so it can never be approved later.
    if (phase === 'ready' && draft?.id) {
      axiosInstance.delete(`/api/actions/${request.feature}/${draft.id}`).catch(() => {});
    }
    finish(result || { status: phase === 'error' ? 'failed' : 'closed', message: error });
  }, [phase, draft, request, result, error, finish]);

  useEffect(() => {
    if (!request) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, close]);

  const send = async () => {
    if (!draft?.id) return;
    setPhase('sending');
    setError('');
    try {
      const res = await axiosInstance.post(`/api/actions/${request.feature}/${draft.id}/approve`);
      let out = res.data?.data;
      // Some changes take Amazon a while (feeds, shipments): wait for the outcome.
      for (let i = 0; out?.status === 'awaiting_amazon' && i < MAX_POLLS; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await axiosInstance.get(`/api/actions/${request.feature}/${draft.id}`);
        out = poll.data?.data || out;
      }
      trackEvent('amazon_change_approve', { actionType: request.actionType, status: out?.status || 'unknown' });
      setResult(out);
      setPhase('result');
    } catch (err) {
      setError(messageOf(err, 'Could not reach SellerQI. Nothing was sent.'));
      setResult({ status: 'failed', message: messageOf(err, '') });
      setPhase('result');
    }
  };

  if (!request) return null;
  const preview = draft?.preview || {};
  const lines = Array.isArray(preview.lines) ? preview.lines : [];
  const issues = Array.isArray(preview.amazonIssues) ? preview.amazonIssues : [];
  const blocked = !!preview.blocking;
  const ok = result?.status === 'succeeded';
  const title = phase === 'result'
    ? (ok ? 'Done on Amazon' : result?.status === 'awaiting_amazon' ? 'Sent; Amazon is still processing' : 'Not changed')
    : (preview.title || 'Review this change');

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-request-title"
      onClick={close}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-xl rounded-2xl border shadow-2xl max-h-[88vh] flex flex-col"
        style={{ background: COLORS.surface, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2 id="change-request-title" className="m-0 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>{title}</h2>
            {preview.target && phase !== 'result' && (
              <p className="m-0 mt-1 text-xs" style={{ color: COLORS.textSecondary }}>{preview.target}</p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            disabled={phase === 'sending'}
            aria-label="Close"
            className="p-1.5 rounded-lg border transition-colors flex-shrink-0"
            style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pt-3 pb-6 overflow-y-auto">
          {phase === 'loading' && (
            <p role="status" className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Preparing the change… nothing is sent yet.</p>
          )}

          {(phase === 'ready' || phase === 'sending') && (
            <>
              {lines.length > 0 && (
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: COLORS.border }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: COLORS.surfaceElevated }}>
                        <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: COLORS.textSecondary }}>What</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Now</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: COLORS.textSecondary }}>After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.slice(0, 50).map((line, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                          <td className="px-3 py-2 align-top" style={{ color: COLORS.textPrimary }}>{line.label}</td>
                          <td className="px-3 py-2 align-top" style={{ color: COLORS.textSecondary }}>{line.before || '—'}</td>
                          <td className="px-3 py-2 align-top font-medium" style={{ color: COLORS.textPrimary }}>{line.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lines.length > 50 && (
                    <p className="m-0 px-3 py-2 text-xs" style={{ color: COLORS.textMuted }}>…and {lines.length - 50} more.</p>
                  )}
                </div>
              )}
              {issues.length > 0 && (
                <ul className="mt-3 mb-0 pl-5 text-sm" style={{ color: COLORS.fix }}>
                  {issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              )}
              {(preview.warnings || []).map((w, i) => (
                <p key={i} className="m-0 mt-3 text-xs leading-relaxed" style={{ color: COLORS.textSecondary }}>{w}</p>
              ))}
              <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: COLORS.textSecondary }}>
                Nothing is sent until you choose Send to Amazon, and every change is recorded with who approved it.
              </p>
            </>
          )}

          {phase === 'result' && (
            <p role="status" className="m-0 text-sm" style={{ color: ok ? COLORS.good : COLORS.textPrimary }}>
              {result?.message || (ok ? 'The change was made.' : 'Amazon did not accept the change. Nothing was changed.')}
              {!ok && result?.error && result.error !== result.message ? ` ${result.error}` : ''}
            </p>
          )}

          {error && phase !== 'result' && (
            <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>
          )}

          <div className="flex justify-end gap-2 mt-5">
            {phase === 'result' || phase === 'error' ? (
              <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021' }}>
                Close
              </button>
            ) : (
              <>
                <button type="button" onClick={close} disabled={phase === 'sending'} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={phase !== 'ready' || blocked}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: COLORS.accent, color: '#061021', opacity: phase !== 'ready' || blocked ? 0.6 : 1 }}
                >
                  {phase === 'sending' ? 'Sending to Amazon…' : 'Send to Amazon'}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

/**
 * One approval window per page. requestChange opens it and resolves with the
 * outcome once the seller closes it.
 */
export function useChangeRequest() {
  const [state, setState] = useState(null); // { request, resolve }

  const requestChange = useCallback((request) => new Promise((resolve) => {
    setState({ request: { ...request }, resolve });
  }), []);

  const onFinish = useCallback((value) => {
    setState((current) => {
      current?.resolve?.(value);
      return null;
    });
  }, []);

  const changeModal = state ? <ChangeRequestModal request={state.request} onFinish={onFinish} /> : null;
  return { requestChange, changeModal };
}

export default ChangeRequestModal;
