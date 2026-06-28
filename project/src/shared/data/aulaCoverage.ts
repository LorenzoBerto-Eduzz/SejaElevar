import type { SheetTable } from './dataIndex';
import { normalizeFieldLabel } from './schemas';

export const AULA_COVERAGE_LESSON_ID_COLUMN = 'Aula ID';
export const AULA_COVERAGE_LESSON_COLUMN = 'Aula';
export const AULA_COVERAGE_ARC_COLUMN = 'Arco';
export const AULA_COVERAGE_MODULE_COLUMN = 'Módulo';
export const AULA_COVERAGE_DISCIPLINE_COLUMN = 'Disciplina';
export const AULA_COVERAGE_DISCIPLINE_ID_COLUMN = 'Disciplina ID';
export const AULA_COVERAGE_ID_COLUMN = 'ID';

export const DISCIPLINE_NAME_COLUMN = 'Disciplina';
export const DISCIPLINE_MODULE_COLUMN = 'Módulo';
export const DISCIPLINE_ARC_COLUMN = 'Arco';
export const DISCIPLINE_WORKLOAD_COLUMN = 'Carga Horária';
export const DISCIPLINE_ID_COLUMN = 'ID';

export type AulaCoverageOption = {
  disciplineId: string;
  discipline: string;
  module: string;
  arco: string;
  workload: string;
};

export type AulaCoverageSelection = {
  disciplineId: string;
  discipline: string;
  module: string;
  arco: string;
};

export type AulaCoverageValidationResult = {
  isValid: boolean;
  duplicateSpecificArcos: string[];
};

const normalizeCoverageColumnLabel = (value: string) => {
  const normalizedValue = normalizeFieldLabel(value);

  if (normalizedValue === normalizeFieldLabel('MÃ³dulo')) {
    return normalizeFieldLabel('Módulo');
  }

  if (normalizedValue === normalizeFieldLabel('Carga HorÃ¡ria')) {
    return normalizeFieldLabel('Carga Horária');
  }

  return normalizedValue;
};

const getColumnIndex = (sheet: SheetTable, columnName: string) => {
  const columnKey = normalizeCoverageColumnLabel(columnName);

  return sheet.columns.findIndex(
    (column) => normalizeCoverageColumnLabel(column) === columnKey,
  );
};

const getCellValue = (
  sheet: SheetTable,
  row: string[],
  columnName: string,
) => {
  const columnIndex = getColumnIndex(sheet, columnName);

  return columnIndex >= 0 ? row[columnIndex] ?? '' : '';
};

export const isSharedDisciplineModule = (module: string) => {
  const moduleKey = normalizeFieldLabel(module);

  return moduleKey === 'inicial' || moduleKey === 'basico';
};

export const isSpecificDisciplineModule = (module: string) =>
  normalizeFieldLabel(module) === 'especifico';

export const buildAulaCoverageOptions = (
  disciplinasSheet: SheetTable | null,
  arcosSheet?: SheetTable | null,
): AulaCoverageOption[] => {
  if (!disciplinasSheet) {
    return [];
  }

  const activeArcoKeys = new Set<string>();

  arcosSheet?.rows.forEach((row) => {
    const arcoColumnIndex = getColumnIndex(arcosSheet, 'Arco');
    const arcoName =
      arcoColumnIndex >= 0 ? String(row[arcoColumnIndex] ?? '').trim() : '';

    if (arcoName) {
      activeArcoKeys.add(normalizeFieldLabel(arcoName));
    }
  });

  if (arcosSheet && activeArcoKeys.size === 0) {
    return [];
  }

  return disciplinasSheet.rows
    .map((row, rowIndex) => {
      const discipline = getCellValue(
        disciplinasSheet,
        row,
        DISCIPLINE_NAME_COLUMN,
      ).trim();

      if (!discipline) {
        return null;
      }

      const module = getCellValue(disciplinasSheet, row, DISCIPLINE_MODULE_COLUMN);
      const arco = getCellValue(disciplinasSheet, row, DISCIPLINE_ARC_COLUMN);
      const moduleKey = normalizeFieldLabel(module);
      const arcoKey = normalizeFieldLabel(arco);
      const isSharedModule = moduleKey === 'inicial' || moduleKey === 'basico';
      const isKnownArco =
        !arcosSheet ||
        activeArcoKeys.has(arcoKey) ||
        (isSharedModule && arcoKey === 'todos' && activeArcoKeys.size > 0);

      if (!isKnownArco) {
        return null;
      }

      return {
        disciplineId:
          getCellValue(disciplinasSheet, row, DISCIPLINE_ID_COLUMN) ||
          `disciplina-row-${rowIndex + 1}`,
        discipline,
        module,
        arco,
        workload: getCellValue(disciplinasSheet, row, DISCIPLINE_WORKLOAD_COLUMN),
      };
    })
    .filter((option): option is AulaCoverageOption => Boolean(option));
};

export const validateAulaCoverageSelections = (
  selections: AulaCoverageSelection[],
): AulaCoverageValidationResult => {
  const specificByArco = new Map<string, string>();
  const duplicateSpecificArcos = new Set<string>();

  selections.forEach((selection) => {
    if (!isSpecificDisciplineModule(selection.module)) {
      return;
    }

    const arcoKey = normalizeFieldLabel(selection.arco);

    if (!arcoKey) {
      return;
    }

    if (specificByArco.has(arcoKey)) {
      duplicateSpecificArcos.add(selection.arco);
      return;
    }

    specificByArco.set(arcoKey, selection.disciplineId);
  });

  return {
    isValid: duplicateSpecificArcos.size === 0,
    duplicateSpecificArcos: [...duplicateSpecificArcos],
  };
};
