import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { AppBrand } from '../brand/appBrand';
import type { AppTab, NavigationIcon, NavigationTab } from '../navigation/tabs';

const SETTINGS_STORAGE_KEY = 'sejaelevar.settings';
const LEGACY_THEME_STORAGE_KEY = 'sejaelevar.theme';
const SIDEBAR_STORAGE_KEY = 'sejaelevar.sidebarCollapsed';

declare global {
  interface Window {
    SEJAELEVAR_RELEASE?: boolean;
  }
}

type AppShellProps = {
  brand: AppBrand;
  tabs: NavigationTab[];
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  children: ReactNode;
};

type ThemeSettings = AppBrand['theme'];

type LayoutSettings = {
  pageTopOffset: number;
  contentTopOffset: number;
  gearOuterOffset: number;
  collapseIconOffset: number;
  collapseLabelOffset: number;
  collapseLabelVerticalOffset: number;
  logoImageHeight: number;
  sidebarTopOffset: number;
  tabListTopOffset: number;
  tabButtonGap: number;
  actionButtonGap: number;
  menuButtonSize: number;
  iconTextGap: number;
};

type AppSettings = {
  theme: ThemeSettings;
  layout: LayoutSettings;
};

export function AppShell({
  brand,
  tabs,
  activeTab,
  onTabChange,
  children,
}: AppShellProps) {
  const isReleaseMode =
    typeof window !== 'undefined' && window.SEJAELEVAR_RELEASE === true;

  const defaultSettings: AppSettings = {
    theme: brand.theme,
    layout: {
      pageTopOffset: 51,
      contentTopOffset: 22,
      gearOuterOffset: 1.5,
      collapseIconOffset: 0,
      collapseLabelOffset: 0,
      collapseLabelVerticalOffset: -1,
      logoImageHeight: 100,
      sidebarTopOffset: 10,
      tabListTopOffset: 0,
      tabButtonGap: 20,
      actionButtonGap: 5,
      menuButtonSize: 47,
      iconTextGap: 6,
    },
  };

  const readSavedSettings = () => {
    if (typeof window === 'undefined') {
      return defaultSettings;
    }

    const savedSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const savedTheme = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);

    if (!savedSettings && !savedTheme) {
      return defaultSettings;
    }

    try {
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings) as Partial<AppSettings>;
        return {
          theme: { ...brand.theme, ...parsedSettings.theme },
          layout: { ...defaultSettings.layout, ...parsedSettings.layout },
        };
      }

      if (savedTheme) {
        return {
          ...defaultSettings,
          theme: { ...brand.theme, ...JSON.parse(savedTheme) },
        };
      }
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    }

    return defaultSettings;
  };

  const [isStartMotionDisabled, setIsStartMotionDisabled] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMiniMenuOpen, setIsMiniMenuOpen] = useState(false);
  const [isMiniMenuArmed, setIsMiniMenuArmed] = useState(true);
  const [settings, setSettings] = useState(readSavedSettings);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setIsStartMotionDisabled(false);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target =
        event.target instanceof HTMLElement ? event.target : null;

      if (
        target?.closest(
          '.search-panel, .search-toggle-action, .menu-toggle-dock',
        )
      ) {
        return;
      }

      setIsSearchOpen(false);
      if (isSidebarCollapsed) {
        setIsMiniMenuArmed(true);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isSearchOpen, isSidebarCollapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== ' ' ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target =
        event.target instanceof HTMLElement ? event.target : null;
      const isEditing =
        target?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]',
        ) !== null;

      if (isEditing) {
        return;
      }

      event.preventDefault();
      toggleSearch();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const saveSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(nextSettings),
    );
  };

  const updateColor = (key: keyof ThemeSettings, value: string) => {
    saveSettings({
      ...settings,
      theme: { ...settings.theme, [key]: value },
    });
  };

  const updateLayout = (key: keyof LayoutSettings, value: number) => {
    saveSettings({
      ...settings,
      layout: { ...settings.layout, [key]: value },
    });
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const nextCollapsed = !current;
      const shouldKeepMiniMenuOpen =
        nextCollapsed && (isSearchOpen || isSettingsOpen);
      setIsMiniMenuOpen(shouldKeepMiniMenuOpen);
      setIsMiniMenuArmed(!nextCollapsed || shouldKeepMiniMenuOpen);
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextCollapsed));
      return nextCollapsed;
    });
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    if (isSidebarCollapsed) {
      setIsMiniMenuOpen(false);
      setIsMiniMenuArmed(true);
    }
  };

  const closeSearch = () => {
    setIsSearchOpen(false);
    if (isSidebarCollapsed) {
      setIsMiniMenuOpen(false);
      setIsMiniMenuArmed(true);
    }
  };

  const toggleSearch = () => {
    setIsSearchOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setIsSettingsOpen(false);
      }
      return nextOpen;
    });
  };

  const toggleSearchFromMiniMenu = () => {
    setIsSearchOpen((current) => {
      const nextOpen = !current;
      setIsSettingsOpen(false);
      setIsMiniMenuOpen(true);

      if (!nextOpen && isSidebarCollapsed) {
        setIsMiniMenuArmed(true);
      }

      return nextOpen;
    });
  };

  const toggleSettingsFromMiniMenu = () => {
    setIsSettingsOpen((current) => {
      const nextOpen = !current;
      setIsSearchOpen(false);

      if (nextOpen) {
        setIsMiniMenuOpen(true);
        return nextOpen;
      }

      setIsMiniMenuOpen(true);
      if (isSidebarCollapsed) {
        setIsMiniMenuArmed(true);
      }
      return nextOpen;
    });
  };

  return (
    <div
      className={
        [
          'app-shell',
          isSidebarCollapsed ? 'sidebar-collapsed' : '',
          isStartMotionDisabled ? 'no-start-motion' : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
      style={
        {
          '--brand-primary': settings.theme.primary,
          '--brand-secondary': settings.theme.secondary,
          '--brand-tertiary': settings.theme.tertiary,
          '--brand-surface': settings.theme.surface,
          '--brand-text': settings.theme.text,
          '--page-top-offset': `${settings.layout.pageTopOffset}px`,
          '--content-top-offset': `${settings.layout.contentTopOffset}px`,
          '--collapse-label-offset': `${settings.layout.collapseLabelOffset}px`,
          '--collapse-label-vertical-offset': `${settings.layout.collapseLabelVerticalOffset}px`,
          '--logo-image-height': `${settings.layout.logoImageHeight}px`,
          '--sidebar-top-offset': `${settings.layout.sidebarTopOffset}px`,
          '--tab-list-top-offset': `${settings.layout.tabListTopOffset}px`,
          '--tab-button-gap': `${settings.layout.tabButtonGap}px`,
          '--action-button-gap': `${settings.layout.actionButtonGap}px`,
          '--menu-button-size': `${settings.layout.menuButtonSize}px`,
          '--icon-text-gap': `${settings.layout.iconTextGap}px`,
        } as CSSProperties
      }
    >
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-logo" aria-label={brand.organizationName}>
          {brand.logoUrl ? (
            <img className="brand-logo-image" src={brand.logoUrl} alt="" />
          ) : (
            <div className="brand-logo-text">{brand.logoText}</div>
          )}
        </div>

        <nav className="sidebar-nav" aria-label="Ferramentas">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={
                tab.id === activeTab ? 'sidebar-link active' : 'sidebar-link'
              }
              type="button"
              onClick={() => onTabChange(tab.id)}
            >
              <TabIcon icon={tab.icon} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-actions" aria-label="Ações do aplicativo">
          <button
            className="icon-action search-toggle-action"
            type="button"
            aria-label="Pesquisar"
            aria-expanded={isSearchOpen}
            onClick={toggleSearch}
          >
            <SearchIcon />
            <span>Pesquisar</span>
          </button>
          <button
            className="icon-action"
            type="button"
            aria-label="Configurações"
            aria-expanded={isSettingsOpen}
            onClick={() => {
              setIsSearchOpen(false);
              setIsSettingsOpen((current) => !current);
            }}
          >
            <GearIcon outerOffset={settings.layout.gearOuterOffset} />
            <span>Configurações</span>
          </button>
        </div>
      </aside>

      <div
        className={
          isMiniMenuOpen
            ? 'menu-toggle-dock mini-menu-open'
            : 'menu-toggle-dock'
        }
        aria-label="Controle do menu"
        onMouseLeave={() => {
          if (isSearchOpen || isSettingsOpen) {
            return;
          }

          setIsMiniMenuOpen(false);
          if (isSidebarCollapsed) {
            setIsMiniMenuArmed(true);
          }
        }}
      >
        <div className="menu-toggle-popover" aria-label="Ferramentas">
          {tabs.map((tab) => (
            <div className="mini-menu-button-crop tab-crop" key={tab.id}>
              <button
                className={
                  tab.id === activeTab ? 'sidebar-link active' : 'sidebar-link'
                }
              type="button"
              aria-label={tab.label}
              title={tab.label}
              onClick={() => {
                onTabChange(tab.id);
              }}
            >
              <TabIcon icon={tab.icon} />
              <span>{tab.label}</span>
            </button>
            </div>
          ))}
          <div className="mini-menu-button-crop action-crop">
            <button
              className="icon-action search-toggle-action"
              type="button"
              aria-label="Pesquisar"
              title="Pesquisar"
              aria-expanded={isSearchOpen}
              onClick={() => {
                setIsMiniMenuArmed(false);
                toggleSearchFromMiniMenu();
              }}
            >
              <SearchIcon />
              <span>Pesquisar</span>
            </button>
          </div>
          <div className="mini-menu-button-crop action-crop">
            <button
              className="icon-action"
              type="button"
              aria-label="Configurações"
            title="Configurações"
            aria-expanded={isSettingsOpen}
            onClick={() => {
              setIsMiniMenuArmed(false);
              toggleSettingsFromMiniMenu();
            }}
          >
              <GearIcon outerOffset={settings.layout.gearOuterOffset} />
              <span>Configurações</span>
            </button>
          </div>
        </div>

        <button
          className="menu-toggle-button"
          type="button"
          aria-label={isSidebarCollapsed ? 'Mostrar menu' : 'Ocultar menu'}
          aria-pressed={isSidebarCollapsed}
          onMouseEnter={() => {
            if (isSidebarCollapsed && isMiniMenuArmed) {
              setIsMiniMenuOpen(true);
            }
          }}
          onClick={toggleSidebar}
        >
          <CollapseIcon
            direction={isSidebarCollapsed ? 'show' : 'hide'}
            offset={settings.layout.collapseIconOffset}
          />
          <span className="collapse-label">Ocultar</span>
        </button>
      </div>

      {isSearchOpen && (
        <section className="search-panel" aria-label="Pesquisar">
          <input
            autoFocus
            aria-label="Pesquisar"
            type="search"
            value={searchTerm}
            placeholder="Pesquisar"
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closeSearch();
              }
            }}
          />
        </section>
      )}

      {isSettingsOpen && (
        <section className="settings-panel" aria-label="Configurações">
          <div className="settings-heading">
            <h2>Configurações</h2>
            <button
              className="settings-close"
              type="button"
              aria-label="Fechar configurações"
              onClick={closeSettings}
            >
              <CloseIcon />
            </button>
          </div>

          <div className="settings-fields">
            <ColorField
              label="Cor principal"
              value={settings.theme.primary}
              onChange={(value) => updateColor('primary', value)}
            />
            <ColorField
              label="Cor secundária"
              value={settings.theme.secondary}
              onChange={(value) => updateColor('secondary', value)}
            />
            <ColorField
              label="Fundo do menu"
              value={settings.theme.tertiary}
              onChange={(value) => updateColor('tertiary', value)}
            />
            {!isReleaseMode && (
              <>
            <SliderField
              label="Altura do título"
              min={20}
              max={80}
              step={1}
              value={settings.layout.pageTopOffset}
              onChange={(value) => updateLayout('pageTopOffset', value)}
            />
            <SliderField
              label="Altura do conteúdo"
              min={0}
              max={90}
              step={1}
              value={settings.layout.contentTopOffset}
              onChange={(value) => updateLayout('contentTopOffset', value)}
            />
            <SliderField
              label="Ajuste da engrenagem"
              min={-1}
              max={4}
              step={0.1}
              value={settings.layout.gearOuterOffset}
              onChange={(value) => updateLayout('gearOuterOffset', value)}
            />
            <SliderField
              label="Ajuste do ícone ocultar"
              min={-4}
              max={8}
              step={0.5}
              value={settings.layout.collapseIconOffset}
              onChange={(value) => updateLayout('collapseIconOffset', value)}
            />
            <SliderField
              label="Ajuste horizontal do texto ocultar"
              min={-16}
              max={16}
              step={0.5}
              value={settings.layout.collapseLabelOffset}
              onChange={(value) => updateLayout('collapseLabelOffset', value)}
            />
            <SliderField
              label="Altura do texto ocultar"
              min={-10}
              max={10}
              step={0.5}
              value={settings.layout.collapseLabelVerticalOffset}
              onChange={(value) =>
                updateLayout('collapseLabelVerticalOffset', value)
              }
            />
            <SliderField
              label="Altura da logo"
              min={72}
              max={132}
              step={1}
              value={settings.layout.logoImageHeight}
              onChange={(value) => updateLayout('logoImageHeight', value)}
            />
            <SliderField
              label="Início das abas"
              min={-24}
              max={80}
              step={1}
              value={settings.layout.tabListTopOffset}
              onChange={(value) => updateLayout('tabListTopOffset', value)}
            />
            <SliderField
              label="Descer menu"
              min={0}
              max={80}
              step={1}
              value={settings.layout.sidebarTopOffset}
              onChange={(value) => updateLayout('sidebarTopOffset', value)}
            />
            <SliderField
              label="Espaço entre abas"
              min={0}
              max={36}
              step={1}
              value={settings.layout.tabButtonGap}
              onChange={(value) => updateLayout('tabButtonGap', value)}
            />
            <SliderField
              label="Espaço botões inferiores"
              min={0}
              max={24}
              step={1}
              value={settings.layout.actionButtonGap}
              onChange={(value) => updateLayout('actionButtonGap', value)}
            />
            <SliderField
              label="Altura dos botões"
              min={42}
              max={58}
              step={1}
              value={settings.layout.menuButtonSize}
              onChange={(value) => updateLayout('menuButtonSize', value)}
            />
            <SliderField
              label="Espaço ícone/texto"
              min={0}
              max={18}
              step={1}
              value={settings.layout.iconTextGap}
              onChange={(value) => updateLayout('iconTextGap', value)}
            />
            <details className="settings-export">
              <summary>Valores atuais</summary>
              <textarea readOnly value={JSON.stringify(settings, null, 2)} />
            </details>
              </>
            )}
          </div>
        </section>
      )}

      <main className="app-content">{children}</main>
    </div>
  );
}

