import { type SheetTable } from './dataIndex';
import { getAcademicCellValue } from './academicProgress';
import { normalizeFieldLabel } from './schemas';

export const APRENDIZ_PROGRESS_OVERLAY_STORAGE_KEY =
  'sejaelevar.aprendizes.progressOverlay.v1';

export type AprendizProgressSheets = {
  planoProgresso: SheetTable | null;
  horasAplicadas: SheetTable | null;
  aulas: SheetTable | null;
};

const AULA_NAME_COLUMN = 'Aula';
const AULA_ID_COLUMN = 'ID';

const normalizeProgressModuleKey = (module: string) => {
  const key = normalizeFieldLabel(module);

  if (key.includes('inicial')) {
    return 0;
  }

  if (key.includes('basico')) {
    return 1;
  }

  if (key.includes('especifico')) {
    return 2;
  }

  return 3;
};

const formatProgressDate = (value: string) => {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return trimmedValue;
  }

  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
};

const getProgressHourNumber = (value: string) =>
  value
    .trim()
    .replace(/\s*(?:h|hora|horas)$/i, '')
    .trim() || '0';

const getProgressTotalHours = (value: string) =>
  `${getProgressHourNumber(value)}h`;

export const readSavedProgressOverlayOpen = () => {
  try {
    return (
      window.localStorage.getItem(APRENDIZ_PROGRESS_OVERLAY_STORAGE_KEY) ===
      'true'
    );
  } catch {
    return false;
  }
};

export const aprendizHasAppliedHours = (
  horasAplicadasSheet: SheetTable | null,
  aprendizId: string,
) => {
  if (!horasAplicadasSheet || !aprendizId) {
    return false;
  }

  return horasAplicadasSheet.rows.some(
    (row) =>
      getAcademicCellValue(horasAplicadasSheet, row, 'Aprendiz ID') ===
      aprendizId,
  );
};

export const getAprendizProgressItems = (
  sheets: AprendizProgressSheets,
  aprendizId: string,
) => {
  const progressSheet = sheets.planoProgresso;
  const horasSheet = sheets.horasAplicadas;
  const aulasSheet = sheets.aulas;

  if (!progressSheet || !aprendizId) {
    return [];
  }

  const aulaNameById = new Map<string, string>();

  aulasSheet?.rows.forEach((row) => {
    const aulaId = getAcademicCellValue(aulasSheet, row, AULA_ID_COLUMN);
    const aulaName = getAcademicCellValue(aulasSheet, row, AULA_NAME_COLUMN);

    if (aulaId && aulaName) {
      aulaNameById.set(aulaId, aulaName);
    }
  });

  return progressSheet.rows
    .filter(
      (row) =>
        getAcademicCellValue(progressSheet, row, 'Aprendiz ID') === aprendizId,
    )
    .map((row, rowIndex) => {
      const disciplineId = getAcademicCellValue(
        progressSheet,
        row,
        'Disciplina ID',
      );
      const discipline = getAcademicCellValue(progressSheet, row, 'Disciplina');
      const module = getAcademicCellValue(progressSheet, row, 'Módulo');
      const done = getProgressHourNumber(
        getAcademicCellValue(progressSheet, row, 'Carga Horária Cumprida'),
      );
      const total = getProgressTotalHours(
        getAcademicCellValue(progressSheet, row, 'Carga Horária Total'),
      );
      const appliedLessons =
        horasSheet?.rows
          .filter(
            (hoursRow) =>
              getAcademicCellValue(horasSheet, hoursRow, 'Aprendiz ID') ===
                aprendizId &&
              getAcademicCellValue(horasSheet, hoursRow, 'Disciplina ID') ===
                disciplineId,
          )
          .map((hoursRow, lessonIndex) => {
            const aulaId = getAcademicCellValue(
              horasSheet,
              hoursRow,
              'Aula ID',
            );
            const aula =
              aulaNameById.get(aulaId) ||
              getAcademicCellValue(horasSheet, hoursRow, 'Aula') ||
              'Aula';

            return {
              id: `${disciplineId || rowIndex}-${aulaId || aula}-${lessonIndex}`,
              aula,
              date: formatProgressDate(
                getAcademicCellValue(horasSheet, hoursRow, 'Data'),
              ),
            };
          }) ?? [];

      return {
        id: disciplineId || `${discipline}-${rowIndex}`,
        discipline,
        module,
        sortOrder: normalizeProgressModuleKey(module),
        progressLabel: `${done} / ${total}`,
        appliedLessons,
      };
    })
    .sort(
      (first, second) =>
        first.sortOrder - second.sortOrder ||
        normalizeFieldLabel(first.discipline).localeCompare(
          normalizeFieldLabel(second.discipline),
        ),
    );
};
