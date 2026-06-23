import {
  ARCOS_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from '../schemas';
import { getWorkbookSheet } from '../workbookSheets';
import {
  fetchBaseWorkbookFile,
  loadXlsx,
  normalizeCell,
  persistManagedWorkbookDataIndexes,
  readWorkbookFromFile,
} from '../workspaceData';
import type { ParsedDisciplina, ParsedEmenta } from './ementaTypes';

type XlsxModule = typeof import('xlsx');
type XlsxWorkbook = ReturnType<XlsxModule['read']>;

const ARCOS_SHEET_NAME = 'Arcos';
const DISCIPLINAS_SHEET_NAME = 'Disciplinas';

const getColumnIndex = (columns: readonly string[], columnName: string) =>
  columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  );

const getRowCell = (
  row: readonly string[],
  columns: readonly string[],
  columnName: string,
) => {
  const columnIndex = getColumnIndex(columns, columnName);
  return columnIndex >= 0 ? normalizeCell(row[columnIndex]) : '';
};

const toRows = (
  utils: XlsxModule['utils'],
  workbook: XlsxWorkbook,
  sheetName: string,
  fallbackColumns: readonly string[],
) => {
  const { worksheet } = getWorkbookSheet(workbook, sheetName);

  if (!worksheet) {
    return {
      columns: [...fallbackColumns],
      rows: [] as string[][],
    };
  }

  const rawRows = utils.sheet_to_json<unknown[]>(worksheet, {
    blankrows: false,
    defval: '',
    header: 1,
    raw: false,
  });
  const [header = [], ...bodyRows] = rawRows;
  const columns = [...fallbackColumns];

  header.map(normalizeCell).forEach((column) => {
    if (
      column &&
      !columns.some(
        (existingColumn) =>
          normalizeFieldLabel(existingColumn) === normalizeFieldLabel(column),
      )
    ) {
      columns.push(column);
    }
  });

  return {
    columns,
    rows: bodyRows
      .map((row) =>
        columns.map((column) => {
          const sourceIndex = getColumnIndex(header.map(normalizeCell), column);
          return sourceIndex >= 0 ? normalizeCell(row[sourceIndex]) : '';
        }),
      )
      .filter((row) => row.some((cell) => cell !== '')),
  };
};

const writeSheet = (
  utils: XlsxModule['utils'],
  workbook: XlsxWorkbook,
  sheetName: string,
  columns: readonly string[],
  rows: readonly string[][],
) => {
  workbook.Sheets[sheetName] = utils.aoa_to_sheet([
    [...columns],
    ...rows.map((row) => [...row]),
  ]);

  if (!workbook.SheetNames.includes(sheetName)) {
    workbook.SheetNames.push(sheetName);
  }
};

const createArcoRow = (
  columns: readonly string[],
  parsedEmenta: ParsedEmenta,
) =>
  columns.map((column) => {
    switch (normalizeFieldLabel(column)) {
      case 'id':
        return `arco_${parsedEmenta.id}`;
      case 'arco':
        return parsedEmenta.arco;
      case 'ementa id':
        return parsedEmenta.id;
      case 'arquivo ementa':
        return parsedEmenta.storedFileName || parsedEmenta.originalFileName;
      default:
        return '';
    }
  });

const createDisciplinaRow = (
  columns: readonly string[],
  discipline: ParsedDisciplina,
  ementaId: string,
) =>
  columns.map((column) => {
    switch (normalizeFieldLabel(column)) {
      case 'disciplina':
        return discipline.name;
      case 'modulo':
        return discipline.module;
      case 'arco':
        return discipline.arco;
      case 'carga horaria':
        return discipline.hours;
      case 'id':
        return discipline.id;
      case 'ementa id':
        return ementaId;
      default:
        return '';
    }
  });

const getDisciplinaKey = (
  row: readonly string[],
  columns: readonly string[],
) =>
  [
    getRowCell(row, columns, 'Disciplina'),
    getRowCell(row, columns, 'Módulo'),
    getRowCell(row, columns, 'Arco'),
    getRowCell(row, columns, 'Carga Horária'),
  ]
    .map(normalizeFieldLabel)
    .join('|');

export const saveParsedEmentaToWorkbook = async (parsedEmenta: ParsedEmenta) => {
  const { utils, write } = await loadXlsx();
  const activeFile = await fetchBaseWorkbookFile().catch(() => null);

  if (!activeFile) {
    throw new Error('missing-base-workbook');
  }

  const workbook = await readWorkbookFromFile(activeFile);
  const arcosSheet = toRows(
    utils,
    workbook,
    ARCOS_SHEET_NAME,
    ARCOS_REQUIRED_COLUMNS,
  );
  const disciplinasSheet = toRows(
    utils,
    workbook,
    DISCIPLINAS_SHEET_NAME,
    DISCIPLINAS_REQUIRED_COLUMNS,
  );
  const parsedArcoKey = normalizeFieldLabel(parsedEmenta.arco);
  const nextArcosRows = [
    ...arcosSheet.rows.filter((row) => {
      const rowArcoKey = normalizeFieldLabel(getRowCell(row, arcosSheet.columns, 'Arco'));
      const rowEmentaId = getRowCell(row, arcosSheet.columns, 'Ementa ID');

      return rowArcoKey !== parsedArcoKey && rowEmentaId !== parsedEmenta.id;
    }),
    createArcoRow(arcosSheet.columns, parsedEmenta),
  ];
  const replacedEmentaIds = new Set([parsedEmenta.id]);
  const nextDisciplinasRows = disciplinasSheet.rows.filter((row) => {
    const rowEmentaId = getRowCell(row, disciplinasSheet.columns, 'Ementa ID');
    const rowArco = getRowCell(row, disciplinasSheet.columns, 'Arco');

    if (replacedEmentaIds.has(rowEmentaId)) {
      return false;
    }

    return normalizeFieldLabel(rowArco) !== parsedArcoKey;
  });
  const seenDisciplinas = new Set(
    nextDisciplinasRows.map((row) =>
      getDisciplinaKey(row, disciplinasSheet.columns),
    ),
  );

  parsedEmenta.disciplines.forEach((discipline) => {
    const row = createDisciplinaRow(
      disciplinasSheet.columns,
      discipline,
      parsedEmenta.id,
    );
    const key = getDisciplinaKey(row, disciplinasSheet.columns);

    if (!seenDisciplinas.has(key)) {
      seenDisciplinas.add(key);
      nextDisciplinasRows.push(row);
    }
  });

  writeSheet(utils, workbook, ARCOS_SHEET_NAME, arcosSheet.columns, nextArcosRows);
  writeSheet(
    utils,
    workbook,
    DISCIPLINAS_SHEET_NAME,
    disciplinasSheet.columns,
    nextDisciplinasRows,
  );

  const buffer = write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer;
  const response = await fetch('/api/base-workbook/file', {
    method: 'PUT',
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: buffer,
  });

  if (!response.ok) {
    throw new Error('ementa-workbook-save-failed');
  }

  const result = (await response.json()) as { fileName?: string };
  const savedFile = new File(
    [buffer.slice(0)],
    result.fileName || activeFile?.name || 'DadosElevar.xlsx',
    {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  );

  await persistManagedWorkbookDataIndexes(savedFile);

  return savedFile;
};