type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function ColorField({ label, value, onChange }: ColorFieldProps) {
  return (
    <div className="color-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

type SliderFieldProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: SliderFieldProps) {
  return (
    <label className="slider-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}</output>
    </label>
  );
}

type TabIconProps = {
  icon: NavigationIcon;
};

function TabIcon({ icon }: TabIconProps) {
  switch (icon) {
    case 'people':
      return <PeopleIcon />;
    case 'book':
      return <BookIcon />;
    case 'brain':
      return <BrainIcon />;
    case 'apple':
      return <AppleIcon />;
    case 'building':
      return <BuildingIcon />;
    case 'calendar':
      return <CalendarIcon />;
    case 'document':
      return <DocumentIcon />;
    case 'person':
    default:
      return <PersonIcon />;
  }
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
      <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
      <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
      <path d="M3 6l0 13" />
      <path d="M12 6l0 13" />
      <path d="M21 6l0 13" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8" />
      <path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8" />
      <path d="M17.5 16a3.5 3.5 0 0 0 0 -7h-.5" />
      <path d="M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0" />
      <path d="M6.5 16a3.5 3.5 0 0 1 0 -7h.5" />
      <path d="M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11.319c0 3.102 .444 5.319 2.222 7.978c1.351 1.797 3.156 2.247 5.08 .988c.426 -.268 .97 -.268 1.397 0c1.923 1.26 3.728 .809 5.079 -.988c1.778 -2.66 2.222 -4.876 2.222 -7.977c0 -2.661 -1.99 -5.32 -4.444 -5.32c-1.267 0 -2.41 .693 -3.22 1.44a.5 .5 0 0 1 -.672 0c-.809 -.746 -1.953 -1.44 -3.22 -1.44c-2.454 0 -4.444 2.66 -4.444 5.319" />
      <path d="M7 12c0 -1.47 .454 -2.34 1.5 -3" />
      <path d="M12 7c0 -1.2 .867 -4 3 -4" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 9l5 5v7h-5v-4m0 4h-5v-7l5 -5m1 1v-6a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v17h-8" />
      <path d="M13 7l0 .01" />
      <path d="M17 7l0 .01" />
      <path d="M17 11l0 .01" />
      <path d="M17 15l0 .01" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M4 11h16" />
      <path d="M7 14h.013" />
      <path d="M10.01 14h.005" />
      <path d="M13.01 14h.005" />
      <path d="M16.015 14h.005" />
      <path d="M13.015 17h.005" />
      <path d="M7.01 17h.005" />
      <path d="M10.01 17h.005" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" />
      <path d="M9 17h6" />
      <path d="M9 13h6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
      <path d="M21 21l-6 -6" />
    </svg>
  );
}

