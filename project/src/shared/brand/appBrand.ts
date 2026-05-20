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
    primary: '#2069df',
    secondary: '#40a9e5',
    tertiary: '#ecf5fe',
    surface: '#f8fbfd',
    text: '#1b2430',
  },
};
