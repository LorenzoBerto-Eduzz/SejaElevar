export type AppTab =
  | 'aprendizes'
  | 'turmas'
  | 'disciplinas'
  | 'arcos'
  | 'funcionarios'
  | 'salas'
  | 'calendario'
  | 'documentos';

export type NavigationIcon =
  | 'person'
  | 'people'
  | 'book'
  | 'brain'
  | 'apple'
  | 'building'
  | 'calendar'
  | 'document';

export type NavigationTab = {
  id: AppTab;
  label: string;
  icon: NavigationIcon;
};

export const appTabs: NavigationTab[] = [
  { id: 'aprendizes', label: 'Aprendizes', icon: 'person' },
  { id: 'turmas', label: 'Turmas', icon: 'people' },
  { id: 'disciplinas', label: 'Disciplinas', icon: 'book' },
  { id: 'arcos', label: 'Arcos', icon: 'brain' },
  { id: 'funcionarios', label: 'Funcionários', icon: 'apple' },
  { id: 'salas', label: 'Salas', icon: 'building' },
  { id: 'calendario', label: 'Calendário', icon: 'calendar' },
  { id: 'documentos', label: 'Documentos', icon: 'document' },
];
