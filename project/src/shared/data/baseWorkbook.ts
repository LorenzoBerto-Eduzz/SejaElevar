import {
  APRENDIZES_REQUIRED_COLUMNS,
  ARCOS_REQUIRED_COLUMNS,
  AULAS_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
} from './schemas';

export const BASE_WORKBOOK_FILE_PREFIX = 'DadosElevar';
export const BASE_WORKBOOK_FILE_NAME = `${BASE_WORKBOOK_FILE_PREFIX}.xlsx`;

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
    entityId: 'cronograma',
    sheetName: 'Cronograma',
    label: 'Cronograma',
    requiredColumns: [],
    status: 'planned',
  },
  {
    entityId: 'presencas',
    sheetName: 'Presencas',
    label: 'Presencas',
    requiredColumns: [],
    status: 'planned',
  },
] as const satisfies readonly BaseWorkbookSheetDefinition[];

export const getBaseWorkbookSheetByEntity = (entityId: string) =>
  BASE_WORKBOOK_SHEETS.find((sheet) => sheet.entityId === entityId) ?? null;
