import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  Users,
  Mail,
  User,
  Send,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  Trash2,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import axiosInstance from '../../../config/axios.config.js';
import RenameDialog from '../../Shared/RenameDialog.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * "Add member" — invite people to help run this seller account.
 *
 * Mirrors the ESF portal's team page, for a seller: invite by email (with an
 * optional name). Opening the emailed link signs the member straight in to this
 * account with full access; there is no form and no password. Next time they use
 * "Log in as a member" on the sign-in page, which emails them a one-time link.
 */
const Teams = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [inviting, setInviting] = useState(false);

  const [busyId, setBusyId] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);

  const flash = (setter, message) => {
    setter(message);
    setTimeout(() => setter(''), 5000);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await axiosInstance.get('/app/members');
      if (res.data?.statusCode === 200 && Array.isArray(res.data.data)) setMembers(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return setFieldError('Email is required');
    if (!EMAIL_REGEX.test(trimmed)) return setFieldError('Enter a valid email address');
    if (name.trim() && name.trim().length < 2) return setFieldError('Name must be at least 2 characters');

    setInviting(true);
    setError('');
    try {
      const res = await axiosInstance.post('/app/members/invite', { email: trimmed, name: name.trim() });
      if (res.data?.statusCode === 201 && res.data.data) {
        setMembers((prev) => [res.data.data, ...prev]);
        setEmail('');
        setName('');
        flash(setSuccess, `Invitation sent to ${trimmed}`);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the invitation. Please try again.');
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (member) => {
    setBusyId(member._id);
    setError('');
    try {
      const res = await axiosInstance.post(`/app/members/${member._id}/resend`);
      if (res.data?.data) setMembers((prev) => prev.map((m) => (m._id === member._id ? res.data.data : m)));
      flash(setSuccess, `Invitation resent to ${member.email}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not resend the invitation');
    } finally {
      setBusyId(null);
    }
  };

  // Called by RenameDialog; throwing keeps the dialog open with the message.
  const saveName = async (name) => {
    const member = renameTarget;
    try {
      const res = await axiosInstance.patch(`/app/members/${member._id}`, { name });
      if (res.data?.data) setMembers((prev) => prev.map((m) => (m._id === member._id ? res.data.data : m)));
      setRenameTarget(null);
    } catch (err) {
      throw new Error(err.response?.data?.message || 'Could not update the name');
    }
  };

  const handleRemove = async (member) => {
    setBusyId(member._id);
    setError('');
    try {
      await axiosInstance.delete(`/app/members/${member._id}`);
      setMembers((prev) => prev.filter((m) => m._id !== member._id));
      setConfirmRemove(null);
      flash(setSuccess, member.status === 'pending' ? 'Invitation revoked' : `${member.name || member.email} no longer has access`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove this member');
    } finally {
      setBusyId(null);
    }
  };

  const inputClass = (hasError) =>
    `w-full pl-10 pr-4 py-2.5 rounded-lg border bg-[#21262d] text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition ${
      hasError ? 'border-red-500' : 'border-[#30363d] hover:border-gray-500'
    }`;

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
      {/* Header */}
      <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-6 bg-blue-400 rounded-full"></div>
            <div className="flex items-center gap-3">
              <UserPlus className="w-5 h-5 text-white" />
              <h2 className="text-xl font-bold text-white">Add member</h2>
            </div>
          </div>
          <p className="text-gray-200 text-xs">
            Add members to manage your business account easily — share the work without sharing your password.
          </p>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* How it works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { Icon: Mail, title: 'Invite by email', text: 'Enter their email address. We send them an invitation.' },
            { Icon: ShieldCheck, title: 'One click to join', text: 'Opening the link signs them straight in — no form, no password.' },
            { Icon: Users, title: 'Full access', text: 'Members can do everything you can. Remove them any time.' },
          ].map(({ Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-[#30363d] bg-[#1a1a1a] p-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4 text-blue-400" />
                <p className="text-sm font-semibold text-gray-100">{title}</p>
              </div>
              <p className="text-xs text-gray-500">{text}</p>
            </div>
          ))}
        </div>

        {/* Invite form */}
        <form onSubmit={handleInvite} className="rounded-xl border border-[#30363d] bg-[#1a1a1a] p-4">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Invite a member</h3>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
            <div>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldError('');
                  }}
                  className={inputClass(!!fieldError)}
                  placeholder="name@company.com"
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                <input
                  type="text"
                  value={name}
                  maxLength={50}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldError('');
                  }}
                  className={inputClass(false)}
                  placeholder="Name (optional)"
                  autoComplete="off"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Invite member
            </button>
          </div>
          {fieldError && <p className="text-red-400 text-xs mt-2">{fieldError}</p>}
          <p className="text-xs text-gray-500 mt-3">
            The address must not already have its own SellerQI account. The invitation expires in 7 days. Next time,
            members choose &quot;Log in as a member&quot; on the sign-in page to get a sign-in link.
          </p>
        </form>

        {success && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Members */}
        <div>
          <h3 className="text-sm font-semibold text-gray-100 mb-2">
            Members {members.length > 0 && <span className="text-gray-500 font-normal">({members.length})</span>}
          </h3>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading members…
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#30363d] py-10 text-center">
              <Users className="w-6 h-6 text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-300">No members yet</p>
              <p className="text-xs text-gray-500 mt-1">Invite someone above to help manage this account.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => {
                const busy = busyId === member._id;
                const pending = member.status === 'pending';
                return (
                  <div
                    key={member._id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-[#30363d] bg-[#1a1a1a] px-3 py-2.5"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-400/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-gray-100">
                        {(member.name || member.email).slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-100 break-all">
                        {member.name || member.email}
                        {member.isYou && (
                          <span className="ml-2 align-middle text-[10px] font-semibold px-1.5 py-0.5 rounded border border-blue-400/30 bg-blue-500/10 text-blue-300">
                            You
                          </span>
                        )}
                      </p>
                      {member.name && <p className="text-xs text-gray-500 break-all">{member.email}</p>}
                    </div>

                    {pending ? (
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                          member.isExpired
                            ? 'border-red-400/30 bg-red-500/10 text-red-300'
                            : 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {member.isExpired ? 'Invitation expired' : `Invited · expires ${formatDate(member.inviteExpiresAt)}`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                        <CheckCircle className="w-3 h-3" />
                        Active · last sign-in {formatDate(member.lastLoginAt)}
                      </span>
                    )}

                    <div className="flex items-center gap-3">
                      {pending && (
                        <button
                          type="button"
                          onClick={() => handleResend(member)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Resend
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setRenameTarget(member)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-300 hover:text-gray-100 disabled:opacity-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Name
                      </button>
                      {/* A member can rename themselves but not remove themselves (the server refuses too). */}
                      {!member.isYou && (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(member)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {pending ? 'Revoke' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <RenameDialog
        open={!!renameTarget}
        title="Edit name"
        description={renameTarget?.email}
        initialValue={renameTarget?.name || ''}
        placeholder="e.g. Priya"
        tone="seller"
        onCancel={() => setRenameTarget(null)}
        onSave={saveName}
      />

      {/* Remove confirmation */}
      {confirmRemove && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[210] p-4"
          onClick={() => !busyId && setConfirmRemove(null)}
        >
          <div
            className="bg-[#161b22] rounded-2xl max-w-md w-full p-6 border border-[#30363d] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-100 mb-2">
              {confirmRemove.status === 'pending' ? 'Revoke invitation' : 'Remove member'}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              {confirmRemove.status === 'pending'
                ? `The invitation link sent to ${confirmRemove.email} will stop working.`
                : `${confirmRemove.name || confirmRemove.email} will be signed out and can no longer open this account. You can invite them again later.`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRemove(null)}
                disabled={!!busyId}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemove(confirmRemove)}
                disabled={!!busyId}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
              >
                {busyId ? 'Removing…' : confirmRemove.status === 'pending' ? 'Revoke' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Teams;
