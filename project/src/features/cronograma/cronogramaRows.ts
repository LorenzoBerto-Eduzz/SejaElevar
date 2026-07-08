import type { SheetTable } from '../../shared/data/dataIndex';
import { normalizeFieldLabel } from '../../shared/data/schemas';
import {
  loadXlsx,
  responseToWorkbookFile,
} from '../../shared/data/workspaceData';

const CRONOGRAMA_COLUMNS = {
  id: 'ID',
  turma: 'Turma',
  date: 'Data',
  start: 'Início',
  end: 'Fim',
  type: 'Tipo',
  lessonId: 'Aula ID',
  lesson: 'Aula',
  instructor: 'Instrutor',
  room: 'Sala',
  color: 'Cor',
} as const;

export type CronogramaBlockRowValues = {
  id: string;
  turmaName: string;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  type?: string;
  lessonId?: string;
  lesson?: string;
  instructor?: string;
  room?: string;
  color?: string;
};

const columnMatches = (column: string, expected: string) =>
  normalizeFieldLabel(column) === normalizeFieldLabel(expected);

export const getCronogramaCellValue = (
  sheet: SheetTable,
  row: string[],
  columnName: string,
) => {
  const columnIndex = sheet.columns.findIndex((column) =>
    columnMatches(column, columnName),
  );

  return columnIndex >= 0 ? row[columnIndex] ?? '' : '';
};

export const getCronogramaRowId = (sheet: SheetTable, row: string[]) =>
  getCronogramaCellValue(sheet, row, CRONOGRAMA_COLUMNS.id);

export const findCronogramaRowIndex = (sheet: SheetTable, rowId: string) =>
  sheet.rows.findIndex((row) => getCronogramaRowId(sheet, row) === rowId);

export const buildCronogramaRow = (
  sheet: SheetTable,
  values: Record<string, string>,
) =>
  sheet.columns.map((column) => {
    const matchingValue = Object.entries(values).find(([key]) =>
      columnMatches(key, column),
    );

    return matchingValue?.[1] ?? '';
  });

export const buildCronogramaBlockRow = (
  sheet: SheetTable,
  sourceRow: string[],
  values: CronogramaBlockRowValues,
  formatTime: (minutes: number) => string,
) =>
  sheet.columns.map((column, columnIndex) => {
    const currentValue = sourceRow[columnIndex] ?? '';

    if (columnMatches(column, CRONOGRAMA_COLUMNS.id)) {
      return values.id;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.turma)) {
      return values.turmaName;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.date)) {
      return values.dateKey;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.start)) {
      return formatTime(values.startMinutes);
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.end)) {
      return formatTime(values.endMinutes);
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.type)) {
      return values.type ?? currentValue;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.lessonId)) {
      return values.lessonId ?? currentValue;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.lesson)) {
      return values.lesson ?? currentValue;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.instructor)) {
      return values.instructor ?? currentValue;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.room)) {
      return values.room ?? currentValue;
    }

    if (columnMatches(column, CRONOGRAMA_COLUMNS.color)) {
      return values.color ?? currentValue;
    }

    return currentValue;
  });

export const replaceCronogramaRow = (
  sheet: SheetTable,
  rowIndex: number,
  nextRow: string[],
): SheetTable => ({
  ...sheet,
  rows: sheet.rows.map((row, currentIndex) =>
    currentIndex === rowIndex ? nextRow : row,
  ),
});

export const appendCronogramaRow = (
  sheet: SheetTable,
  row: string[],
): SheetTable => ({
  ...sheet,
  rows: [...sheet.rows, row],
});

export const insertCronogramaRow = (
  sheet: SheetTable,
  rowIndex: number,
  row: string[],
): SheetTable => {
  const nextRows = [...sheet.rows];
  nextRows.splice(rowIndex, 0, row);

  return {
    ...sheet,
    rows: nextRows,
  };
};

export const removeCronogramaRow = (
  sheet: SheetTable,
  rowIndex: number,
): SheetTable => ({
  ...sheet,
  rows: sheet.rows.filter((_, currentIndex) => currentIndex !== rowIndex),
});

export const removeCronogramaRowByIdentity = (
  sheet: SheetTable,
  expectedRowIndex: number,
  rowId: string,
): SheetTable => ({
  ...sheet,
  rows: sheet.rows.filter(
    (row, rowIndex) =>
      rowIndex !== expectedRowIndex && getCronogramaRowId(sheet, row) !== rowId,
  ),
});

export const areCronogramaRowsEqual = (
  firstRow: string[],
  secondRow: string[],
) => firstRow.join('\u0000') === secondRow.join('\u0000');

let cronogramaSaveQueue: Promise<void> = Promise.resolve();

const saveCronogramaSheet = async (
  sheet: SheetTable,
  sheetName: string,
): Promise<SheetTable | null> => {
  try {
    const { read, utils, write } = await loadXlsx();
    const sourceResponse = await fetch('/api/base-workbook/file', {
      cache: 'no-store',
    });

    if (!sourceResponse.ok) {
      return null;
    }

    const sourceFile = await responseToWorkbookFile(
      sourceResponse,
      'DadosElevar.xlsx',
    );
    const workbook = read(await sourceFile.arrayBuffer(), {
      cellDates: true,
    });
    const resolvedSheetName =
      workbook.SheetNames.find((candidateName) =>
        columnMatches(candidateName, sheetName),
      ) ?? sheetName;

    workbook.Sheets[resolvedSheetName] = utils.aoa_to_sheet([
      sheet.columns,
      ...sheet.rows,
    ]);

    if (!workbook.SheetNames.includes(resolvedSheetName)) {
      workbook.SheetNames.push(resolvedSheetName);
    }

    const output = write(workbook, {
      bookType: 'xlsx',
      type: 'array',
    }) as ArrayBuffer;
    const saveResponse = await fetch('/api/base-workbook/file', {
      method: 'PUT',
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: output,
    });

    if (!saveResponse.ok) {
      return null;
    }

    const result = (await saveResponse.json()) as { fileName?: string };

    return {
      ...sheet,
      fileName: result.fileName || sheet.fileName,
    };
  } catch {
    return null;
  }
};

export const saveCronogramaSheetToActiveWorkbook = (
  sheet: SheetTable,
  sheetName: string,
) => {
  const saveOperation = cronogramaSaveQueue.then(() =>
    saveCronogramaSheet(sheet, sheetName),
  );

  cronogramaSaveQueue = saveOperation.then(
    () => undefined,
    () => undefined,
  );

  return saveOperation;
};
