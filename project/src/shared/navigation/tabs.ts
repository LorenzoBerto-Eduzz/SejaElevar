export type AppTab =
  | 'aprendizes'
  | 'documentos'
  | 'calendario'
  | 'turmas'
  | 'aulas'
  | 'arcos'
  | 'empresas';

export type NavigationIcon =
  | 'person'
  | 'people'
  | 'book'
  | 'brain'
  | 'building-community'
  | 'calendar'
  | 'document';

export type NavigationTab = {
  id: AppTab;
  label: string;
  icon: NavigationIcon;
};

export const appTabs: NavigationTab[] = [
  { id: 'aprendizes', label: 'Aprendizes', icon: 'person' },
  { id: 'documentos', label: 'Documentos', icon: 'document' },
  { id: 'calendario', label: 'Calendário', icon: 'calendar' },
  { id: 'turmas', label: 'Turmas', icon: 'people' },
  { id: 'aulas', label: 'Aulas', icon: 'book' },
  { id: 'arcos', label: 'Arcos', icon: 'brain' },
  { id: 'empresas', label: 'Empresas', icon: 'building-community' },
];
