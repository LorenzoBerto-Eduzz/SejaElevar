import {
  APRENDIZES_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from './schemas';

export const APRENDIZES_ENTITY_ID = 'aprendizes';

export type SheetTable = {
  fileName: string;
  sheetName: string;
  importedAt: string;
  columns: string[];
  rows: string[][];
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
  const records = sheet.rows.map((row, rowIndex) => {
    const fields = Object.fromEntries(
      sheet.columns.map((column, columnIndex) => [column, row[columnIndex] ?? '']),
    );
    const customFields = Object.fromEntries(
      sheet.columns
        .filter((column) => !knownColumnKeys.has(normalizeFieldLabel(column)))
        .map((column) => [column, fields[column] ?? '']),
    );
    const recordLabel = getRecordLabel(fields, rowIndex);

    return {
      id: `${entity}:${rowIndex + 1}`,
      entity,
      rowIndex,
      label: recordLabel,
      fields,
      customFields,
      searchText: createSearchText([
        entity,
        label,
        recordLabel,
        ...sheet.columns,
        ...row,
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
    'Aprendizes',
    sheet,
    APRENDIZES_REQUIRED_COLUMNS,
  );
