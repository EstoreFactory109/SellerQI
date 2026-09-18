import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle, AlertCircle, AlertTriangle, Link2, Unlink, RefreshCw,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { useEsfUser } from '../../contexts/EsfUserContext.js';

/**
 * Zoho Projects connection card for the ESF portal.
 *
 * One org-wide connection shared by the whole portal, so this shows a single state
 * rather than anything per-user. Connect/disconnect are owner/admin only — the server
 * enforces that too; hiding the buttons is presentation, not the security boundary.
 */
export default function EsfZohoIntegration() {
  const esfUser = useEsfUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);   // { kind, text } from the OAuth round-trip
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Only the owner and admins may change a credential the whole portal shares.
  const canManage = esfUser?.isOwner || ['owner', 'admin'].includes(esfUser?.esfRole);

  const loadStatus = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/api/zoho/status');
      setStatus(res.data?.data || { connected: false });
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not read the Zoho connection status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // The OAuth callback redirects back here with ?zoho=connected|partial|error. Read it
  // once, then strip it from the URL so a refresh does not replay a stale banner.
  useEffect(() => {
    const outcome = searchParams.get('zoho');
    if (!outcome) return;

    const reason = searchParams.get('reason');
    const portal = searchParams.get('portal');
    setNotice(
      outcome === 'connected'
        ? { kind: 'success', text: portal ? `Connected to the “${portal}” portal.` : 'Zoho Projects connected.' }
        : outcome === 'partial'
          ? { kind: 'warn', text: reason || 'Connected, but setup is incomplete.' }
          : { kind: 'error', text: reason || 'Could not connect to Zoho Projects.' }
    );

    const next = new URLSearchParams(searchParams);
    ['zoho', 'reason', 'portal'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      // The server mints a single-use CSRF state alongside the URL, so the consent link
      // has to come from it rather than being assembled here.
      const res = await axiosInstance.get('/api/zoho/auth/url');
      const url = res.data?.data?.authorizationUrl;
      if (!url) throw new Error('No authorization URL was returned');
      window.location.href = url;   // full navigation: Zoho will redirect back
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not start the Zoho connect flow');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await axiosInstance.delete('/api/zoho/disconnect');
      setConfirmingDisconnect(false);
      setNotice({ kind: 'success', text: 'Zoho Projects disconnected.' });
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not disconnect Zoho Projects');
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Zoho Projects</h2>
          <p className="mt-1 text-sm text-gray-400 max-w-xl">
            One shared connection for the whole portal. Once connected, the portal can list and
            create projects and read task updates from your Zoho Projects account.
          </p>
        </div>

        {!loading && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              connected
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-gray-500/15 text-gray-400'
            }`}
          >
            {connected ? <CheckCircle className="w-3.5 h-3.5" /> : <Unlink className="w-3.5 h-3.5" />}
            {connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      {notice && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            notice.kind === 'success' ? 'bg-emerald-500/10 text-emerald-300'
              : notice.kind === 'warn' ? 'bg-amber-500/10 text-amber-300'
              : 'bg-red-500/10 text-red-300'
          }`}
        >
          {notice.kind === 'success' ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            : notice.kind === 'warn' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking connection…
        </div>
      ) : (
        <>
          {connected && (
            <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Portal</dt>
                <dd className="text-gray-200">{status.portalName || status.portalId || '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Data center</dt>
                <dd className="text-gray-200 break-all">
                  {status.apiDomain ? status.apiDomain.replace(/^https?:\/\//, '') : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Connected</dt>
                <dd className="text-gray-200">
                  {status.connectedAt ? new Date(status.connectedAt).toLocaleString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Token last refreshed</dt>
                <dd className="text-gray-200">
                  {status.lastRefreshAt ? new Date(status.lastRefreshAt).toLocaleString() : '—'}
                </dd>
              </div>
            </dl>
          )}

          {/* A connection can be present but broken (revoked grant, wrong data center).
              lastError is the only thing that explains it without reading server logs. */}
          {connected && status.lastError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Last Zoho call failed: {status.lastError}
                <br />
                Reconnecting usually fixes this.
              </span>
            </div>
          )}

          {connected && !status.portalId && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>No Zoho portal was resolved, so project calls will fail. Reconnect to fix it.</span>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {canManage ? (
              <>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" />
                    : connected ? <RefreshCw className="w-4 h-4" />
                    : <Link2 className="w-4 h-4" />}
                  {connected ? 'Reconnect' : 'Connect Zoho account'}
                </button>

                {connected && (
                  confirmingDisconnect ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      <span className="text-gray-300">Disconnect for everyone?</span>
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={busy}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
                      >
                        Yes, disconnect
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDisconnect(false)}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDisconnect(true)}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/5 disabled:opacity-60"
                    >
                      <Unlink className="w-4 h-4" /> Disconnect
                    </button>
                  )
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Only the portal owner and admins can change this connection.
              </p>
            )}
          </div>

          {canManage && connected && (
            <p className="mt-3 text-xs text-gray-500">
              Reconnect only when necessary — Zoho allows 20 refresh tokens per account and
              silently invalidates the oldest. Disconnecting here does not revoke access on
              Zoho’s side; do that in Zoho Accounts → Connected Apps.
            </p>
          )}
        </>
      )}
    </div>
  );
}
