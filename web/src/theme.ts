import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'roost-theme';
/** The pre-rename key. The rename changed STORAGE_KEY and silently reset everyone's
 *  saved choice; an explicit choice made under the old name is still a choice. */
const OLD_STORAGE_KEY = 'pocket-theme';
const THEME_COLOR = { light: '#f4f5f7', dark: '#0f1729' } as const;

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

  const setTheme = (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  };

  return [theme, setTheme];
}
