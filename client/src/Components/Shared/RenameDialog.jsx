import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Loader2, X as XIcon } from 'lucide-react';

// Panel colours per surface, so the dialog matches the page that opens it.
const TONES = {
  seller: { panel: 'bg-[#161b22] border-[#30363d]', input: 'bg-[#21262d] border-[#30363d]', button: 'border-[#30363d]' },
  esf: { panel: 'bg-[#101722] border-white/10', input: 'bg-white/[0.04] border-white/10', button: 'border-white/10' },
};

/**
 * In-page "set name" dialog, replacing window.prompt for renaming a member.
 * An empty name is allowed (it clears the name); otherwise at least 2 characters.
 *
 * onSave(name) should return a promise; reject it with an Error to show its
 * message in the dialog, resolve it to close.
 */
const RenameDialog = ({ open, title, description, initialValue = '', placeholder = 'Name', tone = 'seller', onCancel, onSave }) => {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const theme = TONES[tone] || TONES.seller;

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError('');
    setSaving(false);
    // After the portal mounts.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, saving, onCancel]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const name = value.trim();
    if (name && name.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(name);
    } catch (err) {
      setError(err?.message || 'Could not update the name');
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => !saving && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${theme.panel}`}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center shrink-0">
              <Pencil className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h3 id="rename-dialog-title" className="text-base font-semibold text-gray-100">{title}</h3>
              {description && <p className="text-xs text-gray-500 break-all">{description}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 disabled:opacity-50"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          maxLength={50}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          placeholder={placeholder}
          className={`w-full px-3 py-2.5 rounded-lg border text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition ${theme.input} ${error ? 'border-red-500' : ''}`}
        />
        {error ? (
          <p className="text-xs text-red-400 mt-1.5">{error}</p>
        ) : (
          <p className="text-xs text-gray-500 mt-1.5">Leave empty to show their email address instead.</p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border text-gray-300 hover:bg-white/[0.05] transition-colors disabled:opacity-50 ${theme.button}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};

export default RenameDialog;
