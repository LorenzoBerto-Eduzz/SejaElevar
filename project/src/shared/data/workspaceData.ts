import { BASE_WORKBOOK_SHEETS } from './baseWorkbook';
import {
  AULAS_ENTITY_ID,
  ARCOS_ENTITY_ID,
  CRONOGRAMA_ENTITY_ID,
  DISCIPLINAS_ENTITY_ID,
  buildAulasDataIndexEntity,
  buildArcosDataIndexEntity,
  buildCronogramaDataIndexEntity,
  buildDisciplinasDataIndexEntity,
  buildEmptyDataIndexEntity,
  type SheetTable,
} from './dataIndex';
import {
  ARCOS_REQUIRED_COLUMNS,
  AULAS_REQUIRED_COLUMNS,
  CRONOGRAMA_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  findSchemaHeaderRowIndex,
  normalizeColumnsForSchema,
  normalizeFieldLabel,
} from './schemas';
import { ensureSheetRecordIds } from './stableIds';
import { getWorkbookSheet, hasWorkbookSheet } from './workbookSheets';

type XlsxModule = typeof import('xlsx');
type XlsxWorksheet = ReturnType<XlsxModule['utils']['aoa_to_sheet']>;
type XlsxWorkbook = ReturnType<XlsxModule['read']>;

export type RecoveryReason =
  | 'before_import'
  | 'before_edit'
  | 'before_session_edit'
  | 'import_original'
  | 'before_recovery'
  | 'after_recovery'
  | 'restored';

export type RecoveryInfo = {
  available: boolean;
  canRecover: boolean;
  checkpointId?: string | null;
  fileName?: string | null;
  label?: string | null;
  formattedUpdatedAt?: string | null;
  reason?: RecoveryReason | null;
  importCount?: number | null;
  fileCount?: number | null;
  checkpoints?: Array<{
    checkpointId?: string | null;
    canRecover: boolean;
    label?: string | null;
    formattedUpdatedAt?: string | null;
    reason?: RecoveryReason | null;
    importCount?: number | null;
    fileCount?: number | null;
  }>;
};

export type WorkbookValidationIssue = {
  sheetName: string;
  missingColumns?: string[];
  missingSheet?: boolean;
};

export class MissingRequiredColumnsError extends Error {
  missingColumns: string[];

  constructor(missingColumns: string[]) {
    super('missing-required-columns');
    this.missingColumns = missingColumns;
  }
}

export class WorkbookValidationError extends Error {
  issues: WorkbookValidationIssue[];

  constructor(issues: WorkbookValidationIssue[]) {
    super('invalid-global-workbook');
    this.issues = issues;
  }
}

let xlsxModulePromise: Promise<XlsxModule> | null = null;

export const loadXlsx = () => {
  xlsxModulePromise ??= import('xlsx');
  return xlsxModulePromise;
};

export const normalizeCell = (value: unknown) => String(value ?? '').trim();

const ACTIVE_WORKBOOK_SHEETS = BASE_WORKBOOK_SHEETS.filter(
  (sheet) => sheet.status === 'active-legacy-workbook',
);

const MANAGED_OPTIONAL_WORKBOOK_SHEETS = [
  {
    entityId: ARCOS_ENTITY_ID,
    sheetName: 'Arcos',
    label: 'Arcos',
    requiredColumns: ARCOS_REQUIRED_COLUMNS,
  },
  {
    entityId: DISCIPLINAS_ENTITY_ID,
    sheetName: 'Disciplinas',
    label: 'Disciplinas',
    requiredColumns: DISCIPLINAS_REQUIRED_COLUMNS,
  },
  {
    entityId: AULAS_ENTITY_ID,
    sheetName: 'Aulas',
    label: 'Aulas',
    requiredColumns: AULAS_REQUIRED_COLUMNS,
  },
  {
    entityId: CRONOGRAMA_ENTITY_ID,
    sheetName: 'Cronograma',
    label: 'Cronograma',
    requiredColumns: CRONOGRAMA_REQUIRED_COLUMNS,
  },
] as const;

