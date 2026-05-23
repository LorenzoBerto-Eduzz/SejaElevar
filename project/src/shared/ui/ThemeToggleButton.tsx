import { useEffect, useState } from 'react';

const DARK_MODE_STORAGE_KEY = 'sejaelevar.darkMode';
const THEME_CHANGE_EVENT = 'sejaelevar:theme-change';

const readDarkMode = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(DARK_MODE_STORAGE_KEY) === 'true';
};

const applyDarkMode = (isDarkMode: boolean) => {
  document.documentElement.classList.toggle('dark-mode', isDarkMode);
  window.localStorage.setItem(DARK_MODE_STORAGE_KEY, String(isDarkMode));
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, { detail: { isDarkMode } }),
  );
};

export function ThemeToggleButton() {
  const [isDarkMode, setIsDarkMode] = useState(readDarkMode);

  useEffect(() => {
    applyDarkMode(isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const nextDarkMode = (event as CustomEvent<{ isDarkMode: boolean }>).detail
        ?.isDarkMode;

      if (typeof nextDarkMode === 'boolean') {
        setIsDarkMode(nextDarkMode);
      }
    };

    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);

    return () => window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
  }, []);

  const toggleDarkMode = () => {
    document.documentElement.classList.add('theme-switching');
    setIsDarkMode((current) => !current);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.documentElement.classList.remove('theme-switching');
      });
    });
  };

  return (
    <button
      className={
        isDarkMode ? 'square-action theme-toggle active' : 'square-action theme-toggle'
      }
      type="button"
      aria-label="Ativar modo escuro"
      aria-pressed={isDarkMode}
      title="Ativar Modo Escuro"
      onClick={toggleDarkMode}
    >
      {isDarkMode ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.828 14.828a4 4 0 1 0 -5.656 -5.656a4 4 0 0 0 5.656 5.656" />
      <path d="M6.343 17.657l-1.414 1.414" />
      <path d="M6.343 6.343l-1.414 -1.414" />
      <path d="M17.657 6.343l1.414 -1.414" />
      <path d="M17.657 17.657l1.414 1.414" />
      <path d="M4 12h-2" />
      <path d="M12 4v-2" />
      <path d="M20 12h2" />
      <path d="M12 20v2" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" />
      <path d="M17 4a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2" />
      <path d="M19 11h2m-1 -1v2" />
    </svg>
  );
}
