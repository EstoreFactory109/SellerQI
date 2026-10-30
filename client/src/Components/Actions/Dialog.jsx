import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { COLORS } from '../Shared/index.js';

/** A plain dialog frame for forms that prepare a change (the change itself is approved in ChangeRequestModal). */
const Dialog = ({ title, subtitle, onClose, children, footer, wide = false, labelId = 'action-dialog-title' }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl border shadow-2xl max-h-[90vh] flex flex-col`}
        style={{ background: COLORS.surface, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2 id={labelId} className="m-0 text-lg font-semibold" style={{ color: COLORS.textPrimary }}>{title}</h2>
            {subtitle && <p className="m-0 mt-1 text-xs" style={{ color: COLORS.textSecondary }}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg border flex-shrink-0" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>
            <X size={16} />
          </button>
        </div>
        <div className="px-6 pt-4 pb-2 overflow-y-auto min-h-0">{children}</div>
        {footer && <div className="px-6 pt-3 pb-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

export const fieldStyle = { borderColor: COLORS.border, background: COLORS.surfaceElevated, color: COLORS.textPrimary };
export const Field = ({ label, htmlFor, hint, children }) => (
  <div className="flex flex-col gap-1.5 min-w-0">
    <label htmlFor={htmlFor} className="text-xs font-semibold" style={{ color: COLORS.textSecondary }}>{label}</label>
    {children}
    {hint && <p className="m-0 text-xs" style={{ color: COLORS.textMuted }}>{hint}</p>}
  </div>
);
export const PrimaryButton = ({ children, disabled, onClick, type = 'button' }) => (
  <button type={type} onClick={onClick} disabled={disabled} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021', opacity: disabled ? 0.6 : 1 }}>{children}</button>
);
export const SecondaryButton = ({ children, onClick, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>{children}</button>
);

export default Dialog;