const toSheetRows = (
  utils: XlsxModule['utils'],
  worksheet: XlsxWorksheet,
) =>
  utils.sheet_to_json<unknown[]>(worksheet, {
    blankrows: false,
    defval: '',
    header: 1,
    raw: false,
  });

const getLastUsedColumnIndex = (rows: unknown[][], startRowIndex: number) => {
  let lastColumnIndex = -1;

  rows.slice(Math.max(0, startRowIndex)).forEach((row) => {
    row.forEach((cell, index) => {
      if (normalizeCell(cell) !== '') {
        lastColumnIndex = Math.max(lastColumnIndex, index);
      }
    });
  });

  return lastColumnIndex;
};

const normalizeManagedWorksheet = (
  utils: XlsxModule['utils'],
  worksheet: XlsxWorksheet | null,
  requiredColumns: readonly string[],
) => {
  if (!worksheet) {
    return {
      worksheet: utils.aoa_to_sheet([[...requiredColumns]]),
      didChange: true,
    };
  }

  const rows = toSheetRows(utils, worksheet);
  const headerIndex = findSchemaHeaderRowIndex(rows, requiredColumns);

  if (headerIndex < 0) {
    return {
      worksheet: utils.aoa_to_sheet([[...requiredColumns]]),
      didChange: true,
    };
  }

  const lastColumnIndex = Math.max(
    requiredColumns.length - 1,
    getLastUsedColumnIndex(rows, headerIndex),
  );
  const nextRows = rows.map((row) => [...row]);

  while (nextRows.length <= headerIndex) {
    nextRows.push([]);
  }

  const headerRow = nextRows[headerIndex];
  const rawColumns = Array.from(
    { length: lastColumnIndex + 1 },
    (_, index) => normalizeCell(headerRow[index]) || `Coluna ${index + 1}`,
  );
  const { missingColumns, normalizedColumns } = normalizeColumnsForSchema(
    rawColumns,
    requiredColumns,
  );
  const nextColumns = [...normalizedColumns, ...missingColumns];
  const originalColumns = Array.from(
    { length: nextColumns.length },
    (_, index) => normalizeCell(headerRow[index]),
  );
  const didChange =
    missingColumns.length > 0 ||
    nextColumns.some((column, index) => column !== originalColumns[index]);

  if (!didChange) {
    return {
      worksheet,
      didChange: false,
    };
  }

  nextRows[headerIndex] = nextColumns;
  for (let rowIndex = 0; rowIndex < nextRows.length; rowIndex += 1) {
    while (nextRows[rowIndex].length < nextColumns.length) {
      nextRows[rowIndex].push('');
    }
  }

  return {
    worksheet: utils.aoa_to_sheet(nextRows),
    didChange: true,
  };
};

const ensureManagedWorkbookSheets = (
  utils: XlsxModule['utils'],
  workbook: XlsxWorkbook,
) => {
  let didChange = false;

  MANAGED_OPTIONAL_WORKBOOK_SHEETS.forEach((sheetDefinition) => {
    const { sheetName, worksheet } = getWorkbookSheet(
      workbook,
      sheetDefinition.sheetName,
    );
    const targetSheetName = (sheetName ?? sheetDefinition.sheetName).slice(0, 31);
    const normalizedSheet = normalizeManagedWorksheet(
      utils,
      worksheet,
      sheetDefinition.requiredColumns,
    );

    if (!worksheet || normalizedSheet.didChange) {
      workbook.Sheets[targetSheetName] = normalizedSheet.worksheet;
      didChange = true;
    }

    if (!workbook.SheetNames.includes(targetSheetName)) {
      workbook.SheetNames.push(targetSheetName);
      didChange = true;
    }
  });

  return didChange;
};

