import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { AppBrand } from '../brand/appBrand';
import type { AppTab, NavigationTab } from '../navigation/tabs';

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
  sidebarTopOffset: number;
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
  const defaultSettings: AppSettings = {
    theme: brand.theme,
    layout: {
      pageTopOffset: 42,
      contentTopOffset: 24,
      gearOuterOffset: 1.2,
      collapseIconOffset: 0,
      sidebarTopOffset: 0,
    },
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    const savedSettings = window.localStorage.getItem('sejaelevar.settings');
    const savedTheme = window.localStorage.getItem('sejaelevar.theme');

    if (!savedSettings && !savedTheme) {
      return;
    }

    try {
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings) as Partial<AppSettings>;
        setSettings({
          theme: { ...brand.theme, ...parsedSettings.theme },
          layout: { ...defaultSettings.layout, ...parsedSettings.layout },
        });
        return;
      }

      if (savedTheme) {
        setSettings({
          ...defaultSettings,
          theme: { ...brand.theme, ...JSON.parse(savedTheme) },
        });
      }
    } catch {
      window.localStorage.removeItem('sejaelevar.settings');
      window.localStorage.removeItem('sejaelevar.theme');
    }
  }, []);

  const saveSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    window.localStorage.setItem(
      'sejaelevar.settings',
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

  return (
    <div
      className={
        isSidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'
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
          '--sidebar-top-offset': `${settings.layout.sidebarTopOffset}px`,
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
          <button
            className="icon-action"
            type="button"
            aria-label={isSidebarCollapsed ? 'Mostrar menu' : 'Ocultar menu'}
            aria-pressed={isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            <CollapseIcon offset={settings.layout.collapseIconOffset} />
            <span className="collapse-label">
              {isSidebarCollapsed ? 'Mostrar menu' : 'Ocultar menu'}
            </span>
          </button>
        </div>
      </aside>

      {isSettingsOpen && (
        <section className="settings-panel" aria-label="Configurações">
          <div className="settings-heading">
            <h2>Configurações</h2>
            <button
              className="settings-close"
              type="button"
              aria-label="Fechar configurações"
              onClick={() => setIsSettingsOpen(false)}
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
              label="Ajuste do ocultar"
              min={-4}
              max={8}
              step={0.5}
              value={settings.layout.collapseIconOffset}
              onChange={(value) => updateLayout('collapseIconOffset', value)}
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
  offset: number;
};

function CollapseIcon({ offset }: CollapseIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: `translateX(${offset}px)` }}
    >
      <path d="M5 5h14v14H5V5Z" />
      <path d="M10 5v14" />
      <path d="m16 9-3 3 3 3" />
    </svg>
  );
}
