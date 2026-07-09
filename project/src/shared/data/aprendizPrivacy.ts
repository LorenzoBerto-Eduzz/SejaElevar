import { resetActionHistory } from '../actionLog/actionLog';
import {
  GLOBAL_DATA_CHANGED_EVENT,
  GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT,
} from './events';
import {
  getAprendizDependencySummary,
  getStoredRecordId,
  type AprendizDependencySummary,
} from './dependencyInspector';
import {
  readManagedWorkbookSheets,
  type ManagedWorkbookSheets,
} from './dataHealth';
import { normalizeFieldLabel } from './schemas';
import { resetGlobalUndoHistory } from '../undo/globalUndo';
import {
  fetchBaseWorkbookFile,
  loadXlsx,
  persistManagedWorkbookDataIndexes,
} from './workspaceData';
import { getWorkbookSheet } from './workbookSheets';

export type AprendizPrivacyPurgePreview = AprendizDependencySummary & {
  aprendizRowCount: number;
};

export type AprendizPrivacyPurgeResult = {
  file: File;
  preview: AprendizPrivacyPurgePreview;
};

const PRIVACY_HISTORY_RESET_STORAGE_KEY =
  'sejaelevar.privacyHistoryReset.v1';

const applyPrivacyHistoryReset = (historyResetId: string) => {
  resetGlobalUndoHistory();
  resetActionHistory();

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      PRIVACY_HISTORY_RESET_STORAGE_KEY,
      historyResetId,
    );
  }
};

export const syncPrivacyHistoryReset = async () => {
  try {
    const response = await fetch('/api/privacy/state', {
      cache: 'no-store',
    });

    if (!response.ok) {
      return;
    }

    const state = (await response.json()) as {
      historyResetId?: string | null;
    };
    const historyResetId = state.historyResetId?.trim() ?? '';

    if (!historyResetId || typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const appliedResetId =
      window.localStorage.getItem(PRIVACY_HISTORY_RESET_STORAGE_KEY) ?? '';

    if (appliedResetId !== historyResetId) {
      applyPrivacyHistoryReset(historyResetId);
    }
  } catch {
    // The next successful startup/status refresh retries this safety check.
  }
};

const getColumnIndex = (
  sheet: ManagedWorkbookSheets[keyof ManagedWorkbookSheets],
  columnName: string,
) =>
  sheet.columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  );

const getCellValue = (
  sheet: ManagedWorkbookSheets[keyof ManagedWorkbookSheets],
  row: readonly string[],
  columnName: string,
) => {
  const columnIndex = getColumnIndex(sheet, columnName);

  return columnIndex >= 0 ? String(row[columnIndex] ?? '').trim() : '';
};

const removeRowsByReference = (
  sheet: ManagedWorkbookSheets[keyof ManagedWorkbookSheets],
  columnName: string,
  aprendizId: string,
) => ({
  ...sheet,
  rows: sheet.rows.filter(
    (row) => getCellValue(sheet, row, columnName) !== aprendizId,
  ),
});

export const getAprendizPrivacyPurgePreview = (
  sheets: ManagedWorkbookSheets,
  aprendizId: string,
  aprendizName: string,
): AprendizPrivacyPurgePreview => {
  const summary = getAprendizDependencySummary(
    sheets,
    aprendizId,
    aprendizName,
  );
  const aprendizRowCount = sheets.aprendizes.rows.filter(
    (row) => getStoredRecordId(sheets.aprendizes, row) === aprendizId,
  ).length;

  return {
    ...summary,
    aprendizRowCount,
  };
};

export const loadAprendizPrivacyPurgePreview = async (
  aprendizId: string,
  aprendizName: string,
) => {
  const sourceFile = await fetchBaseWorkbookFile();

  if (!sourceFile) {
    throw new Error('missing-active-workbook');
  }

  const sheets = await readManagedWorkbookSheets(sourceFile);

  return getAprendizPrivacyPurgePreview(sheets, aprendizId, aprendizName);
};

export const buildAprendizPrivacyPurgedSheets = (
  sheets: ManagedWorkbookSheets,
  aprendizId: string,
): ManagedWorkbookSheets => ({
  ...sheets,
  aprendizes: {
    ...sheets.aprendizes,
    rows: sheets.aprendizes.rows.filter(
      (row) => getStoredRecordId(sheets.aprendizes, row) !== aprendizId,
    ),
  },
  planoEnsino: removeRowsByReference(
    sheets.planoEnsino,
    'Aprendiz ID',
    aprendizId,
  ),
  presencas: removeRowsByReference(
    sheets.presencas,
    'Aprendiz ID',
    aprendizId,
  ),
  horasAplicadas: removeRowsByReference(
    sheets.horasAplicadas,
    'Aprendiz ID',
    aprendizId,
  ),
  planoProgresso: removeRowsByReference(
    sheets.planoProgresso,
    'Aprendiz ID',
    aprendizId,
  ),
});

const writePurgedSheets = async (
  sourceFile: File,
  sheets: ManagedWorkbookSheets,
) => {
  const { read, utils, write } = await loadXlsx();
  const workbook = read(await sourceFile.arrayBuffer(), {
    cellDates: true,
  });
  const changedSheets = [
    sheets.aprendizes,
    sheets.planoEnsino,
    sheets.presencas,
    sheets.horasAplicadas,
    sheets.planoProgresso,
  ];

  changedSheets.forEach((sheet) => {
    const { sheetName } = getWorkbookSheet(workbook, sheet.sheetName);
    const resolvedSheetName = sheetName ?? sheet.sheetName;

    workbook.Sheets[resolvedSheetName] = utils.aoa_to_sheet([
      sheet.columns,
      ...sheet.rows,
    ]);

    if (!workbook.SheetNames.includes(resolvedSheetName)) {
      workbook.SheetNames.push(resolvedSheetName);
    }
  });

  return write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer;
};

export const purgeAprendizPersonalData = async (
  aprendizId: string,
  aprendizName: string,
): Promise<AprendizPrivacyPurgeResult> => {
  const sourceFile = await fetchBaseWorkbookFile();

  if (!sourceFile) {
    throw new Error('missing-active-workbook');
  }

  const sheets = await readManagedWorkbookSheets(sourceFile);
  const preview = getAprendizPrivacyPurgePreview(
    sheets,
    aprendizId,
    aprendizName,
  );

  if (preview.aprendizRowCount !== 1) {
    throw new Error('aprendiz-identity-not-unique');
  }

  const purgedSheets = buildAprendizPrivacyPurgedSheets(sheets, aprendizId);
  const output = await writePurgedSheets(sourceFile, purgedSheets);
  const response = await fetch('/api/privacy/aprendiz-purge', {
    method: 'PUT',
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'x-aprendiz-id': encodeURIComponent(aprendizId),
      'x-privacy-confirmed': 'true',
    },
    body: output,
  });

  if (!response.ok) {
    throw new Error('privacy-purge-failed');
  }

  const result = (await response.json()) as {
    fileName?: string;
    historyResetId?: string;
  };
  const file = new File(
    [output.slice(0)],
    result.fileName || sourceFile.name,
    {
      type:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  );

  applyPrivacyHistoryReset(
    result.historyResetId?.trim() || `local-${Date.now()}`,
  );
  await persistManagedWorkbookDataIndexes(file);
  window.dispatchEvent(
    new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
      detail: {
        file,
        fileName: file.name,
        reason: 'aprendiz-privacy-purge',
        force: true,
      },
    }),
  );
  window.dispatchEvent(new Event(GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT));

  return {
    file,
    preview,
  };
};
