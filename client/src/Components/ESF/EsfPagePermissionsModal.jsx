import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X as XIcon, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * Owner/admin control over which pages a team member may open inside an ESF
 * client's account.
 *
 * The UI is an ALLOW list (ticked = visible) because that is how people think
 * about it, while the API stores a blocklist so new pages default to visible.
 * The inversion happens here, at the boundary.
 */
const EsfPagePermissionsModal = ({ member, onClose, onSaved }) => {
  const [pages, setPages] = useState([]);
  const [allowed, setAllowed] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await axiosInstance.get('/app/esf/pages');
        const catalogue = res.data?.data || [];
        setPages(catalogue);

        const denied = new Set(member?.esfDeniedPages || []);
        setAllowed(new Set(catalogue.map((p) => p.key).filter((k) => !denied.has(k))));
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load the page list');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [member]);

  const groups = useMemo(() => {
    const byGroup = new Map();
    pages.forEach((page) => {
      if (!byGroup.has(page.group)) byGroup.set(page.group, []);
      byGroup.get(page.group).push(page);
    });
    return [...byGroup.entries()];
  }, [pages]);

  const toggle = (key) => {
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAll = (value) => {
    setAllowed(value ? new Set(pages.map((p) => p.key)) : new Set());
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      // Invert back to the blocklist the API stores.
      const deniedPages = pages.map((p) => p.key).filter((k) => !allowed.has(k));
      const res = await axiosInstance.put(`/app/esf/users/${member._id}/permissions`, { deniedPages });
      if (res.data?.statusCode === 200) {
        onSaved?.(member._id, deniedPages);
      } else {
        setError(res.data?.message || 'Failed to save page access');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save page access');
    } finally {
      setSaving(false);
    }
  };

  const allowedCount = allowed.size;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="esf-permissions-title"
    >
      <div
        className="bg-[#101722] rounded-2xl border border-white/10 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 id="esf-permissions-title" className="text-lg font-semibold text-gray-100 truncate">
                Page access
              </h2>
              <p className="text-xs text-gray-500 truncate">
                What {member?.firstName} {member?.lastName} can open inside an ESF client
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 transition-colors shrink-0"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 md:p-5 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
              <span className="ml-2 text-sm text-gray-400">Loading pages…</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-gray-500">
                  <span className="text-gray-300 font-medium tabular-nums">{allowedCount}</span> of{' '}
                  <span className="tabular-nums">{pages.length}</span> pages allowed
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAll(true)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium border border-white/10 text-gray-300 hover:bg-white/[0.05]"
                  >
                    Allow all
                  </button>
                  <button
                    type="button"
                    onClick={() => setAll(false)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium border border-white/10 text-gray-300 hover:bg-white/[0.05]"
                  >
                    Block all
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {groups.map(([group, items]) => (
                  <div key={group} className="rounded-xl border border-white/10 bg-[#0b0f17]/70 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{group}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {items.map((page) => (
                        <label
                          key={page.key}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={allowed.has(page.key)}
                            onChange={() => toggle(page.key)}
                            className="w-4 h-4 rounded border-white/20 bg-white/[0.04] accent-blue-600 cursor-pointer"
                          />
                          <span className={`text-sm ${allowed.has(page.key) ? 'text-gray-200' : 'text-gray-500'}`}>
                            {page.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-xs text-gray-500 border-t border-white/10 pt-4">
                Applies to ESF clients only — agency clients and self-serve sellers are unaffected.
                Blocked pages are hidden from the sidebar and their data is refused by the server.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 border border-white/10 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-950/30 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save access
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EsfPagePermissionsModal;
