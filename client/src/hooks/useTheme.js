import { useState, useEffect } from 'react';

const STORAGE_KEY = 'sellerqi-theme';

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (t) => {
    if (t === 'light' || t === 'dark') setThemeState(t);
  };

  return { theme, setTheme };
}
