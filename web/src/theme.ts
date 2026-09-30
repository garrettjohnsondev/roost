import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'roost-theme';
/** The pre-rename key. The rename changed STORAGE_KEY and silently reset everyone's
 *  saved choice; an explicit choice made under the old name is still a choice. */
const OLD_STORAGE_KEY = 'pocket-theme';
const THEME_COLOR = { light: '#f4efe4', dark: '#0f1729' } as const;

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY);
    } catch {
      /* private mode: fall through to the default */
    }
    // The design canvas is a dark room, so that is the default. Light stays
    // available, and an explicit choice of it is honoured.
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => apply(theme), [theme]);
  // Switched from somewhere else (a chat's settings, 2026-09-30): follow it.
  useEffect(() => {
    const on = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener('roost:theme', on);
    return () => window.removeEventListener('roost:theme', on);
  }, []);

  const setTheme = (t: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    setThemeState(t);
  };

  return [theme, setTheme];
}

/** Switch the theme from anywhere; the app's useTheme follows. */
export function switchTheme(t: Theme): void {
  try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
  apply(t);
  window.dispatchEvent(new CustomEvent<Theme>('roost:theme', { detail: t }));
}
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
