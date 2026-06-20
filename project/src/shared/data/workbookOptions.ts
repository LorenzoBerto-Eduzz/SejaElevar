import { getWorkbookSheet } from './workbookSheets';
import {
  loadXlsx,
  normalizeCell,
  responseToWorkbookFile,
  readWorkbookFromFile,
} from './workspaceData';

type XlsxModule = typeof import('xlsx');
type XlsxWorkbook = ReturnType<XlsxModule['read']>;

export const WORKBOOK_OPTIONS_SHEET_NAME = 'Opções';
export const WORKBOOK_OPTIONS_COLUMNS = ['Tipo', 'Valor'] as const;

export type WorkbookOptionType = 'periodo' | 'instrutor' | 'sala';

export type WorkbookOptions = Record<WorkbookOptionType, string[]>;

export const emptyWorkbookOptions = (): WorkbookOptions => ({
  periodo: [],
  instrutor: [],
  sala: [],
});

export const normalizeWorkbookOptionKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const optionTypeByKey = new Map<string, WorkbookOptionType>([
  ['periodo', 'periodo'],
  ['periodos', 'periodo'],
  ['instrutor', 'instrutor'],
  ['instrutores', 'instrutor'],
  ['professor', 'instrutor'],
  ['professores', 'instrutor'],
  ['sala', 'sala'],
  ['salas', 'sala'],
]);

const normalizeOptionType = (value: string): WorkbookOptionType | null =>
  optionTypeByKey.get(normalizeWorkbookOptionKey(value)) ?? null;

export const dedupeWorkbookOptionValues = (values: string[]) => {
  const seenKeys = new Set<string>();
  const dedupedValues: string[] = [];

  values.forEach((value) => {
    const normalizedValue = value.trim();
    const key = normalizeWorkbookOptionKey(normalizedValue);

    if (!normalizedValue || !key || seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    dedupedValues.push(normalizedValue);
  });

  return dedupedValues;
};

export const mergeWorkbookOptionValues = (
  savedValues: string[],
  currentValues: string[],
) => dedupeWorkbookOptionValues([...savedValues, ...currentValues]);

export const readWorkbookOptions = async (
  file: File,
): Promise<WorkbookOptions> => {
  const { utils } = await loadXlsx();
  const workbook = await readWorkbookFromFile(file);
  const { worksheet } = getWorkbookSheet(workbook, WORKBOOK_OPTIONS_SHEET_NAME);
  const options = emptyWorkbookOptions();

  if (!worksheet) {
    return options;
  }

  const rows = utils.sheet_to_json<unknown[]>(worksheet, {
    blankrows: false,
    defval: '',
    header: 1,
    raw: false,
  });
  const headerIndex = rows.findIndex((row) => {
    const keys = row.map((cell) => normalizeWorkbookOptionKey(normalizeCell(cell)));
    return keys.includes('tipo') && keys.includes('valor');
  });
  const firstDataRowIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
  const typeColumnIndex =
    headerIndex >= 0
      ? rows[headerIndex].findIndex(
          (cell) => normalizeWorkbookOptionKey(normalizeCell(cell)) === 'tipo',
        )
      : 0;
  const valueColumnIndex =
    headerIndex >= 0
      ? rows[headerIndex].findIndex(
          (cell) => normalizeWorkbookOptionKey(normalizeCell(cell)) === 'valor',
        )
      : 1;

  rows.slice(firstDataRowIndex).forEach((row) => {
    const type = normalizeOptionType(normalizeCell(row[typeColumnIndex]));
    const value = normalizeCell(row[valueColumnIndex]);

    if (!type || !value) {
      return;
    }

    options[type].push(value);
  });

  return {
    periodo: dedupeWorkbookOptionValues(options.periodo),
    instrutor: dedupeWorkbookOptionValues(options.instrutor),
    sala: dedupeWorkbookOptionValues(options.sala),
  };
};

const buildOptionsWorksheetRows = (options: WorkbookOptions) => [
  [...WORKBOOK_OPTIONS_COLUMNS],
  ...(['periodo', 'instrutor', 'sala'] as const).flatMap((type) =>
    options[type].map((value) => [type, value]),
  ),
];

const getWorkbookOptionsFromWorkbook = (
  utils: XlsxModule['utils'],
  workbook: XlsxWorkbook,
) => {
  const { worksheet } = getWorkbookSheet(workbook, WORKBOOK_OPTIONS_SHEET_NAME);
  const options = emptyWorkbookOptions();

  if (!worksheet) {
    return options;
  }

  const rows = utils.sheet_to_json<unknown[]>(worksheet, {
    blankrows: false,
    defval: '',
    header: 1,
    raw: false,
  });
  const firstDataRowIndex = rows.findIndex((row) => {
    const keys = row.map((cell) => normalizeWorkbookOptionKey(normalizeCell(cell)));
    return keys.includes('tipo') && keys.includes('valor');
  });
  const dataRows = rows.slice(firstDataRowIndex >= 0 ? firstDataRowIndex + 1 : 0);

  dataRows.forEach((row) => {
    const type = normalizeOptionType(normalizeCell(row[0]));
    const value = normalizeCell(row[1]);

    if (type && value) {
      options[type].push(value);
    }
  });

  return {
    periodo: dedupeWorkbookOptionValues(options.periodo),
    instrutor: dedupeWorkbookOptionValues(options.instrutor),
    sala: dedupeWorkbookOptionValues(options.sala),
  };
};

export const persistWorkbookOption = async (
  type: WorkbookOptionType,
  value: string,
) => {
  const normalizedValue = value.trim();
  const valueKey = normalizeWorkbookOptionKey(normalizedValue);

  if (!normalizedValue || !valueKey) {
    return false;
  }

  const sourceResponse = await fetch('/api/base-workbook/file', {
    cache: 'no-store',
  });

  if (!sourceResponse.ok) {
    return false;
  }

  const file = await responseToWorkbookFile(sourceResponse, 'DadosElevar.xlsx');
  const { read, utils, write } = await loadXlsx();
  const workbook = read(await file.arrayBuffer(), {
    cellDates: true,
  });
  const options = getWorkbookOptionsFromWorkbook(utils, workbook);
  const currentKeys = new Set(
    options[type].map((option) => normalizeWorkbookOptionKey(option)),
  );

  if (currentKeys.has(valueKey)) {
    return false;
  }

  const nextOptions = {
    ...options,
    [type]: [...options[type], normalizedValue],
  };
  const worksheet = utils.aoa_to_sheet(buildOptionsWorksheetRows(nextOptions));
  const previousSheetName =
    workbook.SheetNames.find(
      (sheetName) =>
        normalizeWorkbookOptionKey(sheetName) ===
        normalizeWorkbookOptionKey(WORKBOOK_OPTIONS_SHEET_NAME),
    ) ?? WORKBOOK_OPTIONS_SHEET_NAME;

  workbook.Sheets[previousSheetName] = worksheet;

  if (!workbook.SheetNames.includes(previousSheetName)) {
    workbook.SheetNames.push(previousSheetName);
  }

  const output = write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer;
  const saveResponse = await fetch('/api/base-workbook/file/system', {
    method: 'PUT',
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: output,
  });

  return saveResponse.ok;
};