type GearIconProps = {
  outerOffset: number;
};

function GearIcon({ outerOffset }: GearIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" />
      <g transform={`translate(${outerOffset} 0)`}>
        <path d="M19.8 13.4v-2.8l-2.1-.5a6.4 6.4 0 0 0-.7-1.6l1.1-1.8-2.4-2.4-1.8 1.1a6.4 6.4 0 0 0-1.6-.7l-.5-2.1H9l-.5 2.1a6.4 6.4 0 0 0-1.6.7L5.1 4.3 2.7 6.7l1.1 1.8a6.4 6.4 0 0 0-.7 1.6l-2.1.5v2.8l2.1.5c.2.6.4 1.1.7 1.6l-1.1 1.8 2.4 2.4 1.8-1.1c.5.3 1 .5 1.6.7l.5 2.1h2.8l.5-2.1c.6-.2 1.1-.4 1.6-.7l1.8 1.1 2.4-2.4-1.1-1.8c.3-.5.5-1 .7-1.6l2.1-.5Z" />
      </g>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 7 10 10" />
      <path d="m17 7-10 10" />
    </svg>
  );
}

type CollapseIconProps = {
  direction?: 'hide' | 'show';
  offset: number;
};

function CollapseIcon({ direction = 'hide', offset }: CollapseIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: `translateX(${offset}px)` }}
    >
      <path d="M5 5h14v14H5V5Z" />
      <path d="M10 5v14" />
      <path d={direction === 'hide' ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3'} />
    </svg>
  );
}
