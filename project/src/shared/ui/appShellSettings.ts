import type { AppBrand } from '../brand/appBrand';

export const SETTINGS_STORAGE_KEY = 'sejaelevar.settings';
export const LEGACY_THEME_STORAGE_KEY = 'sejaelevar.theme';

export type ThemeSettings = AppBrand['theme'] & {
  panel: string;
  line: string;
  hover: string;
  border: string;
  scrollTrack: string;
  scrollThumb: string;
  titleBar: string;
  titleBarText: string;
  activeIcon: string;
  activeText: string;
  headerText: string;
};

export type DarkThemeSettings = {
  primary: string;
  secondary: string;
  menu: string;
  surface: string;
  panel: string;
  text: string;
  line: string;
  hover: string;
  border: string;
  scrollTrack: string;
  scrollThumb: string;
  titleBar: string;
  titleBarText: string;
  activeIcon: string;
  activeText: string;
  headerText: string;
};

export type LayoutSettings = {
  pageTopOffset: number;
  contentTopOffset: number;
  gearOuterOffset: number;
  collapseIconOffset: number;
  collapseLabelOffset: number;
  collapseLabelVerticalOffset: number;
  collapseButtonVerticalOffset: number;
  lowerActionsVerticalOffset: number;
  logoImageHeight: number;
  sidebarTopOffset: number;
  tabListTopOffset: number;
  tabButtonGap: number;
  actionButtonGap: number;
  menuToggleBottom: number;
  menuButtonSize: number;
  iconTextGap: number;
  featureHeadingVerticalOffset: number;
  tableRowHeight: number;
  tableHeaderHeight: number;
  tableTopOffset: number;
  tableHeightOffset: number;
};

export type AppSettings = {
  theme: ThemeSettings;
  darkTheme: DarkThemeSettings;
  layout: LayoutSettings;
};

export const createDefaultAppSettings = (brand: AppBrand): AppSettings => ({
  theme: {
    ...brand.theme,
    primary: '#2069df',
    secondary: '#40a9e5',
    tertiary: '#ecf5fe',
    surface: '#fafdff',
    text: '#000000',
    panel: '#ffffff',
    line: '#e3edf3',
    hover: '#ecf5fe',
    border: '#e3edf3',
    scrollTrack: '#ffffff',
    scrollThumb: '#dedede',
    titleBar: '#fafdff',
    titleBarText: '#000000',
    activeIcon: '#ffffff',
    activeText: '#ffffff',
    headerText: '#ffffff',
  },
  darkTheme: {
    primary: '#2c3b9a',
    secondary: '#40a9e5',
    menu: '#1b1c1d',
    surface: '#000000',
    panel: '#000000',
    text: '#787878',
    line: '#212121',
    hover: '#1b1c1d',
    border: '#212121',
    scrollTrack: '#000000',
    scrollThumb: '#212121',
    titleBar: '#000000',
    titleBarText: '#ffffff',
    activeIcon: '#8c8c8c',
    activeText: '#8c8c8c',
    headerText: '#8c8c8c',
  },
  layout: {
    pageTopOffset: 51,
    contentTopOffset: 22,
    gearOuterOffset: 1.5,
    collapseIconOffset: -1,
    collapseLabelOffset: -1,
    collapseLabelVerticalOffset: -1,
    collapseButtonVerticalOffset: 1,
    lowerActionsVerticalOffset: 8,
    logoImageHeight: 100,
    sidebarTopOffset: 10,
    tabListTopOffset: 0,
    tabButtonGap: 20,
    actionButtonGap: 5,
    menuToggleBottom: 12,
    menuButtonSize: 47,
    iconTextGap: 6,
    featureHeadingVerticalOffset: -24,
    tableRowHeight: 28,
    tableHeaderHeight: 40,
    tableTopOffset: 0,
    tableHeightOffset: 3,
  },
});

export const readSavedAppSettings = (brand: AppBrand) => {
  const defaultSettings = createDefaultAppSettings(brand);

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
        theme: { ...defaultSettings.theme, ...parsedSettings.theme },
        darkTheme: {
          ...defaultSettings.darkTheme,
          ...parsedSettings.darkTheme,
        },
        layout: { ...defaultSettings.layout, ...parsedSettings.layout },
      };
    }

    if (savedTheme) {
      return {
        ...defaultSettings,
        theme: { ...defaultSettings.theme, ...JSON.parse(savedTheme) },
      };
    }
  } catch {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  }

  return defaultSettings;
};
