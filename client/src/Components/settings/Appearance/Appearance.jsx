import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme.js';

export default function Appearance() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Appearance
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Choose how SellerQI looks for you. Your preference is saved across sessions.
        </p>
      </div>

      <div
        className="flex items-center justify-between p-4 rounded-lg border"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-dark)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Theme
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Select a light or dark interface.
          </p>
        </div>

        <div
          className="flex rounded-md overflow-hidden border"
          style={{ borderColor: 'var(--border-dark)', background: 'var(--bg-elevated)' }}
        >
          <button
            onClick={() => setTheme('dark')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all duration-200"
            style={{
              background: theme === 'dark' ? 'var(--accent)' : 'transparent',
              color: theme === 'dark' ? '#ffffff' : 'var(--text-secondary)',
            }}
          >
            <Moon className="w-3.5 h-3.5" />
            Dark
          </button>
          <button
            onClick={() => setTheme('light')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all duration-200"
            style={{
              background: theme === 'light' ? 'var(--accent)' : 'transparent',
              color: theme === 'light' ? '#ffffff' : 'var(--text-secondary)',
            }}
          >
            <Sun className="w-3.5 h-3.5" />
            Light
          </button>
        </div>
      </div>
    </div>
  );
}
