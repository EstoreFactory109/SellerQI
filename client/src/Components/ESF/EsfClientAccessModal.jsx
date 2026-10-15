import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X as XIcon, Loader2, Users, AlertCircle, Search } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * Owner/admin control over which CLIENTS a team member can see.
 *
 * Sibling of EsfPagePermissionsModal, and deliberately the same shape so the two read as
 * one feature — but the polarity is the opposite and that is the thing to keep straight.
 * Pages are stored as a BLOCKLIST, so the modal inverts at the boundary and an empty
 * selection means full access. Clients are stored as an ALLOW-list: what is ticked here
 * is exactly what is saved, and ticking nothing means the member sees nothing.
 *
 * That is why there is no "Allow all" button. On the pages modal it is a shortcut back
 * to the default; here it would silently allocate every client that exists today and
 * none added tomorrow, which is a different thing from being unrestricted and would
 * quietly go stale.
 */
const EsfClientAccessModal = ({ member, onClose, onSaved }) => {
  const [clients, setClients] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await axiosInstance.get('/app/esf/clients');
        setClients(res.data?.data || []);
        // Stored as an allow-list, so it loads straight in with no inversion.
        setSelected(new Set((member?.esfAllowedClients || []).map(String)));
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load the client list');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [member]);

  /**
   * The same label the Clients page shows — Zoho project, else brand, else the EF-####
   * reference. An admin should be picking by the name they already recognise, not by
   * something only this screen uses.
   */
  const labelFor = (client) => client.label
    || `${client.firstName || ''} ${client.lastName || ''}`.trim()
    || client.brandName
    || client.email
    || 'Unnamed client';

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((c) => `${labelFor(c)} ${c.brandName || ''}`.toLowerCase().includes(needle));
  }, [clients, search]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const clientIds = [...selected];
      const res = await axiosInstance.put(`/app/esf/users/${member._id}/clients`, { clientIds });
      if (res.data?.statusCode === 200) onSaved?.(member._id, clientIds);
      else setError(res.data?.message || 'Failed to save client access');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save client access');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="esf-clients-title"
    >
      <div
        className="bg-[#101722] rounded-2xl border border-white/10 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 id="esf-clients-title" className="text-lg font-semibold text-gray-100 truncate">
                Client access
              </h2>
              <p className="text-xs text-gray-500 truncate">
                Which clients {member?.firstName} {member?.lastName} can see
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
              <span className="ml-2 text-sm text-gray-400">Loading clients…</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center gap-2 flex-1 rounded-lg bg-white/[0.06] px-3 py-2">
                  <Search className="w-4 h-4 shrink-0 text-gray-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search clients"
                    className="w-full bg-transparent text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-white/10 text-gray-300 hover:bg-white/[0.05] shrink-0"
                >
                  Clear
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-3">
                <span className="text-gray-300 font-medium tabular-nums">{selected.size}</span> of{' '}
                <span className="tabular-nums">{clients.length}</span> clients allocated
              </p>

              <div className="rounded-xl border border-white/10 bg-[#0b0f17]/70 p-2 max-h-[320px] overflow-y-auto">
                {visible.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    {search ? 'No clients match.' : 'There are no clients in the portal yet.'}
                  </p>
                ) : (
                  visible.map((client) => {
                    const id = String(client._id);
                    return (
                      <label
                        key={id}
                        className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggle(id)}
                          className="w-4 h-4 rounded border-white/20 bg-white/[0.04] accent-blue-600 cursor-pointer shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm ${selected.has(id) ? 'text-gray-200' : 'text-gray-500'}`}>
                            {labelFor(client)}
                          </span>
                          {client.brandName && client.brandName !== labelFor(client) && (
                            <span className="block truncate text-[11px] text-gray-600">{client.brandName}</span>
                          )}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>

              {selected.size === 0 && (
                /* Said plainly rather than left to be discovered: an empty allocation is
                   a valid, saveable state, and it is the one that leaves someone unable
                   to work. */
                <p className="mt-3 text-xs text-amber-300/80">
                  With nothing allocated this member sees no clients at all, and an empty
                  Messages inbox.
                </p>
              )}

              <p className="mt-4 text-xs text-gray-500 border-t border-white/10 pt-4">
                Owners and admins always see every client, so this applies to members only.
                Unallocated clients are hidden from the Clients page and their conversations
                are refused by the server.
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

export default EsfClientAccessModal;
