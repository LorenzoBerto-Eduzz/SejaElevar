import {
  APRENDIZES_REQUIRED_COLUMNS,
  ARCOS_REQUIRED_COLUMNS,
  AULAS_REQUIRED_COLUMNS,
  CRONOGRAMA_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from './schemas';
import { getBaseWorkbookSheetByEntity } from './baseWorkbook';
import { getPublicColumns, getSheetRecordId, isInternalColumn } from './stableIds';

export const APRENDIZES_ENTITY_ID = 'aprendizes';
export const TURMAS_ENTITY_ID = 'turmas';
export const ARCOS_ENTITY_ID = 'arcos';
export const DISCIPLINAS_ENTITY_ID = 'disciplinas';
export const AULAS_ENTITY_ID = 'aulas';
export const CRONOGRAMA_ENTITY_ID = 'cronograma';

export type SheetTable = {
  fileName: string;
  sheetName: string;
  importedAt: string;
  columns: string[];
  rows: string[][];
  hasGeneratedRecordIds?: boolean;
};

export type DataIndexRecord = {
  id: string;
  entity: string;
  rowIndex: number;
  label: string;
  fields: Record<string, string>;
  customFields: Record<string, string>;
  searchText: string;
  source: {
    fileName: string;
    sheetName: string;
    rowIndex: number;
  };
};

export type DataIndexEntity = {
  entity: string;
  label: string;
  sourceFileName: string | null;
  sourceSheetName: string | null;
  importedAt: string | null;
  updatedAt: string;
  records: DataIndexRecord[];
};

const createSearchText = (values: string[]) =>
  values
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const getRecordLabel = (fields: Record<string, string>, rowIndex: number) =>
  fields.Nome ||
  fields.Turma ||
  fields.Arco ||
  fields.Disciplina ||
  fields.Aula ||
  Object.values(fields).find((value) => value.trim() !== '') ||
  `Registro ${rowIndex + 1}`;

export const buildEmptyDataIndexEntity = (
  entity: string,
  label: string,
): DataIndexEntity => ({
  entity,
  label,
  sourceFileName: null,
  sourceSheetName: null,
  importedAt: null,
  updatedAt: new Date().toISOString(),
  records: [],
});

export const buildDataIndexEntity = (
  entity: string,
  label: string,
  sheet: SheetTable,
  knownColumns: readonly string[],
): DataIndexEntity => {
  const knownColumnKeys = new Set(
    knownColumns.map((column) => normalizeFieldLabel(column)),
  );
  const publicColumns = getPublicColumns(sheet.columns);
  const records = sheet.rows.map((row, rowIndex) => {
    const fields = Object.fromEntries(
      publicColumns.map((column) => {
        const columnIndex = sheet.columns.indexOf(column);
        return [column, row[columnIndex] ?? ''];
      }),
    );
    const customFields = Object.fromEntries(
      publicColumns
        .filter(
          (column) =>
            !knownColumnKeys.has(normalizeFieldLabel(column)) &&
            !isInternalColumn(column),
        )
        .map((column) => [column, fields[column] ?? '']),
    );
    const recordLabel = getRecordLabel(fields, rowIndex);
    const publicRowValues = publicColumns.map((column) => fields[column] ?? '');

    return {
      id: getSheetRecordId(sheet, rowIndex, entity),
      entity,
      rowIndex,
      label: recordLabel,
      fields,
      customFields,
      searchText: createSearchText([
        entity,
        label,
        recordLabel,
        ...publicColumns,
        ...publicRowValues,
      ]),
      source: {
        fileName: sheet.fileName,
        sheetName: sheet.sheetName,
        rowIndex,
      },
    };
  });

  return {
    entity,
    label,
    sourceFileName: sheet.fileName,
    sourceSheetName: sheet.sheetName,
    importedAt: sheet.importedAt,
    updatedAt: new Date().toISOString(),
    records,
  };
};

export const buildAprendizesDataIndexEntity = (sheet: SheetTable) =>
  buildDataIndexEntity(
    APRENDIZES_ENTITY_ID,
    getBaseWorkbookSheetByEntity(APRENDIZES_ENTITY_ID)?.label ?? 'Aprendizes',
    sheet,
    APRENDIZES_REQUIRED_COLUMNS,
  );

export const buildTurmasDataIndexEntity = (sheet: SheetTable) =>
  buildDataIndexEntity(
    TURMAS_ENTITY_ID,
    getBaseWorkbookSheetByEntity(TURMAS_ENTITY_ID)?.label ?? 'Turmas',
    sheet,
    TURMAS_REQUIRED_COLUMNS,
  );

export const buildArcosDataIndexEntity = (sheet: SheetTable) =>
  buildDataIndexEntity(
    ARCOS_ENTITY_ID,
    getBaseWorkbookSheetByEntity(ARCOS_ENTITY_ID)?.label ?? 'Arcos',
    sheet,
    ARCOS_REQUIRED_COLUMNS,
  );

export const buildDisciplinasDataIndexEntity = (sheet: SheetTable) =>
  buildDataIndexEntity(
    DISCIPLINAS_ENTITY_ID,
    getBaseWorkbookSheetByEntity(DISCIPLINAS_ENTITY_ID)?.label ?? 'Disciplinas',
    sheet,
    DISCIPLINAS_REQUIRED_COLUMNS,
  );

export const buildAulasDataIndexEntity = (sheet: SheetTable) =>
  buildDataIndexEntity(
    AULAS_ENTITY_ID,
    getBaseWorkbookSheetByEntity(AULAS_ENTITY_ID)?.label ?? 'Aulas',
    sheet,
    AULAS_REQUIRED_COLUMNS,
  );

export const buildCronogramaDataIndexEntity = (sheet: SheetTable) =>
  buildDataIndexEntity(
    CRONOGRAMA_ENTITY_ID,
    getBaseWorkbookSheetByEntity(CRONOGRAMA_ENTITY_ID)?.label ?? 'Cronograma',
    sheet,
    CRONOGRAMA_REQUIRED_COLUMNS,
  );
