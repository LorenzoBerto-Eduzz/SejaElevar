import logoElevar from '../../assets/logo-elevar.png';

export type AppBrand = {
  productName: string;
  organizationName: string;
  logoText: string;
  logoUrl?: string;
  theme: {
    primary: string;
    secondary: string;
    tertiary: string;
    surface: string;
    text: string;
  };
};

export const appBrand: AppBrand = {
  productName: 'SejaElevar',
  organizationName: 'Elevar',
  logoText: 'Elevar',
  logoUrl: logoElevar,
  theme: {
    primary: '#1f5f8b',
    secondary: '#0f7b68',
    tertiary: '#d9edf8',
    surface: '#f8fbfd',
    text: '#1b2430',
  },
};
