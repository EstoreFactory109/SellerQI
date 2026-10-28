import React, { useEffect, useState } from 'react';
import { CheckCircle2, FlaskConical, Undo2, Loader2 } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * Zoho tasks the team closed, and the clients' SellerQI tasks they were matched to (AI).
 *
 * While ZOHO_CLOSE_MATCH_MODE is dry_run this is the review: every row is what WOULD have been
 * marked done. Once it is on, rows were applied, and "Client re-opened" shows where a client
 * disagreed — the signal that the matching is wrong. Staff-added ESF clients only; Fix it
 * buyers have their own two-way sync.
 */
const formatDay = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function EsfCloseMatches() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axiosInstance.get('/app/esf/close-matches')
      .then((res) => setData(res.data?.data || null))
      .catch((err) => setError(err.response?.data?.message || 'Could not load closed tasks'));
  }, []);

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!data) return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const { mode, items, stats } = data;
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-300">
        {mode === 'on' ? (
          <p className="m-0 flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span><strong className="text-gray-100">On.</strong> When the team closes a Zoho task, the client's matching SellerQI tasks are marked done ("Done by ESF team") and a SellerQI message is left on the Zoho task.</span></p>
        ) : mode === 'off' ? (
          <p className="m-0">Switched off: closed Zoho tasks are not matched.</p>
        ) : (
          <p className="m-0 flex items-start gap-2"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span><strong className="text-gray-100">Trial run.</strong> Nothing is changed for clients yet — each row is what WOULD be marked done. Check a few; when they look right, set <code className="text-amber-300">ZOHO_CLOSE_MATCH_MODE=on</code>.</span></p>
        )}
        <p className="m-0 mt-2 text-xs text-gray-500">
          {stats.closedTasks} closed Zoho tasks · {stats.withMatches} matched to {stats.matched} SellerQI tasks{mode === 'on' ? ` · ${stats.undone} re-opened by clients` : ''}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">No Zoho tasks closed since this started. Rows appear after the nightly Zoho sync.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-white/10 bg-[#101722] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-sm font-semibold text-gray-100">{item.zohoTaskName}</p>
                <span className="text-xs text-gray-500">
                  {item.client.name}{item.client.projectName ? ` · ${item.client.projectName}` : ''} · closed {formatDay(item.closedAt)}
                  {item.mode === 'dry_run' ? ' · trial run' : item.applied ? ' · applied' : ''}
                </span>
              </div>
              {item.matches.length === 0 ? (
                <p className="m-0 mt-2 text-xs text-gray-500">No SellerQI task matched{item.considered ? ` (${item.considered} looked at)` : ''}.</p>
              ) : (
                <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                  {item.matches.map((m) => (
                    <li key={m.taskId} className="text-[13px] text-gray-300">
                      <span className={m.undone ? 'line-through text-gray-500' : ''}>{m.taskTitle}</span>
                      {m.country ? <span className="text-gray-600"> · {m.country}</span> : null}
                      {m.reason ? <span className="block text-xs text-gray-500">{m.reason}</span> : null}
                      {m.undone && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-400"><Undo2 className="h-3 w-3" /> Client re-opened this</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
