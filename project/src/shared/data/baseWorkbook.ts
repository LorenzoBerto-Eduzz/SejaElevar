import {
  APRENDIZES_REQUIRED_COLUMNS,
  AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
  ARCOS_REQUIRED_COLUMNS,
  AULAS_REQUIRED_COLUMNS,
  CRONOGRAMA_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  HORAS_APLICADAS_REQUIRED_COLUMNS,
  PLANO_ENSINO_REQUIRED_COLUMNS,
  PLANO_PROGRESSO_REQUIRED_COLUMNS,
  PRESENCAS_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
} from './schemas';

export const BASE_WORKBOOK_FILE_PREFIX = 'DadosElevar';
export const BASE_WORKBOOK_FILE_NAME = `${BASE_WORKBOOK_FILE_PREFIX}.xlsx`;
export const CURRENT_WORKBOOK_SCHEMA_VERSION = 1;
export const WORKBOOK_SYSTEM_SHEET_NAME = 'Sistema SejaElevar';
export const WORKBOOK_SYSTEM_REQUIRED_COLUMNS = ['Chave', 'Valor'] as const;
export const WORKBOOK_SCHEMA_VERSION_KEY = 'schemaVersion';
export const WORKBOOK_SCHEMA_UPDATED_AT_KEY = 'schemaUpdatedAt';

export type BaseWorkbookSheetStatus =
  | 'active-legacy-workbook'
  | 'planned-index-ready'
  | 'planned';

export type BaseWorkbookSheetDefinition = {
  entityId: string;
  sheetName: string;
  label: string;
  requiredColumns: readonly string[];
  status: BaseWorkbookSheetStatus;
  legacyApiBasePath?: string;
};

export const BASE_WORKBOOK_SHEETS = [
  {
    entityId: 'aprendizes',
    sheetName: 'Aprendizes',
    label: 'Aprendizes',
    requiredColumns: APRENDIZES_REQUIRED_COLUMNS,
    status: 'active-legacy-workbook',
    legacyApiBasePath: '/api/aprendizes',
  },
  {
    entityId: 'turmas',
    sheetName: 'Turmas',
    label: 'Turmas',
    requiredColumns: TURMAS_REQUIRED_COLUMNS,
    status: 'active-legacy-workbook',
    legacyApiBasePath: '/api/turmas',
  },
  {
    entityId: 'arcos',
    sheetName: 'Arcos',
    label: 'Arcos',
    requiredColumns: ARCOS_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'disciplinas',
    sheetName: 'Disciplinas',
    label: 'Disciplinas',
    requiredColumns: DISCIPLINAS_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'empresas',
    sheetName: 'Empresas',
    label: 'Empresas',
    requiredColumns: [],
    status: 'planned',
  },
  {
    entityId: 'aulas',
    sheetName: 'Aulas',
    label: 'Aulas',
    requiredColumns: AULAS_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'aulas-disciplinas',
    sheetName: 'Aulas Disciplinas',
    label: 'Aulas Disciplinas',
    requiredColumns: AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'cronograma',
    sheetName: 'Cronograma',
    label: 'Cronograma',
    requiredColumns: CRONOGRAMA_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'presencas',
    sheetName: 'Presencas',
    label: 'Presencas',
    requiredColumns: PRESENCAS_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'plano-ensino',
    sheetName: 'Plano de Ensino',
    label: 'Plano de Ensino',
    requiredColumns: PLANO_ENSINO_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'horas-aplicadas',
    sheetName: 'Horas Aplicadas',
    label: 'Horas Aplicadas',
    requiredColumns: HORAS_APLICADAS_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
  {
    entityId: 'plano-progresso',
    sheetName: 'Plano Progresso',
    label: 'Plano Progresso',
    requiredColumns: PLANO_PROGRESSO_REQUIRED_COLUMNS,
    status: 'planned-index-ready',
  },
] as const satisfies readonly BaseWorkbookSheetDefinition[];

export const getBaseWorkbookSheetByEntity = (entityId: string) =>
  BASE_WORKBOOK_SHEETS.find((sheet) => sheet.entityId === entityId) ?? null;