const extractColumns = (
  utils: XlsxModule['utils'],
  worksheet: XlsxWorksheet,
  requiredColumns: readonly string[],
) => {
  const rows = utils.sheet_to_json<string[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  const requiredKeys = new Set(requiredColumns.map(normalizeFieldLabel));
  const scoredRows = rows
    .map((row) => {
      const columns = row.map((column) => String(column ?? '').trim());
      const availableKeys = new Set(columns.map(normalizeFieldLabel));
      const score = [...requiredKeys].filter((key) => availableKeys.has(key))
        .length;

      return {
        columns,
        score,
      };
    })
    .filter(({ columns }) => columns.some((column) => column !== ''))
    .sort((left, right) => right.score - left.score);

  return scoredRows[0]?.columns ?? [];
};

export const isXlsxFile = (file: File) =>
  file.name.toLowerCase().endsWith('.xlsx') ||
  file.type ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const readWorkbookFromFile = async (file: File) => {
  if (!isXlsxFile(file)) {
    throw new Error('invalid-file-type');
  }

  const { read } = await loadXlsx();
  return read(await file.arrayBuffer(), {
    cellDates: true,
  });
};

export const prepareManagedWorkbookFile = async (file: File) => {
  const { read, utils, write } = await loadXlsx();
  const inputBuffer = await file.arrayBuffer();
  const workbook = read(inputBuffer, {
    cellDates: true,
  });
  const didChange = ensureManagedWorkbookSheets(utils, workbook);
  const outputBuffer = didChange
    ? (write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      }) as ArrayBuffer)
    : inputBuffer.slice(0);
  const preparedFile = new File([outputBuffer.slice(0)], file.name, {
    type:
      file.type ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  return {
    file: preparedFile,
    buffer: outputBuffer,
    didChange,
  };
};

export const isUnifiedWorkbookFile = async (file: File) => {
  const workbook = await readWorkbookFromFile(file);

  return ACTIVE_WORKBOOK_SHEETS.every((sheetDefinition) =>
    hasWorkbookSheet(workbook, sheetDefinition.sheetName),
  );
};

export const validateGlobalWorkbookFile = async (file: File) => {
  const { utils } = await loadXlsx();
  const workbook = await readWorkbookFromFile(file);
  const issues: WorkbookValidationIssue[] = [];

  for (const sheetDefinition of ACTIVE_WORKBOOK_SHEETS) {
    if (!hasWorkbookSheet(workbook, sheetDefinition.sheetName)) {
      issues.push({
        sheetName: sheetDefinition.sheetName,
        missingSheet: true,
      });
      continue;
    }

    const { worksheet } = getWorkbookSheet(
      workbook,
      sheetDefinition.sheetName,
    );

    if (!worksheet) {
      issues.push({
        sheetName: sheetDefinition.sheetName,
        missingSheet: true,
      });
      continue;
    }

    const columns = extractColumns(
      utils,
      worksheet,
      sheetDefinition.requiredColumns,
    );
    const { missingColumns } = normalizeColumnsForSchema(
      columns,
      sheetDefinition.requiredColumns,
    );

    if (missingColumns.length > 0) {
      issues.push({
        sheetName: sheetDefinition.sheetName,
        missingColumns,
      });
    }
  }

  if (issues.length > 0) {
    throw new WorkbookValidationError(issues);
  }
};

export const formatWorkbookValidationToast = (error: unknown) => {
  if (!(error instanceof WorkbookValidationError)) {
    const message = error instanceof Error ? error.message : '';

    if (message === 'import-failed') {
      return 'N\u00e3o foi poss\u00edvel gravar o arquivo escolhido em dados.';
    }

    return 'N\u00e3o foi poss\u00edvel ler o arquivo escolhido.';
  }

  const details = error.issues
    .map((issue) => {
      if (issue.missingSheet) {
        return `${issue.sheetName}: aba ausente`;
      }

      return `${issue.sheetName}: ${issue.missingColumns?.join(', ')}`;
    })
    .join('\n');

  return `Arquivo escolhido n\u00e3o possui as seguintes colunas:\n${details}`;
};

type ReadWorkbookSheetOptions = {
  entityId: string;
  requiredColumns: readonly string[];
  preferredSheetName: string;
  removedColumns?: Set<string>;
  ensureRecordIds?: boolean;
};

export const readWorkbookSheetFile = async (
  file: File,
  {
    entityId,
    ensureRecordIds = true,
    preferredSheetName,
    removedColumns,
    requiredColumns,
  }: ReadWorkbookSheetOptions,
): Promise<SheetTable> => {
  const { utils } = await loadXlsx();
  const workbook = await readWorkbookFromFile(file);
  const { sheetName, worksheet } = getWorkbookSheet(
    workbook,
    preferredSheetName,
  );

  if (!sheetName || !worksheet) {
    throw new Error('missing-sheet');
  }

  const sheetRows = utils.sheet_to_json<unknown[]>(worksheet, {
    blankrows: false,
    defval: '',
    header: 1,
    raw: false,
  });
  const headerIndex = findSchemaHeaderRowIndex(sheetRows, requiredColumns);

  if (headerIndex < 0) {
    throw new Error('empty-sheet');
  }

  const headerRow = sheetRows[headerIndex];
  let lastColumnIndex = -1;
  sheetRows.slice(headerIndex).forEach((row) => {
    row.forEach((cell, index) => {
      if (normalizeCell(cell) !== '') {
        lastColumnIndex = Math.max(lastColumnIndex, index);
      }
    });
  });

  const rawColumns = headerRow
    .slice(0, lastColumnIndex + 1)
    .map((cell, index) => normalizeCell(cell) || `Coluna ${index + 1}`);
  const { missingColumns, normalizedColumns } = normalizeColumnsForSchema(
    rawColumns,
    requiredColumns,
  );

  if (missingColumns.length > 0) {
    throw new MissingRequiredColumnsError(missingColumns);
  }

  const keptColumnIndexes = normalizedColumns
    .map((column, columnIndex) => ({ column, columnIndex }))
    .filter(
      ({ column }) => !removedColumns?.has(normalizeFieldLabel(column)),
    );
  const columns = keptColumnIndexes.map(({ column }) => column);
  const rows = sheetRows
    .slice(headerIndex + 1)
    .map((row) =>
      keptColumnIndexes.map(({ columnIndex }) => normalizeCell(row[columnIndex])),
    )
    .filter((row) => row.some((cell) => cell !== ''));
  const baseSheet = {
    fileName: file.name,
    sheetName,
    importedAt: new Date().toISOString(),
    columns,
    rows,
  };

  if (!ensureRecordIds) {
    return baseSheet;
  }

  const { sheet, didChange } = ensureSheetRecordIds(
    baseSheet,
    entityId,
  );

  return {
    ...sheet,
    hasGeneratedRecordIds: didChange,
  };
};

export const responseToWorkbookFile = async (
  response: Response,
  fallbackFileName: string,
) => {
  const rawFileName = response.headers.get('x-file-name') || fallbackFileName;
  const fileName = decodeURIComponent(rawFileName);
  const blob = await response.blob();

  return new File([blob], fileName, {
    type:
      blob.type ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

export const fetchBaseWorkbookFile = async () => {
  const response = await fetch('/api/base-workbook/file', {
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('read-failed');
  }

  return responseToWorkbookFile(response, 'DadosElevar.xlsx');
};

const readManagedWorkbookSheetFile = async (
  file: File,
  sheetDefinition: (typeof MANAGED_OPTIONAL_WORKBOOK_SHEETS)[number],
) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: sheetDefinition.entityId,
      ensureRecordIds: false,
      preferredSheetName: sheetDefinition.sheetName,
      requiredColumns: sheetDefinition.requiredColumns,
    });
  } catch {
    return {
      fileName: file.name,
      sheetName: sheetDefinition.sheetName,
      importedAt: new Date().toISOString(),
      columns: [...sheetDefinition.requiredColumns],
      rows: [],
    } satisfies SheetTable;
  }
};

export const persistManagedWorkbookDataIndexes = async (file: File | null) => {
  const managedSheets = file
    ? await Promise.all(
        MANAGED_OPTIONAL_WORKBOOK_SHEETS.map(async (sheetDefinition) => ({
          sheetDefinition,
          sheet: await readManagedWorkbookSheetFile(file, sheetDefinition),
        })),
      )
    : MANAGED_OPTIONAL_WORKBOOK_SHEETS.map((sheetDefinition) => ({
        sheetDefinition,
        sheet: null,
      }));
  const managedEntities = managedSheets.map(({ sheetDefinition, sheet }) => {
    const buildEntity = () => {
      if (sheetDefinition.entityId === ARCOS_ENTITY_ID) {
        return sheet
          ? buildArcosDataIndexEntity(sheet)
          : buildEmptyDataIndexEntity(ARCOS_ENTITY_ID, 'Arcos');
      }

      if (sheetDefinition.entityId === DISCIPLINAS_ENTITY_ID) {
        return sheet
          ? buildDisciplinasDataIndexEntity(sheet)
          : buildEmptyDataIndexEntity(DISCIPLINAS_ENTITY_ID, 'Disciplinas');
      }

      if (sheetDefinition.entityId === AULAS_ENTITY_ID) {
        return sheet
          ? buildAulasDataIndexEntity(sheet)
          : buildEmptyDataIndexEntity(AULAS_ENTITY_ID, 'Aulas');
      }

      return sheet
        ? buildCronogramaDataIndexEntity(sheet)
        : buildEmptyDataIndexEntity(CRONOGRAMA_ENTITY_ID, 'Cronograma');
    };

    return {
      entityId: sheetDefinition.entityId,
      entity: buildEntity(),
    };
  });

  try {
    await Promise.all(
      managedEntities.map(({ entityId, entity }) =>
        fetch(`/api/data-index/entities/${entityId}`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(entity),
        }),
      ),
    );
  } catch {
    // The workbook remains the source of truth; the generated index can be rebuilt.
  }
};

