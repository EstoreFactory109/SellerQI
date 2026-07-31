import React from 'react';

export default function ProductUpdateCheckbox({ checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded cursor-pointer"
        style={{ accentColor: '#3b82f6', background: '#1a1a1a', border: '1px solid #30363d' }}
      />
      Send me product updates and feature announcements.
    </label>
  );
}
