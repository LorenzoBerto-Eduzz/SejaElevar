import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { AppBrand } from '../brand/appBrand';
import type { AppTab, NavigationIcon, NavigationTab } from '../navigation/tabs';
import {
  createDefaultAppSettings,
  readSavedAppSettings,
  SETTINGS_STORAGE_KEY,
  type AppSettings,
  type DarkThemeSettings,
  type LayoutSettings,
  type ThemeSettings,
} from './appShellSettings';

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

export function AppShell({
  brand,
  tabs,
  activeTab,
  onTabChange,
  children,
}: AppShellProps) {
  const isReleaseMode =
    typeof window !== 'undefined' && window.SEJAELEVAR_RELEASE === true;
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
  const [settings, setSettings] = useState(() => readSavedAppSettings(brand));
  const defaultSettings = createDefaultAppSettings(brand);

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
        event.key.toLowerCase() !== 'e' ||
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
    const settingsToSave = {
      ...nextSettings,
      version: defaultSettings.version,
    };

    setSettings(settingsToSave);
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(settingsToSave),
    );
  };

  const updateColor = (key: keyof ThemeSettings, value: string) => {
    saveSettings({
      ...settings,
      theme: { ...settings.theme, [key]: value },
    });
  };

  const updateDarkColor = (key: keyof DarkThemeSettings, value: string) => {
    saveSettings({
      ...settings,
      darkTheme: { ...settings.darkTheme, [key]: value },
    });
  };

  const updateLayout = (key: keyof LayoutSettings, value: number) => {
    saveSettings({
      ...settings,
      layout: { ...settings.layout, [key]: value },
    });
  };

  const resetColor = (key: keyof ThemeSettings) => {
    updateColor(key, defaultSettings.theme[key]);
  };

  const resetDarkColor = (key: keyof DarkThemeSettings) => {
    updateDarkColor(key, defaultSettings.darkTheme[key]);
  };

  const resetLayout = (key: keyof LayoutSettings) => {
    updateLayout(key, defaultSettings.layout[key]);
  };

  const updateLightPrimary = (value: string) => {
    saveSettings({
      ...settings,
      theme: { ...settings.theme, primary: value },
    });
  };

  const updateLightSecondary = (value: string) => {
    saveSettings({
      ...settings,
      theme: {
        ...settings.theme,
        secondary: value,
        tertiary: value,
        hover: value,
      },
    });
  };

  const updateDarkPrimary = (value: string) => {
    saveSettings({
      ...settings,
      darkTheme: { ...settings.darkTheme, primary: value },
    });
  };

  const updateDarkSecondary = (value: string) => {
    saveSettings({
      ...settings,
      darkTheme: {
        ...settings.darkTheme,
        secondary: value,
        menu: value,
        hover: value,
      },
    });
  };

  useEffect(() => {
    const syncWindowTheme = () => {
      const isDarkMode = document.documentElement.classList.contains('dark-mode');
      const activeTheme = isDarkMode ? settings.darkTheme : settings.theme;

      void fetch('/api/app/window-theme', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          darkMode: isDarkMode,
          backgroundColor: activeTheme.surface,
          titleBarColor: activeTheme.titleBar,
          titleTextColor: activeTheme.titleBarText,
        }),
      }).catch(() => {
        // Browser preview can run without the local Windows title-bar bridge.
      });
    };

    syncWindowTheme();

    const observer = new MutationObserver(syncWindowTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, [settings]);

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

  const handleMenuToggleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isSidebarCollapsed && !isMiniMenuOpen) {
      const icon = event.currentTarget.querySelector('svg');
      const iconBounds = icon?.getBoundingClientRect();

      if (
        !iconBounds ||
        event.clientX < iconBounds.left ||
        event.clientX > iconBounds.right ||
        event.clientY < iconBounds.top ||
        event.clientY > iconBounds.bottom
      ) {
        return;
      }
    }

    toggleSidebar();
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
          '--light-primary': settings.theme.primary,
          '--light-secondary': settings.theme.secondary,
          '--light-menu': settings.theme.tertiary,
          '--light-surface': settings.theme.surface,
          '--light-text': settings.theme.text,
          '--light-panel': settings.theme.panel,
          '--light-line': settings.theme.line,
          '--light-hover': settings.theme.hover,
          '--light-border': settings.theme.border,
          '--light-scroll-track': settings.theme.scrollTrack,
          '--light-scroll-thumb': settings.theme.scrollThumb,
          '--light-title-bar': settings.theme.titleBar,
          '--light-title-bar-text': settings.theme.titleBarText,
          '--light-active-icon': settings.theme.activeIcon,
          '--light-active-text': settings.theme.activeText,
          '--light-header-text': settings.theme.headerText,
          '--light-delete-hint': settings.theme.deleteHint,
          '--dark-primary': settings.darkTheme.primary,
          '--dark-secondary': settings.darkTheme.secondary,
          '--dark-menu': settings.darkTheme.menu,
          '--dark-surface': settings.darkTheme.surface,
          '--dark-panel': settings.darkTheme.panel,
          '--dark-text': settings.darkTheme.text,
          '--dark-line': settings.darkTheme.line,
          '--dark-hover': settings.darkTheme.hover,
          '--dark-border': settings.darkTheme.border,
          '--dark-scroll-track': settings.darkTheme.scrollTrack,
          '--dark-scroll-thumb': settings.darkTheme.scrollThumb,
          '--dark-title-bar': settings.darkTheme.titleBar,
          '--dark-title-bar-text': settings.darkTheme.titleBarText,
          '--dark-active-icon': settings.darkTheme.activeIcon,
          '--dark-active-text': settings.darkTheme.activeText,
          '--dark-header-text': settings.darkTheme.headerText,
          '--dark-delete-hint': settings.darkTheme.deleteHint,
          '--page-top-offset': `${settings.layout.pageTopOffset}px`,
          '--content-top-offset': `${settings.layout.contentTopOffset}px`,
          '--collapse-label-offset': `${settings.layout.collapseLabelOffset}px`,
          '--collapse-label-vertical-offset': `${settings.layout.collapseLabelVerticalOffset}px`,
          '--collapse-button-vertical-offset': `${settings.layout.collapseButtonVerticalOffset}px`,
          '--lower-actions-vertical-offset': `${settings.layout.lowerActionsVerticalOffset}px`,
          '--logo-image-height': `${settings.layout.logoImageHeight}px`,
          '--sidebar-top-offset': `${settings.layout.sidebarTopOffset}px`,
          '--tab-list-top-offset': `${settings.layout.tabListTopOffset}px`,
          '--tab-button-gap': `${settings.layout.tabButtonGap}px`,
          '--action-button-gap': `${settings.layout.actionButtonGap}px`,
          '--menu-toggle-bottom': `${settings.layout.menuToggleBottom}px`,
          '--menu-button-size': `${settings.layout.menuButtonSize}px`,
          '--icon-text-gap': `${settings.layout.iconTextGap}px`,
          '--feature-heading-vertical-offset': `${settings.layout.featureHeadingVerticalOffset}px`,
          '--table-row-height': `${settings.layout.tableRowHeight}px`,
          '--table-header-height': `${settings.layout.tableHeaderHeight}px`,
          '--table-top-offset': `${settings.layout.tableTopOffset}px`,
          '--table-height-offset': `${settings.layout.tableHeightOffset}px`,
          '--row-details-panel-width': `${settings.layout.rowDetailsPanelWidth}px`,
          '--row-details-panel-height': `${settings.layout.rowDetailsPanelHeight}px`,
          '--row-details-field-horizontal-offset': `${settings.layout.rowDetailsFieldHorizontalOffset}px`,
          '--row-details-layer-gap': `${settings.layout.rowDetailsLayerGap}px`,
          '--row-details-name-width': `${settings.layout.rowDetailsNameWidth}px`,
          '--row-details-sex-width': `${settings.layout.rowDetailsSexWidth}px`,
          '--row-details-birthdate-width': `${settings.layout.rowDetailsBirthdateWidth}px`,
          '--row-details-age-width': `${settings.layout.rowDetailsAgeWidth}px`,
          '--row-details-email-width': `${settings.layout.rowDetailsEmailWidth}px`,
          '--row-details-contact-width': `${settings.layout.rowDetailsContactWidth}px`,
          '--row-details-rg-width': `${settings.layout.rowDetailsRgWidth}px`,
          '--row-details-cpf-width': `${settings.layout.rowDetailsCpfWidth}px`,
          '--row-details-responsible-name-width': `${settings.layout.rowDetailsResponsibleNameWidth}px`,
          '--row-details-responsible-email-width': `${settings.layout.rowDetailsResponsibleEmailWidth}px`,
          '--row-details-responsible-contact-width': `${settings.layout.rowDetailsResponsibleContactWidth}px`,
          '--row-details-address-width': `${settings.layout.rowDetailsAddressWidth}px`,
          '--row-details-company-width': `${settings.layout.rowDetailsCompanyWidth}px`,
          '--row-details-institution-width': `${settings.layout.rowDetailsInstitutionWidth}px`,
          '--row-details-learning-arc-width': `${settings.layout.rowDetailsLearningArcWidth}px`,
          '--row-details-role-width': `${settings.layout.rowDetailsRoleWidth}px`,
          '--row-details-admission-date-width': `${settings.layout.rowDetailsAdmissionDateWidth}px`,
          '--row-details-end-date-width': `${settings.layout.rowDetailsEndDateWidth}px`,
          '--row-details-class-width': `${settings.layout.rowDetailsClassWidth}px`,
          '--row-details-close-icon-horizontal-offset': `${settings.layout.rowDetailsCloseIconHorizontalOffset}px`,
          '--settings-close-icon-horizontal-offset': `${settings.layout.settingsCloseIconHorizontalOffset}px`,
          '--arcos-column-width': `${settings.layout.arcosColumnWidth}px`,
          '--arcos-column-gap': `${settings.layout.arcosColumnGap}px`,
          '--arcos-first-module-gap': `${settings.layout.arcosFirstModuleGap}px`,
          '--arcos-module-gap': `${settings.layout.arcosModuleGap}px`,
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
          title={isSidebarCollapsed ? 'Abrir Menu' : undefined}
          onMouseEnter={() => {
            if (isSidebarCollapsed && isMiniMenuArmed) {
              setIsMiniMenuOpen(true);
            }
          }}
          onClick={handleMenuToggleClick}
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
              label="Cor Primária - Modo Claro"
              value={settings.theme.primary}
              onChange={updateLightPrimary}
              onReset={() => resetColor('primary')}
            />
            <ColorField
              label="Cor Secundária - Modo Claro"
              value={settings.theme.tertiary}
              onChange={updateLightSecondary}
              onReset={() => updateLightSecondary(defaultSettings.theme.tertiary)}
            />
            <ColorField
              label="Cor Primária - Modo Escuro"
              value={settings.darkTheme.primary}
              onChange={updateDarkPrimary}
              onReset={() => resetDarkColor('primary')}
            />
            <ColorField
              label="Cor Secundária - Modo Escuro"
              value={settings.darkTheme.menu}
              onChange={updateDarkSecondary}
              onReset={() => updateDarkSecondary(defaultSettings.darkTheme.menu)}
            />
            <ColorField
              label="Dia painel/tabela"
              value={settings.theme.panel}
              onChange={(value) => updateColor('panel', value)}
              onReset={() => resetColor('panel')}
            />
            <ColorField
              label="Dia texto"
              value={settings.theme.text}
              onChange={(value) => updateColor('text', value)}
              onReset={() => resetColor('text')}
            />
            <ColorField
              label="Dia linhas"
              value={settings.theme.line}
              onChange={(value) => updateColor('line', value)}
              onReset={() => resetColor('line')}
            />
            <ColorField
              label="Dia hover"
              value={settings.theme.hover}
              onChange={(value) => updateColor('hover', value)}
              onReset={() => resetColor('hover')}
            />
            <ColorField
              label="Dia contorno"
              value={settings.theme.border}
              onChange={(value) => updateColor('border', value)}
              onReset={() => resetColor('border')}
            />
            <ColorField
              label="Dia scroll fundo"
              value={settings.theme.scrollTrack}
              onChange={(value) => updateColor('scrollTrack', value)}
              onReset={() => resetColor('scrollTrack')}
            />
            <ColorField
              label="Dia scroll"
              value={settings.theme.scrollThumb}
              onChange={(value) => updateColor('scrollThumb', value)}
              onReset={() => resetColor('scrollThumb')}
            />
            <ColorField
              label="Dia barra janela"
              value={settings.theme.titleBar}
              onChange={(value) => updateColor('titleBar', value)}
              onReset={() => resetColor('titleBar')}
            />
            <ColorField
              label="Dia texto janela"
              value={settings.theme.titleBarText}
              onChange={(value) => updateColor('titleBarText', value)}
              onReset={() => resetColor('titleBarText')}
            />
            <ColorField
              label="Dia ícone ativo"
              value={settings.theme.activeIcon}
              onChange={(value) => updateColor('activeIcon', value)}
              onReset={() => resetColor('activeIcon')}
            />
            <ColorField
              label="Dia texto ativo"
              value={settings.theme.activeText}
              onChange={(value) => updateColor('activeText', value)}
              onReset={() => resetColor('activeText')}
            />
            <ColorField
              label="Dia texto cabeçalho"
              value={settings.theme.headerText}
              onChange={(value) => updateColor('headerText', value)}
              onReset={() => resetColor('headerText')}
            />
            <ColorField
              label="Escuro principal"
              value={settings.darkTheme.primary}
              onChange={(value) => updateDarkColor('primary', value)}
              onReset={() => resetDarkColor('primary')}
            />
            <ColorField
              label="Escuro secundária"
              value={settings.darkTheme.secondary}
              onChange={(value) => updateDarkColor('secondary', value)}
              onReset={() => resetDarkColor('secondary')}
            />
            <ColorField
              label="Escuro menu"
              value={settings.darkTheme.menu}
              onChange={(value) => updateDarkColor('menu', value)}
              onReset={() => resetDarkColor('menu')}
            />
            <ColorField
              label="Escuro fundo"
              value={settings.darkTheme.surface}
              onChange={(value) => updateDarkColor('surface', value)}
              onReset={() => resetDarkColor('surface')}
            />
            <ColorField
              label="Escuro painel"
              value={settings.darkTheme.panel}
              onChange={(value) => updateDarkColor('panel', value)}
              onReset={() => resetDarkColor('panel')}
            />
            <ColorField
              label="Escuro texto"
              value={settings.darkTheme.text}
              onChange={(value) => updateDarkColor('text', value)}
              onReset={() => resetDarkColor('text')}
            />
            <ColorField
              label="Escuro linhas"
              value={settings.darkTheme.line}
              onChange={(value) => updateDarkColor('line', value)}
              onReset={() => resetDarkColor('line')}
            />
            <ColorField
              label="Escuro hover"
              value={settings.darkTheme.hover}
              onChange={(value) => updateDarkColor('hover', value)}
              onReset={() => resetDarkColor('hover')}
            />
            <ColorField
              label="Escuro contorno"
              value={settings.darkTheme.border}
              onChange={(value) => updateDarkColor('border', value)}
              onReset={() => resetDarkColor('border')}
            />
            <ColorField
              label="Escuro scroll fundo"
              value={settings.darkTheme.scrollTrack}
              onChange={(value) => updateDarkColor('scrollTrack', value)}
              onReset={() => resetDarkColor('scrollTrack')}
            />
            <ColorField
              label="Escuro scroll"
              value={settings.darkTheme.scrollThumb}
              onChange={(value) => updateDarkColor('scrollThumb', value)}
              onReset={() => resetDarkColor('scrollThumb')}
            />
            <ColorField
              label="Escuro barra janela"
              value={settings.darkTheme.titleBar}
              onChange={(value) => updateDarkColor('titleBar', value)}
              onReset={() => resetDarkColor('titleBar')}
            />
            <ColorField
              label="Escuro texto janela"
              value={settings.darkTheme.titleBarText}
              onChange={(value) => updateDarkColor('titleBarText', value)}
              onReset={() => resetDarkColor('titleBarText')}
            />
            <ColorField
              label="Escuro ícone ativo"
              value={settings.darkTheme.activeIcon}
              onChange={(value) => updateDarkColor('activeIcon', value)}
              onReset={() => resetDarkColor('activeIcon')}
            />
            <ColorField
              label="Escuro texto ativo"
              value={settings.darkTheme.activeText}
              onChange={(value) => updateDarkColor('activeText', value)}
              onReset={() => resetDarkColor('activeText')}
            />
            <ColorField
              label="Escuro texto cabeçalho"
              value={settings.darkTheme.headerText}
              onChange={(value) => updateDarkColor('headerText', value)}
              onReset={() => resetDarkColor('headerText')}
            />
            {!isReleaseMode && (
              <>
                <SliderField
                  label="Arcos largura"
                  min={180}
                  max={520}
                  step={1}
                  value={settings.layout.arcosColumnWidth}
                  onChange={(value) => updateLayout('arcosColumnWidth', value)}
                  onReset={() => resetLayout('arcosColumnWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Arcos gap"
                  min={0}
                  max={80}
                  step={1}
                  value={settings.layout.arcosColumnGap}
                  onChange={(value) => updateLayout('arcosColumnGap', value)}
                  onReset={() => resetLayout('arcosColumnGap')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Arcos primeiro gap"
                  min={0}
                  max={56}
                  step={1}
                  value={settings.layout.arcosFirstModuleGap}
                  onChange={(value) => updateLayout('arcosFirstModuleGap', value)}
                  onReset={() => resetLayout('arcosFirstModuleGap')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Arcos mÃ³dulos gap"
                  min={0}
                  max={40}
                  step={1}
                  value={settings.layout.arcosModuleGap}
                  onChange={(value) => updateLayout('arcosModuleGap', value)}
                  onReset={() => resetLayout('arcosModuleGap')}
                  className="dev-visible-slider-field"
                />
              </>
            )}
            {false && !isReleaseMode && (
              <>
                <SliderField
                  label="Espaço botões inferiores"
                  min={0}
                  max={24}
                  step={1}
                  value={settings.layout.actionButtonGap}
                  onChange={(value) => updateLayout('actionButtonGap', value)}
                  onReset={() => resetLayout('actionButtonGap')}
                />
                <SliderField
                  label="Base botões inferiores"
                  min={8}
                  max={40}
                  step={1}
                  value={settings.layout.menuToggleBottom}
                  onChange={(value) => updateLayout('menuToggleBottom', value)}
                  onReset={() => resetLayout('menuToggleBottom')}
                />
                <SliderField
                  label="Altura titulo da pagina"
                  min={-32}
                  max={48}
                  step={1}
                  value={settings.layout.featureHeadingVerticalOffset}
                  onChange={(value) =>
                    updateLayout('featureHeadingVerticalOffset', value)
                  }
                  onReset={() =>
                    resetLayout('featureHeadingVerticalOffset')
                  }
                />
                <SliderField
                  label="Altura da tabela"
                  min={-160}
                  max={160}
                  step={1}
                  value={settings.layout.tableHeightOffset}
                  onChange={(value) => updateLayout('tableHeightOffset', value)}
                  onReset={() => resetLayout('tableHeightOffset')}
                />
                <SliderField
                  label="Altura Pesq/Config"
                  min={-24}
                  max={48}
                  step={1}
                  value={settings.layout.lowerActionsVerticalOffset}
                  onChange={(value) =>
                    updateLayout('lowerActionsVerticalOffset', value)
                  }
                  onReset={() =>
                    resetLayout('lowerActionsVerticalOffset')
                  }
                />
                <SliderField
                  label="Icone Ocultar X"
                  min={-12}
                  max={12}
                  step={1}
                  value={settings.layout.collapseIconOffset}
                  onChange={(value) => updateLayout('collapseIconOffset', value)}
                  onReset={() => resetLayout('collapseIconOffset')}
                />
                <SliderField
                  label="Texto Ocultar X"
                  min={-16}
                  max={16}
                  step={1}
                  value={settings.layout.collapseLabelOffset}
                  onChange={(value) =>
                    updateLayout('collapseLabelOffset', value)
                  }
                  onReset={() => resetLayout('collapseLabelOffset')}
                />
                <SliderField
                  label="Altura botao Ocultar"
                  min={-16}
                  max={16}
                  step={1}
                  value={settings.layout.collapseButtonVerticalOffset}
                  onChange={(value) =>
                    updateLayout('collapseButtonVerticalOffset', value)
                  }
                  onReset={() =>
                    resetLayout('collapseButtonVerticalOffset')
                  }
                />
                <SliderField
                  label="Altura texto Ocultar"
                  min={-8}
                  max={8}
                  step={1}
                  value={settings.layout.collapseLabelVerticalOffset}
                  onChange={(value) =>
                    updateLayout('collapseLabelVerticalOffset', value)
                  }
                  onReset={() =>
                    resetLayout('collapseLabelVerticalOffset')
                  }
                />
                <SliderField
                  label="Altura das linhas"
                  min={24}
                  max={58}
                  step={1}
                  value={settings.layout.tableRowHeight}
                  onChange={(value) => updateLayout('tableRowHeight', value)}
                  onReset={() => resetLayout('tableRowHeight')}
                />
                <SliderField
                  label="Altura do cabeçalho"
                  min={36}
                  max={76}
                  step={1}
                  value={settings.layout.tableHeaderHeight}
                  onChange={(value) =>
                    updateLayout('tableHeaderHeight', value)
                  }
                  onReset={() => resetLayout('tableHeaderHeight')}
                />
                <SliderField
                  label="Posição da tabela"
                  min={0}
                  max={36}
                  step={1}
                  value={settings.layout.tableTopOffset}
                  onChange={(value) => updateLayout('tableTopOffset', value)}
                  onReset={() => resetLayout('tableTopOffset')}
                />
                <SliderField
                  label="Altura popup item"
                  min={120}
                  max={900}
                  step={1}
                  value={settings.layout.rowDetailsPanelHeight}
                  onChange={(value) =>
                    updateLayout('rowDetailsPanelHeight', value)
                  }
                  onReset={() => resetLayout('rowDetailsPanelHeight')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Nome"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsNameWidth}
                  onChange={(value) => updateLayout('rowDetailsNameWidth', value)}
                  onReset={() => resetLayout('rowDetailsNameWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Sexo"
                  min={7}
                  max={280}
                  step={7}
                  value={settings.layout.rowDetailsSexWidth}
                  onChange={(value) => updateLayout('rowDetailsSexWidth', value)}
                  onReset={() => resetLayout('rowDetailsSexWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Nascimento"
                  min={7}
                  max={560}
                  step={7}
                  value={settings.layout.rowDetailsBirthdateWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsBirthdateWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsBirthdateWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Idade"
                  min={7}
                  max={280}
                  step={7}
                  value={settings.layout.rowDetailsAgeWidth}
                  onChange={(value) => updateLayout('rowDetailsAgeWidth', value)}
                  onReset={() => resetLayout('rowDetailsAgeWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup E-mail"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsEmailWidth}
                  onChange={(value) => updateLayout('rowDetailsEmailWidth', value)}
                  onReset={() => resetLayout('rowDetailsEmailWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Contato"
                  min={7}
                  max={420}
                  step={7}
                  value={settings.layout.rowDetailsContactWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsContactWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsContactWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup CPF"
                  min={7}
                  max={420}
                  step={7}
                  value={settings.layout.rowDetailsCpfWidth}
                  onChange={(value) => updateLayout('rowDetailsCpfWidth', value)}
                  onReset={() => resetLayout('rowDetailsCpfWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup RG"
                  min={7}
                  max={420}
                  step={7}
                  value={settings.layout.rowDetailsRgWidth}
                  onChange={(value) => updateLayout('rowDetailsRgWidth', value)}
                  onReset={() => resetLayout('rowDetailsRgWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Nome Responsável"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsResponsibleNameWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsResponsibleNameWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsResponsibleNameWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Email Responsável"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsResponsibleEmailWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsResponsibleEmailWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsResponsibleEmailWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Contato Responsável"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsResponsibleContactWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsResponsibleContactWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsResponsibleContactWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Endereço"
                  min={7}
                  max={900}
                  step={7}
                  value={settings.layout.rowDetailsAddressWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsAddressWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsAddressWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Empresa"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsCompanyWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsCompanyWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsCompanyWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Instituição"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsInstitutionWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsInstitutionWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsInstitutionWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Arco"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsLearningArcWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsLearningArcWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsLearningArcWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Função"
                  min={7}
                  max={700}
                  step={7}
                  value={settings.layout.rowDetailsRoleWidth}
                  onChange={(value) => updateLayout('rowDetailsRoleWidth', value)}
                  onReset={() => resetLayout('rowDetailsRoleWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Admissão"
                  min={7}
                  max={560}
                  step={7}
                  value={settings.layout.rowDetailsAdmissionDateWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsAdmissionDateWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsAdmissionDateWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Término"
                  min={7}
                  max={560}
                  step={7}
                  value={settings.layout.rowDetailsEndDateWidth}
                  onChange={(value) =>
                    updateLayout('rowDetailsEndDateWidth', value)
                  }
                  onReset={() => resetLayout('rowDetailsEndDateWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Popup Turma"
                  min={7}
                  max={560}
                  step={7}
                  value={settings.layout.rowDetailsClassWidth}
                  onChange={(value) => updateLayout('rowDetailsClassWidth', value)}
                  onReset={() => resetLayout('rowDetailsClassWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Arcos largura"
                  min={180}
                  max={520}
                  step={1}
                  value={settings.layout.arcosColumnWidth}
                  onChange={(value) => updateLayout('arcosColumnWidth', value)}
                  onReset={() => resetLayout('arcosColumnWidth')}
                  className="dev-visible-slider-field"
                />
                <SliderField
                  label="Arcos gap"
                  min={0}
                  max={80}
                  step={1}
                  value={settings.layout.arcosColumnGap}
                  onChange={(value) => updateLayout('arcosColumnGap', value)}
                  onReset={() => resetLayout('arcosColumnGap')}
                  className="dev-visible-slider-field"
                />
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
  onReset: () => void;
};

function ColorField({ label, value, onChange, onReset }: ColorFieldProps) {
  return (
    <div
      className="color-field"
      onContextMenu={(event) => {
        event.preventDefault();
        onReset();
      }}
    >
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
  onReset: () => void;
  className?: string;
};

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onReset,
  className,
}: SliderFieldProps) {
  return (
    <label
      className={['slider-field', className].filter(Boolean).join(' ')}
      onContextMenu={(event) => {
        event.preventDefault();
        onReset();
      }}
    >
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
    case 'building-community':
      return <BuildingCommunityIcon />;
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

function BuildingCommunityIcon() {
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
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
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
