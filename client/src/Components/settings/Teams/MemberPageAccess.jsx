import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Loader2, X as XIcon, AlertCircle } from 'lucide-react';
import axiosInstance from '../../../config/axios.config.js';

/**
 * Page access for members of a seller account — the seller-app twin of the ESF
 * portal's EsfPagePermissionsModal.
 *
 * The UI is an ALLOW list (ticked = can open), while the API stores a blocklist
 * so pages added later are visible by default. The inversion happens here.
 */

/** Blocklist to send, from the ticked (allowed) pages. */
export const deniedFrom = (pages, allowed) => pages.map((p) => p.key).filter((key) => !allowed.has(key));

/** Ticked (allowed) pages, from a stored blocklist. */
export const allowedFrom = (pages, deniedPages = []) => {
  const denied = new Set(deniedPages);
  return new Set(pages.map((p) => p.key).filter((key) => !denied.has(key)));
};

/** "All pages" / "5 of 18 pages" for a member row. */
export const accessLabel = (pages, deniedPages = []) => {
  const blocked = deniedPages.filter((key) => pages.some((p) => p.key === key)).length;
  return blocked === 0 ? 'All pages' : `${pages.length - blocked} of ${pages.length} pages`;
};

/** Grouped checkboxes. Controlled: `allowed` is a Set of page keys. */
export const PageAccessPicker = ({ pages, allowed, onChange }) => {
  const groups = useMemo(() => {
    const byGroup = new Map();
    pages.forEach((page) => {
      if (!byGroup.has(page.group)) byGroup.set(page.group, []);
      byGroup.get(page.group).push(page);
    });
    return [...byGroup.entries()];
  }, [pages]);

  const toggle = (key) => {
    const next = new Set(allowed);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">
          <span className="text-gray-300 font-medium tabular-nums">{allowed.size}</span> of{' '}
          <span className="tabular-nums">{pages.length}</span> pages allowed
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(new Set(pages.map((p) => p.key)))}
            className="px-2.5 py-1 rounded-md text-xs font-medium border border-[#30363d] text-gray-300 hover:bg-white/[0.05]"
          >
            Allow all
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="px-2.5 py-1 rounded-md text-xs font-medium border border-[#30363d] text-gray-300 hover:bg-white/[0.05]"
          >
            Block all
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {groups.map(([group, items]) => (
          <div key={group} className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
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
                    className="w-4 h-4 rounded border-[#30363d] bg-[#21262d] accent-blue-600 cursor-pointer"
                  />
                  <span className={`text-sm ${allowed.has(page.key) ? 'text-gray-200' : 'text-gray-500'}`}>{page.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Change an existing member's page access (owner only). */
export const MemberPageAccessModal = ({ member, pages, onClose, onSaved }) => {
  const [allowed, setAllowed] = useState(() => allowedFrom(pages, member.deniedPages));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await axiosInstance.put(`/app/members/${member._id}/permissions`, { deniedPages: deniedFrom(pages, allowed) });
      onSaved(res.data?.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save page access');
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-access-title"
    >
      <div
        className="bg-[#161b22] rounded-2xl border border-[#30363d] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 md:p-5 border-b border-[#30363d] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 id="member-access-title" className="text-lg font-semibold text-gray-100 truncate">Page access</h2>
              <p className="text-xs text-gray-500 truncate">What {member.name || member.email} can open in this account</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
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
          <PageAccessPicker pages={pages} allowed={allowed} onChange={setAllowed} />
          <p className="mt-4 text-xs text-gray-500 border-t border-[#30363d] pt-4">
            Blocked pages are hidden from their sidebar and their data is refused by the server.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-[#30363d] shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 border border-[#30363d] hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
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
