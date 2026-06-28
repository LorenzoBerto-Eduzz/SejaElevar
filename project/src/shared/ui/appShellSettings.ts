import type { AppBrand } from '../brand/appBrand';

export const SETTINGS_STORAGE_KEY = 'sejaelevar.settings';
export const LEGACY_THEME_STORAGE_KEY = 'sejaelevar.theme';
export const APP_SETTINGS_VERSION = 8;

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
  deleteHint: string;
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
  deleteHint: string;
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
  rowDetailsPanelWidth: number;
  rowDetailsPanelHeight: number;
  rowDetailsFieldHorizontalOffset: number;
  rowDetailsLayerGap: number;
  rowDetailsNameWidth: number;
  rowDetailsSexWidth: number;
  rowDetailsBirthdateWidth: number;
  rowDetailsAgeWidth: number;
  rowDetailsEmailWidth: number;
  rowDetailsContactWidth: number;
  rowDetailsRgWidth: number;
  rowDetailsCpfWidth: number;
  rowDetailsResponsibleNameWidth: number;
  rowDetailsResponsibleEmailWidth: number;
  rowDetailsResponsibleContactWidth: number;
  rowDetailsAddressWidth: number;
  rowDetailsCompanyWidth: number;
  rowDetailsInstitutionWidth: number;
  rowDetailsLearningArcWidth: number;
  rowDetailsRoleWidth: number;
  rowDetailsAdmissionDateWidth: number;
  rowDetailsEndDateWidth: number;
  rowDetailsClassWidth: number;
  rowDetailsCloseIconHorizontalOffset: number;
  settingsCloseIconHorizontalOffset: number;
  aulaCardActionIconHorizontalOffset: number;
  arcosColumnWidth: number;
  arcosColumnGap: number;
  arcosFirstModuleGap: number;
  arcosModuleGap: number;
  arcosModuleContentGap: number;
  arcosDisciplineGap: number;
  aulasCoverageGap: number;
};

export type AppSettings = {
  version: number;
  theme: ThemeSettings;
  darkTheme: DarkThemeSettings;
  layout: LayoutSettings;
};

export const createDefaultAppSettings = (brand: AppBrand): AppSettings => ({
  version: APP_SETTINGS_VERSION,
  theme: {
    ...brand.theme,
    primary: '#2069df',
    secondary: '#dbe5f0',
    tertiary: '#dbe5f0',
    surface: '#fafdff',
    text: '#000000',
    panel: '#ffffff',
    line: '#e3edf3',
    hover: '#dbe5f0',
    border: '#e3edf3',
    scrollTrack: '#ffffff',
    scrollThumb: '#dedede',
    titleBar: '#fafdff',
    titleBarText: '#000000',
    activeIcon: '#ffffff',
    activeText: '#ffffff',
    headerText: '#ffffff',
    deleteHint: '#d93025',
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
    deleteHint: '#f03228',
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
    tableRowHeight: 30,
    tableHeaderHeight: 40,
    tableTopOffset: 0,
    tableHeightOffset: 3,
    rowDetailsPanelWidth: 824,
    rowDetailsPanelHeight: 579,
    rowDetailsFieldHorizontalOffset: -2,
    rowDetailsLayerGap: 16,
    rowDetailsNameWidth: 336,
    rowDetailsSexWidth: 35,
    rowDetailsBirthdateWidth: 119,
    rowDetailsAgeWidth: 42,
    rowDetailsEmailWidth: 308,
    rowDetailsContactWidth: 154,
    rowDetailsRgWidth: 119,
    rowDetailsCpfWidth: 119,
    rowDetailsResponsibleNameWidth: 308,
    rowDetailsResponsibleEmailWidth: 266,
    rowDetailsResponsibleContactWidth: 154,
    rowDetailsAddressWidth: 784,
    rowDetailsCompanyWidth: 385,
    rowDetailsInstitutionWidth: 371,
    rowDetailsLearningArcWidth: 217,
    rowDetailsRoleWidth: 245,
    rowDetailsAdmissionDateWidth: 119,
    rowDetailsEndDateWidth: 119,
    rowDetailsClassWidth: 217,
    rowDetailsCloseIconHorizontalOffset: -1.7,
    settingsCloseIconHorizontalOffset: -2,
    aulaCardActionIconHorizontalOffset: -1,
    arcosColumnWidth: 280,
    arcosColumnGap: 24,
    arcosFirstModuleGap: 8,
    arcosModuleGap: 8,
    arcosModuleContentGap: 6,
    arcosDisciplineGap: 6,
    aulasCoverageGap: 6,
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
      const hasCurrentLayoutVersion =
        parsedSettings.version === APP_SETTINGS_VERSION;
      const savedLayout = { ...parsedSettings.layout };

      if (
        savedLayout.tableRowHeight === 28 ||
        savedLayout.tableRowHeight === 32
      ) {
        savedLayout.tableRowHeight = defaultSettings.layout.tableRowHeight;
      }

      return {
        version: APP_SETTINGS_VERSION,
        theme: { ...defaultSettings.theme, ...parsedSettings.theme },
        darkTheme: {
          ...defaultSettings.darkTheme,
          ...parsedSettings.darkTheme,
        },
        layout: hasCurrentLayoutVersion
          ? { ...defaultSettings.layout, ...savedLayout }
          : defaultSettings.layout,
      };
    }

    if (savedTheme) {
      return {
        ...defaultSettings,
        version: APP_SETTINGS_VERSION,
        theme: { ...defaultSettings.theme, ...JSON.parse(savedTheme) },
      };
    }
  } catch {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  }

  return defaultSettings;
};