export const ensureActiveWorkbookManagedSheets = async () => {
  const sourceResponse = await fetch('/api/base-workbook/file', {
    cache: 'no-store',
  });

  if (sourceResponse.status === 404) {
    await persistManagedWorkbookDataIndexes(null);
    return false;
  }

  if (!sourceResponse.ok) {
    throw new Error('read-failed');
  }

  const file = await responseToWorkbookFile(sourceResponse, 'DadosElevar.xlsx');
  const preparedWorkbook = await prepareManagedWorkbookFile(file);

  if (preparedWorkbook.didChange) {
    const saveResponse = await fetch('/api/base-workbook/file/system', {
      method: 'PUT',
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: preparedWorkbook.buffer,
    });

    if (!saveResponse.ok) {
      throw new Error('save-failed');
    }
  }

  await persistManagedWorkbookDataIndexes(preparedWorkbook.file);
  return preparedWorkbook.didChange;
};

export const fetchRecoveryInfo = async () => {
  const response = await fetch('/api/recovery', {
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as RecoveryInfo;
};

export const recoverGlobalData = async (checkpointId?: unknown) => {
  const headers: Record<string, string> =
    typeof checkpointId === 'string' && checkpointId
      ? { 'x-checkpoint-id': checkpointId }
      : {};
  const response = await fetch('/api/recovery', {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    throw new Error('recovery-failed');
  }

  return (await response.json()) as {
    checkpointId?: string | null;
    hasWorkbook?: boolean | null;
    recoveryInfo?: RecoveryInfo | null;
  };
};
