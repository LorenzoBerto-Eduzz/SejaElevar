export type AppTab = 'aprendizes';

export type NavigationTab = {
  id: AppTab;
  label: string;
};

export const appTabs: NavigationTab[] = [
  { id: 'aprendizes', label: 'Aprendizes' },
];
