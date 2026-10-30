import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle, AlertCircle, AlertTriangle, Link2, Unlink, RefreshCw, FolderOpen,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { useEsfUser } from '../../contexts/EsfUserContext.js';

const when = (v) => (v ? new Date(v).toLocaleString() : '-');

/**
 * Google Drive connection card for the ESF portal.
 *
 * The clients' weekly, bi-weekly, monthly and quarterly report PDFs — the same ones they
 * are emailed — are also saved to this Drive under "SellerQI Reports / <brand> / <cadence>".
 * One connection for the whole portal; connect/disconnect are owner/admin only (the server
 * enforces that too).
 */
export default function EsfDriveIntegration() {
  const esfUser = useEsfUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const canManage = esfUser?.isOwner || ['owner', 'admin'].includes(esfUser?.esfRole);

  const loadStatus = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/api/gdrive/status');
      setStatus(res.data?.data || { connected: false });
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not read the Google Drive connection status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // The OAuth callback lands here with ?gdrive=connected|error. Read once, then strip it.
  useEffect(() => {
    const outcome = searchParams.get('gdrive');
    if (!outcome) return;
    const account = searchParams.get('account');
    setNotice(outcome === 'connected'
      ? { kind: 'success', text: account ? `Connected to ${account}.` : 'Google Drive connected.' }
      : { kind: 'error', text: searchParams.get('reason') || 'Could not connect Google Drive.' });
    const next = new URLSearchParams(searchParams);
    ['gdrive', 'reason', 'account'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await axiosInstance.get('/api/gdrive/auth/url');
      const url = res.data?.data?.authorizationUrl;
      if (!url) throw new Error('No authorization URL was returned');
      window.location.href = url;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not start the Google Drive connect flow');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await axiosInstance.delete('/api/gdrive/disconnect');
      setConfirmingDisconnect(false);
      setNotice({ kind: 'success', text: 'Google Drive disconnected. The reports already saved stay in Drive.' });
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not disconnect Google Drive');
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Google Drive</h2>
          <p className="mt-1 text-sm text-gray-400 max-w-xl">
            Every report PDF emailed to an ESF client is also saved here, in
            “{status?.rootFolderName || 'SellerQI Reports'} / brand / Weekly, Bi-weekly, Monthly or Quarterly”.
            Only ESF can see these folders; nothing is shared with clients.
          </p>
        </div>

        {!loading && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'
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
            notice.kind === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
          }`}
        >
          {notice.kind === 'success' ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
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
          {!status?.configured && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>The server has no Google Drive credentials yet (GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REDIRECT_URI).</span>
            </div>
          )}

          {connected && (
            <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Google account</dt>
                <dd className="text-gray-200 break-all">{status.emailAddress || '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Saving reports</dt>
                <dd className="text-gray-200">{status.enabled ? 'On' : 'Off (GDRIVE_REPORTS_ENABLED=false on the server)'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Last report saved</dt>
                <dd className="text-gray-200">{when(status.lastSavedAt)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Client folders</dt>
                <dd className="text-gray-200">{status.clientFolders ?? 0}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Connected</dt>
                <dd className="text-gray-200">{when(status.connectedAt)}</dd>
              </div>
              {status.rootFolderUrl && (
                <div>
                  <dt className="text-gray-500">Folder</dt>
                  <dd>
                    <a href={status.rootFolderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
                      <FolderOpen className="w-4 h-4" /> Open in Google Drive
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          )}

          {connected && status.lastErrorCurrent && status.lastError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Last save failed ({when(status.lastErrorAt)}): {status.lastError}
                <br />
                The client still got their email. Reconnecting fixes an expired connection.
              </span>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {canManage ? (
              <>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={busy || !status?.configured}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" />
                    : connected ? <RefreshCw className="w-4 h-4" />
                    : <Link2 className="w-4 h-4" />}
                  {connected ? 'Reconnect' : 'Connect Google Drive'}
                </button>

                {connected && (
                  confirmingDisconnect ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      <span className="text-gray-300">Stop saving reports to Drive?</span>
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
              <p className="text-sm text-gray-500">Only the portal owner and admins can change this connection.</p>
            )}
          </div>

          {canManage && !connected && (
            <p className="mt-3 text-xs text-gray-500">
              Sign in with the ESF Google account that should hold the reports. SellerQI can only
              see the folders and files it creates there, nothing else in that Drive.
            </p>
          )}
        </>
      )}
    </div>
  );
}
