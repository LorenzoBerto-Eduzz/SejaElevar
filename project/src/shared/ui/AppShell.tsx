import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { AppBrand } from '../brand/appBrand';
import type { AppTab, NavigationTab } from '../navigation/tabs';

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
  logoImageHeight: number;
  sidebarTopOffset: number;
  tabListTopOffset: number;
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
      pageTopOffset: 42,
      contentTopOffset: 24,
      gearOuterOffset: 1.2,
      collapseIconOffset: 0,
      collapseLabelOffset: 0,
      logoImageHeight: 102,
      sidebarTopOffset: 0,
      tabListTopOffset: 0,
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
    setIsMiniMenuOpen(false);
    setIsSidebarCollapsed((current) => {
      const nextCollapsed = !current;
      setIsMiniMenuArmed(!nextCollapsed);
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

  const toggleSettingsFromMiniMenu = () => {
    setIsSettingsOpen((current) => {
      const nextOpen = !current;

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
          '--logo-image-height': `${settings.layout.logoImageHeight}px`,
          '--sidebar-top-offset': `${settings.layout.sidebarTopOffset}px`,
          '--tab-list-top-offset': `${settings.layout.tabListTopOffset}px`,
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
              <PersonIcon />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-actions" aria-label="Ações do aplicativo">
          <button
            className="icon-action"
            type="button"
            aria-label="Configurações"
            aria-expanded={isSettingsOpen}
            onClick={() => setIsSettingsOpen((current) => !current)}
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
          if (isSettingsOpen) {
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
                if (!isSettingsOpen) {
                  setIsMiniMenuArmed(false);
                  setIsMiniMenuOpen(false);
                }
              }}
            >
              <PersonIcon />
              <span>{tab.label}</span>
            </button>
            </div>
          ))}
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

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" />
      <path d="M4.6 20.4c.8-3.5 3.6-5.6 7.4-5.6s6.6 2.1 7.4 5.6" />
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
