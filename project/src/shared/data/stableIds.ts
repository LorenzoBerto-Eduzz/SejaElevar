import { normalizeFieldLabel } from './schemas';

export const SEJA_ELEVAR_ID_COLUMN = 'ID SejaElevar (não editar)';

const ENTITY_ID_PREFIXES: Record<string, string> = {
  aprendizes: 'apr',
  turmas: 'tur',
  arcos: 'arco',
  disciplinas: 'disc',
  aulas: 'aula',
};

type SheetLike = {
  columns: string[];
  rows: string[][];
};

export const isInternalColumn = (column: string) =>
  normalizeFieldLabel(column) === normalizeFieldLabel(SEJA_ELEVAR_ID_COLUMN);

export const getPublicColumns = (columns: string[]) =>
  columns.filter((column) => !isInternalColumn(column));

const getEntityPrefix = (entity: string) => ENTITY_ID_PREFIXES[entity] ?? 'item';

export const generateStableRecordId = (entity: string) => {
  const prefix = getEntityPrefix(entity);
  const bytes = new Uint8Array(6);

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return `${prefix}_${Array.from(bytes)
    .map((byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 10)}`;
};

const normalizeRecordId = (value: string) => value.trim();

export const ensureSheetRecordIds = <T extends SheetLike>(
  sheet: T,
  entity: string,
): { sheet: T; didChange: boolean } => {
  const existingIdColumnIndex = sheet.columns.findIndex(isInternalColumn);
  const idColumnIndex =
    existingIdColumnIndex >= 0 ? existingIdColumnIndex : sheet.columns.length;
  const nextColumns =
    existingIdColumnIndex >= 0
      ? sheet.columns.map((column, columnIndex) =>
          columnIndex === existingIdColumnIndex ? SEJA_ELEVAR_ID_COLUMN : column,
        )
      : [...sheet.columns, SEJA_ELEVAR_ID_COLUMN];
  const seenIds = new Set<string>();
  let didChange =
    existingIdColumnIndex < 0 ||
    sheet.columns[existingIdColumnIndex] !== SEJA_ELEVAR_ID_COLUMN;

  const nextRows = sheet.rows.map((row) => {
    const nextRow = [...row];

    while (nextRow.length < nextColumns.length) {
      nextRow.push('');
    }

    const currentId = normalizeRecordId(nextRow[idColumnIndex] ?? '');
    const shouldGenerateId = !currentId || seenIds.has(currentId);
    const nextId = shouldGenerateId ? generateStableRecordId(entity) : currentId;

    if (nextRow[idColumnIndex] !== nextId) {
      didChange = true;
      nextRow[idColumnIndex] = nextId;
    }

    seenIds.add(nextId);
    return nextRow;
  });

  if (!didChange) {
    return { sheet, didChange: false };
  }

  return {
    sheet: {
      ...sheet,
      columns: nextColumns,
      rows: nextRows,
    },
    didChange,
  };
};

export const getSheetRecordId = (
  sheet: SheetLike,
  rowIndex: number,
  entity: string,
) => {
  const idColumnIndex = sheet.columns.findIndex(isInternalColumn);
  const id = idColumnIndex >= 0 ? normalizeRecordId(sheet.rows[rowIndex]?.[idColumnIndex] ?? '') : '';

  return id || `${getEntityPrefix(entity)}#${rowIndex + 1}`;
};

