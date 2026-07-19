import type { ManagedWorkbookSheets } from './dataHealth';
import { normalizeFieldLabel } from './schemas';

export type TurmaDeletionAnalysis = {
  assignedAprendizCount: number;
  blocked: boolean;
  historicalEventCount: number;
  unconfirmedEventCount: number;
};

export type AulaDeletionAnalysis = {
  blocked: boolean;
  coverageRowCount: number;
  historicalEventCount: number;
  unconfirmedEventCount: number;
};

type CatalogReference = {
  id: string;
  name: string;
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

const matchesName = (left: string, right: string) =>
  Boolean(left.trim()) &&
  normalizeFieldLabel(left) === normalizeFieldLabel(right);

const matchesCatalogReference = (
  referenceId: string,
  referenceName: string,
  target: CatalogReference,
) => {
  if (referenceId && target.id) {
    return referenceId === target.id;
  }

  return matchesName(referenceName, target.name);
};

const getConfirmedEventIds = (sheets: ManagedWorkbookSheets) =>
  new Set(
    sheets.presencas.rows
      .filter(
        (row) =>
          normalizeFieldLabel(
            getCellValue(sheets.presencas, row, 'Status Presença'),
          ) === 'presente',
      )
      .map((row) => getCellValue(sheets.presencas, row, 'Evento ID'))
      .filter(Boolean),
  );

export const analyzeTurmaDeletion = (
  sheets: ManagedWorkbookSheets,
  turmaName: string,
): TurmaDeletionAnalysis => {
  const confirmedEventIds = getConfirmedEventIds(sheets);
  const assignedAprendizCount = sheets.aprendizes.rows.filter((row) =>
    matchesName(getCellValue(sheets.aprendizes, row, 'Turma'), turmaName),
  ).length;
  let historicalEventCount = 0;
  let unconfirmedEventCount = 0;

  sheets.cronograma.rows.forEach((row) => {
    if (!matchesName(getCellValue(sheets.cronograma, row, 'Turma'), turmaName)) {
      return;
    }

    const eventId = getCellValue(sheets.cronograma, row, 'ID');

    if (eventId && confirmedEventIds.has(eventId)) {
      historicalEventCount += 1;
    } else {
      unconfirmedEventCount += 1;
    }
  });

  return {
    assignedAprendizCount,
    blocked: assignedAprendizCount > 0 || unconfirmedEventCount > 0,
    historicalEventCount,
    unconfirmedEventCount,
  };
};

export const analyzeAulaDeletion = (
  sheets: ManagedWorkbookSheets,
  aula: CatalogReference,
): AulaDeletionAnalysis => {
  const confirmedEventIds = getConfirmedEventIds(sheets);
  const coverageRowCount = sheets.aulasDisciplinas.rows.filter((row) =>
    matchesCatalogReference(
      getCellValue(sheets.aulasDisciplinas, row, 'Aula ID'),
      getCellValue(sheets.aulasDisciplinas, row, 'Aula'),
      aula,
    ),
  ).length;
  let historicalEventCount = 0;
  let unconfirmedEventCount = 0;

  sheets.cronograma.rows.forEach((row) => {
    if (
      !matchesCatalogReference(
        getCellValue(sheets.cronograma, row, 'Aula ID'),
        getCellValue(sheets.cronograma, row, 'Aula'),
        aula,
      )
    ) {
      return;
    }

    const eventId = getCellValue(sheets.cronograma, row, 'ID');

    if (eventId && confirmedEventIds.has(eventId)) {
      historicalEventCount += 1;
    } else {
      unconfirmedEventCount += 1;
    }
  });

  return {
    blocked: unconfirmedEventCount > 0,
    coverageRowCount,
    historicalEventCount,
    unconfirmedEventCount,
  };
};

export const getTurmaDeletionBlockingMessage = (
  analysis: TurmaDeletionAnalysis,
) => {
  const reasons = [
    analysis.assignedAprendizCount > 0
      ? `${analysis.assignedAprendizCount} Aprendiz(es) ainda vinculado(s)`
      : '',
    analysis.unconfirmedEventCount > 0
      ? `${analysis.unconfirmedEventCount} evento(s) ainda editável(is)`
      : '',
  ].filter(Boolean);

  return `A Turma não pode ser excluída: ${reasons.join(' e ')}. Resolva esses vínculos primeiro.`;
};

export const getAulaDeletionBlockingMessage = (
  analysis: AulaDeletionAnalysis,
) =>
  `A Aula não pode ser excluída enquanto estiver vinculada a ${analysis.unconfirmedEventCount} evento(s) ainda editável(is). Remova ou altere esses eventos primeiro.`;
