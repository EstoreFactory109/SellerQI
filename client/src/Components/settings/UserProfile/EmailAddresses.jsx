import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  Plus,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Clock,
  X as XIcon,
} from 'lucide-react';
import axiosInstance from '../../../config/axios.config.js';

/**
 * Manage the email addresses on the account.
 *
 * Adding an address sends it a code; it receives nothing until confirmed.
 * Every address (including the primary) can be switched off for mail, except
 * the last one still receiving — the API refuses that, and so does this UI.
 */
const EmailAddresses = () => {
  const [emails, setEmails] = useState([]);
  const [maxAdditional, setMaxAdditional] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);

  const [pendingEmail, setPendingEmail] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [busyEmail, setBusyEmail] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);

  const flash = (setter, message) => {
    setter(message);
    setTimeout(() => setter(''), 5000);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await axiosInstance.get('/app/emails');
      if (res.data?.statusCode === 200) {
        setEmails(res.data.data.emails || []);
        setMaxAdditional(res.data.data.maxAdditional ?? 5);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load your email addresses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const additionalCount = emails.filter((e) => !e.isPrimary).length;
  const activeCount = emails.filter((e) => e.receivesMail && e.isVerified).length;

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    try {
      setAdding(true);
      setError('');
      const res = await axiosInstance.post('/app/emails', { email: newEmail.trim() });
      if (res.data?.statusCode === 201) {
        setEmails(res.data.data.emails || []);
        setPendingEmail(res.data.data.pendingEmail);
        setNewEmail('');
        flash(setSuccess, `We sent a code to ${res.data.data.pendingEmail}.`);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add that email');
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      setVerifying(true);
      setError('');
      const res = await axiosInstance.post('/app/emails/verify', { email: pendingEmail, code: code.trim() });
      if (res.data?.statusCode === 200) {
        setEmails(res.data.data.emails || []);
        setPendingEmail('');
        setCode('');
        flash(setSuccess, 'Email verified. It will now receive mail and can be used to sign in.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async (email) => {
    try {
      setBusyEmail(email);
      setError('');
      await axiosInstance.post('/app/emails/resend', { email });
      setPendingEmail(email);
      flash(setSuccess, `New code sent to ${email}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resend the code');
    } finally {
      setBusyEmail('');
    }
  };

  const handleToggle = async (entry) => {
    try {
      setBusyEmail(entry.email);
      setError('');
      const res = await axiosInstance.patch('/app/emails/preferences', {
        email: entry.email,
        receivesMail: !entry.receivesMail,
      });
      if (res.data?.statusCode === 200) setEmails(res.data.data.emails || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update that setting');
    } finally {
      setBusyEmail('');
    }
  };

  const handleRemove = async (email) => {
    try {
      setBusyEmail(email);
      setError('');
      const res = await axiosInstance.delete('/app/emails', { data: { email } });
      if (res.data?.statusCode === 200) {
        setEmails(res.data.data.emails || []);
        setConfirmRemove(null);
        if (pendingEmail === email) setPendingEmail('');
        flash(setSuccess, 'Email removed.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove that email');
    } finally {
      setBusyEmail('');
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-[#30363d]">
      <div className="flex items-center gap-3 mb-1">
        <div className="p-2 bg-blue-500/20 rounded-lg">
          <Mail className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-100">Email addresses</h3>
          <p className="text-xs text-gray-500">
            Add more addresses to receive mail. Any verified address can also be used to sign in.
          </p>
        </div>
      </div>

      {success && (
        <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading addresses…
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {emails.map((entry) => {
              const busy = busyEmail === entry.email;
              return (
                <div
                  key={entry.email}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-[#30363d] bg-[#1a1a1a] px-3 py-2.5"
                >
                  <Mail className="w-4 h-4 text-gray-500 shrink-0" />
                  <span className="text-sm text-gray-100 break-all min-w-0 flex-1">{entry.email}</span>

                  {entry.isPrimary && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-blue-400/30 bg-blue-500/10 text-blue-300">
                      Primary
                    </span>
                  )}
                  {!entry.isVerified && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-amber-400/30 bg-amber-500/10 text-amber-300">
                      <Clock className="w-3 h-3" /> Unverified
                    </span>
                  )}
                  {entry.isVerified && !entry.isPrimary && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                      <ShieldCheck className="w-3 h-3" /> Verified
                    </span>
                  )}

                  {/* Receives-mail switch. Meaningless until verified. */}
                  {entry.isVerified ? (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={entry.receivesMail}
                        disabled={busy}
                        onChange={() => handleToggle(entry)}
                        className="w-4 h-4 rounded border-[#30363d] bg-[#21262d] accent-blue-600 cursor-pointer"
                      />
                      <span className={`text-xs ${entry.receivesMail ? 'text-gray-300' : 'text-gray-500'}`}>
                        Receives mail
                      </span>
                    </label>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleResend(entry.email)}
                      disabled={busy}
                      className="text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
                    >
                      {busy ? 'Sending…' : 'Resend code'}
                    </button>
                  )}

                  {!entry.isPrimary && (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(entry.email)}
                      disabled={busy}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      aria-label={`Remove ${entry.email}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-xs text-gray-500">
            {activeCount} of {emails.length} addresses receive mail. At least one must stay switched on.
          </p>

          {/* Verify a pending address */}
          {pendingEmail && (
            <form
              onSubmit={handleVerify}
              className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm text-gray-200">
                  Enter the code sent to <span className="font-medium">{pendingEmail}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setPendingEmail(''); setCode(''); }}
                  className="p-1 rounded text-gray-500 hover:text-gray-300"
                  aria-label="Dismiss"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  className="w-40 px-3 py-2 rounded-lg bg-[#1a1a1a] border-2 border-[#30363d] text-gray-100 tracking-widest focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={verifying || code.length < 6}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
                  Verify
                </button>
                <button
                  type="button"
                  onClick={() => handleResend(pendingEmail)}
                  className="text-xs font-medium text-blue-400 hover:text-blue-300"
                >
                  Resend
                </button>
              </div>
            </form>
          )}

          {/* Add a new address */}
          {additionalCount < maxAdditional ? (
            <form onSubmit={handleAdd} className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Add another email address"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#1a1a1a] border-2 border-[#30363d] text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={adding || !newEmail.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add email
              </button>
            </form>
          ) : (
            <p className="mt-4 text-xs text-gray-500">
              You have reached the maximum of {maxAdditional} additional addresses.
            </p>
          )}

          {/* Remove confirmation */}
          {confirmRemove && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3">
              <p className="text-sm text-gray-200 mb-3">
                Remove <span className="font-medium break-all">{confirmRemove}</span> from your account?
                It will stop receiving mail and can no longer be used to sign in.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRemove(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-[#21262d]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(confirmRemove)}
                  disabled={busyEmail === confirmRemove}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {busyEmail === confirmRemove ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EmailAddresses;
