import {
  APRENDIZES_ENTITY_ID,
  ARCOS_ENTITY_ID,
  AULAS_DISCIPLINAS_ENTITY_ID,
  DISCIPLINAS_ENTITY_ID,
  HORAS_APLICADAS_ENTITY_ID,
  PLANO_ENSINO_ENTITY_ID,
  PLANO_PROGRESSO_ENTITY_ID,
  PRESENCAS_ENTITY_ID,
  type SheetTable,
} from './dataIndex';
import {
  APRENDIZES_REQUIRED_COLUMNS,
  AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
  ARCOS_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  HORAS_APLICADAS_REQUIRED_COLUMNS,
  PLANO_ENSINO_REQUIRED_COLUMNS,
  PLANO_PROGRESSO_REQUIRED_COLUMNS,
  PRESENCAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from './schemas';
import { getSheetRecordId } from './stableIds';
import {
  fetchBaseWorkbookFile,
  loadXlsx,
  persistManagedWorkbookDataIndexes,
  readWorkbookSheetFile,
  responseToWorkbookFile,
} from './workspaceData';

const APRENDIZ_NAME_COLUMN = 'Nome';
export const APRENDIZ_STATUS_COLUMN = 'Status';
const APRENDIZ_ARCO_COLUMN = 'Arco de Aprendizagem';
const ARCO_COLUMN = 'Arco';
const DISCIPLINA_COLUMN = 'Disciplina';
const MODULO_COLUMN = 'Módulo';
const CARGA_HORARIA_COLUMN = 'Carga Horária';
const ID_COLUMN = 'ID';
const AULA_COVERAGE_AULA_ID_COLUMN = 'Aula ID';
const AULA_COVERAGE_AULA_COLUMN = 'Aula';
const AULA_COVERAGE_ARCO_COLUMN = 'Arco';
const AULA_COVERAGE_MODULO_COLUMN = 'Módulo';
const AULA_COVERAGE_DISCIPLINA_COLUMN = 'Disciplina';
const AULA_COVERAGE_DISCIPLINA_ID_COLUMN = 'Disciplina ID';

export type AcademicWorkbookSheets = {
  aprendizes: SheetTable | null;
  arcos: SheetTable | null;
  disciplinas: SheetTable | null;
  aulasDisciplinas: SheetTable | null;
  planoEnsino: SheetTable | null;
  presencas: SheetTable | null;
  horasAplicadas: SheetTable | null;
  planoProgresso: SheetTable | null;
};

export type AcademicEventSnapshot = {
  id: string;
  turma: string;
  turmaId: string;
  date: string;
  start: string;
  end: string;
  aulaId: string;
  aula: string;
  instructor: string;
  room: string;
  durationMinutes: number;
};

export type AcademicAttendanceSelection = {
  aprendizId: string;
  aprendiz: string;
  arco: string;
  status: 'Presente' | 'Ausente';
};

const getColumnIndex = (sheet: SheetTable | null, columnName: string) =>
  sheet?.columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  ) ?? -1;

export const getAcademicCellValue = (
  sheet: SheetTable,
  row: readonly string[],
  columnName: string,
) => {
  const columnKey = normalizeFieldLabel(columnName);
  const matchingColumnIndexes = sheet.columns
    .map((column, columnIndex) =>
      normalizeFieldLabel(column) === columnKey ? columnIndex : -1,
    )
    .filter((columnIndex) => columnIndex >= 0);

  if (matchingColumnIndexes.length === 0) {
    return '';
  }

  const firstFilledValue = matchingColumnIndexes
    .map((columnIndex) => String(row[columnIndex] ?? '').trim())
    .find(Boolean);

  return firstFilledValue ?? String(row[matchingColumnIndexes[0]] ?? '').trim();
};

const createEmptySheet = (
  fileName: string,
  sheetName: string,
  columns: readonly string[],
): SheetTable => ({
  fileName,
  sheetName,
  importedAt: new Date().toISOString(),
  columns: [...columns],
  rows: [],
});

const readSheetWithFallback = async (
  file: File,
  entityId: string,
  sheetName: string,
  columns: readonly string[],
) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId,
      ensureRecordIds: false,
      preferredSheetName: sheetName,
      requiredColumns: columns,
    });
  } catch {
    return createEmptySheet(file.name, sheetName, columns);
  }
};

const ensureAprendizStatusSheet = (sheet: SheetTable | null) => {
  if (!sheet) {
    return null;
  }

  if (getColumnIndex(sheet, APRENDIZ_STATUS_COLUMN) >= 0) {
    return sheet;
  }

  return {
    ...sheet,
    columns: [...sheet.columns, APRENDIZ_STATUS_COLUMN],
    rows: sheet.rows.map((row) => [...row, 'Ativo']),
  };
};

export const readAcademicWorkbookSheets = async (
  file: File,
): Promise<AcademicWorkbookSheets> => ({
  aprendizes: await readSheetWithFallback(
    file,
    APRENDIZES_ENTITY_ID,
    'Aprendizes',
    APRENDIZES_REQUIRED_COLUMNS,
  ),
  arcos: await readSheetWithFallback(
    file,
    ARCOS_ENTITY_ID,
    'Arcos',
    ARCOS_REQUIRED_COLUMNS,
  ),
  disciplinas: await readSheetWithFallback(
    file,
    DISCIPLINAS_ENTITY_ID,
    'Disciplinas',
    DISCIPLINAS_REQUIRED_COLUMNS,
  ),
  aulasDisciplinas: await readSheetWithFallback(
    file,
    AULAS_DISCIPLINAS_ENTITY_ID,
    'Aulas Disciplinas',
    AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
  ),
  planoEnsino: await readSheetWithFallback(
    file,
    PLANO_ENSINO_ENTITY_ID,
    'Plano de Ensino',
    PLANO_ENSINO_REQUIRED_COLUMNS,
  ),
  presencas: await readSheetWithFallback(
    file,
    PRESENCAS_ENTITY_ID,
    'Presencas',
    PRESENCAS_REQUIRED_COLUMNS,
  ),
  horasAplicadas: await readSheetWithFallback(
    file,
    HORAS_APLICADAS_ENTITY_ID,
    'Horas Aplicadas',
    HORAS_APLICADAS_REQUIRED_COLUMNS,
  ),
  planoProgresso: await readSheetWithFallback(
    file,
    PLANO_PROGRESSO_ENTITY_ID,
    'Plano Progresso',
    PLANO_PROGRESSO_REQUIRED_COLUMNS,
  ),
});

const stableAcademicId = (prefix: string, parts: readonly string[]) => {
  const text = parts.map((part) => normalizeFieldLabel(part)).join('|');
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${prefix}_${(hash >>> 0).toString(36)}`;
};

const getRowByNormalizedValue = (
  sheet: SheetTable | null,
  columnName: string,
  value: string,
) => {
  const valueKey = normalizeFieldLabel(value);

  if (!sheet || !valueKey) {
    return null;
  }

  return (
    sheet.rows.find(
      (row) =>
        normalizeFieldLabel(getAcademicCellValue(sheet, row, columnName)) ===
        valueKey,
    ) ?? null
  );
};

const isSharedModule = (module: string) => {
  const moduleKey = normalizeFieldLabel(module);

  return moduleKey === 'inicial' || moduleKey === 'basico';
};

const isDisciplineForArco = (
  disciplineRow: readonly string[],
  disciplinasSheet: SheetTable,
  arco: string,
) => {
  const module = getAcademicCellValue(disciplinasSheet, disciplineRow, MODULO_COLUMN);
  const disciplineArco = getAcademicCellValue(
    disciplinasSheet,
    disciplineRow,
    ARCO_COLUMN,
  );

  if (isSharedModule(module)) {
    return normalizeFieldLabel(disciplineArco) === 'todos';
  }

  return normalizeFieldLabel(disciplineArco) === normalizeFieldLabel(arco);
};

const getPlanRow = (
  columns: readonly string[],
  values: {
    aprendiz: string;
    arco: string;
    module: string;
    discipline: string;
    workload: string;
    aprendizId: string;
    arcoId: string;
    disciplineId: string;
    id: string;
  },
) =>
  columns.map((column) => {
    switch (normalizeFieldLabel(column)) {
      case 'aprendiz':
        return values.aprendiz;
      case 'arco':
        return values.arco;
      case 'modulo':
        return values.module;
      case 'disciplina':
        return values.discipline;
      case 'carga horaria total':
        return values.workload;
      case 'aprendiz id':
        return values.aprendizId;
      case 'arco id':
        return values.arcoId;
      case 'disciplina id':
        return values.disciplineId;
      case 'id':
        return values.id;
      default:
        return '';
    }
  });

export const buildPlanoEnsinoSheet = (
  fileName: string,
  aprendizesSheet: SheetTable | null,
  arcosSheet: SheetTable | null,
  disciplinasSheet: SheetTable | null,
): SheetTable => {
  const columns = [...PLANO_ENSINO_REQUIRED_COLUMNS];

  if (!aprendizesSheet || !disciplinasSheet) {
    return createEmptySheet(fileName, 'Plano de Ensino', columns);
  }

  const rows = aprendizesSheet.rows.flatMap((aprendizRow, rowIndex) => {
    const aprendiz = getAcademicCellValue(
      aprendizesSheet,
      aprendizRow,
      APRENDIZ_NAME_COLUMN,
    );
    const arco = getAcademicCellValue(
      aprendizesSheet,
      aprendizRow,
      APRENDIZ_ARCO_COLUMN,
    );

    if (!aprendiz || !arco) {
      return [];
    }

    const aprendizId = getSheetRecordId(
      aprendizesSheet,
      rowIndex,
      APRENDIZES_ENTITY_ID,
    );
    const arcoRow = getRowByNormalizedValue(arcosSheet, ARCO_COLUMN, arco);
    const arcoId = arcoRow && arcosSheet
      ? getAcademicCellValue(arcosSheet, arcoRow, ID_COLUMN)
      : '';

    return disciplinasSheet.rows
      .filter((disciplineRow) =>
        isDisciplineForArco(disciplineRow, disciplinasSheet, arco),
      )
      .map((disciplineRow, disciplineRowIndex) => {
        const discipline = getAcademicCellValue(
          disciplinasSheet,
          disciplineRow,
          DISCIPLINA_COLUMN,
        );
        const module = getAcademicCellValue(
          disciplinasSheet,
          disciplineRow,
          MODULO_COLUMN,
        );
        const workload = getAcademicCellValue(
          disciplinasSheet,
          disciplineRow,
          CARGA_HORARIA_COLUMN,
        );
        const disciplineId =
          getAcademicCellValue(disciplinasSheet, disciplineRow, ID_COLUMN) ||
          getSheetRecordId(
            disciplinasSheet,
            disciplineRowIndex,
            DISCIPLINAS_ENTITY_ID,
          );

        return getPlanRow(columns, {
          aprendiz,
          arco,
          module,
          discipline,
          workload,
          aprendizId,
          arcoId,
          disciplineId,
          id: stableAcademicId('plano', [aprendizId, disciplineId]),
        });
      });
  });

  return {
    fileName,
    sheetName: 'Plano de Ensino',
    importedAt: new Date().toISOString(),
    columns,
    rows,
  };
};

const parseWorkloadMinutes = (value: string) => {
  const normalizedValue = value
    .toLowerCase()
    .replace('horas', '')
    .replace('hora', '')
    .replace('h', '')
    .replace(',', '.')
    .trim();
  const parsedHours = Number.parseFloat(normalizedValue);

  return Number.isFinite(parsedHours) ? Math.round(parsedHours * 60) : 0;
};

const formatMinutesAsHours = (minutes: number) => {
  if (minutes <= 0) {
    return '0h';
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }

  return `${String(Math.round((minutes / 60) * 100) / 100).replace('.', ',')}h`;
};

const getProgressRow = (
  columns: readonly string[],
  values: {
    aprendiz: string;
    arco: string;
    module: string;
    discipline: string;
    total: string;
    done: string;
    excess: string;
    aprendizId: string;
    disciplineId: string;
    id: string;
  },
) =>
  columns.map((column) => {
    switch (normalizeFieldLabel(column)) {
      case 'aprendiz':
        return values.aprendiz;
      case 'arco':
        return values.arco;
      case 'modulo':
        return values.module;
      case 'disciplina':
        return values.discipline;
      case 'carga horaria total':
        return values.total;
      case 'carga horaria cumprida':
        return values.done;
      case 'excedente':
        return values.excess;
      case 'aprendiz id':
        return values.aprendizId;
      case 'disciplina id':
        return values.disciplineId;
      case 'id':
        return values.id;
      default:
        return '';
    }
  });

export const buildPlanoProgressoSheet = (
  fileName: string,
  planoEnsinoSheet: SheetTable | null,
  horasAplicadasSheet: SheetTable | null,
): SheetTable => {
  const columns = [...PLANO_PROGRESSO_REQUIRED_COLUMNS];

  if (!planoEnsinoSheet) {
    return createEmptySheet(fileName, 'Plano Progresso', columns);
  }

  const minutesByPlanKey = new Map<string, number>();

  horasAplicadasSheet?.rows.forEach((row) => {
    const aprendizId = getAcademicCellValue(
      horasAplicadasSheet,
      row,
      'Aprendiz ID',
    );
    const disciplineId = getAcademicCellValue(
      horasAplicadasSheet,
      row,
      'Disciplina ID',
    );
    const minutes =
      Number.parseInt(
        getAcademicCellValue(horasAplicadasSheet, row, 'Minutos Aplicados'),
        10,
      ) || 0;
    const key = `${aprendizId}|${disciplineId}`;

    minutesByPlanKey.set(key, (minutesByPlanKey.get(key) ?? 0) + minutes);
  });

  const rows = planoEnsinoSheet.rows.map((row) => {
    const aprendiz = getAcademicCellValue(planoEnsinoSheet, row, 'Aprendiz');
    const arco = getAcademicCellValue(planoEnsinoSheet, row, 'Arco');
    const module = getAcademicCellValue(planoEnsinoSheet, row, 'Módulo');
    const discipline = getAcademicCellValue(planoEnsinoSheet, row, 'Disciplina');
    const total = getAcademicCellValue(
      planoEnsinoSheet,
      row,
      'Carga Horária Total',
    );
    const aprendizId = getAcademicCellValue(planoEnsinoSheet, row, 'Aprendiz ID');
    const disciplineId = getAcademicCellValue(
      planoEnsinoSheet,
      row,
      'Disciplina ID',
    );
    const doneMinutes = minutesByPlanKey.get(`${aprendizId}|${disciplineId}`) ?? 0;
    const totalMinutes = parseWorkloadMinutes(total);
    const excessMinutes = Math.max(0, doneMinutes - totalMinutes);

    return getProgressRow(columns, {
      aprendiz,
      arco,
      module,
      discipline,
      total,
      done: formatMinutesAsHours(doneMinutes),
      excess: formatMinutesAsHours(excessMinutes),
      aprendizId,
      disciplineId,
      id: stableAcademicId('progresso', [aprendizId, disciplineId]),
    });
  });

  return {
    fileName,
    sheetName: 'Plano Progresso',
    importedAt: new Date().toISOString(),
    columns,
    rows,
  };
};

const getAttendanceRow = (
  columns: readonly string[],
  values: {
    aprendiz: string;
    status: string;
    turma: string;
    date: string;
    start: string;
    end: string;
    aula: string;
    instructor: string;
    room: string;
    eventId: string;
    aulaId: string;
    aprendizId: string;
    turmaId: string;
    id: string;
  },
) =>
  columns.map((column) => {
    switch (normalizeFieldLabel(column)) {
      case 'aprendiz':
        return values.aprendiz;
      case 'status presenca':
        return values.status;
      case 'turma':
        return values.turma;
      case 'data':
        return values.date;
      case 'inicio':
        return values.start;
      case 'fim':
        return values.end;
      case 'aula':
        return values.aula;
      case 'instrutor':
        return values.instructor;
      case 'sala':
        return values.room;
      case 'evento id':
        return values.eventId;
      case 'aula id':
        return values.aulaId;
      case 'aprendiz id':
        return values.aprendizId;
      case 'turma id':
        return values.turmaId;
      case 'id':
        return values.id;
      default:
        return '';
    }
  });

const getAppliedHoursRow = (
  columns: readonly string[],
  values: {
    aprendiz: string;
    arco: string;
    module: string;
    discipline: string;
    minutes: string;
    date: string;
    aula: string;
    eventId: string;
    presencaId: string;
    aprendizId: string;
    disciplineId: string;
    aulaId: string;
    id: string;
  },
) =>
  columns.map((column) => {
    switch (normalizeFieldLabel(column)) {
      case 'aprendiz':
        return values.aprendiz;
      case 'arco':
        return values.arco;
      case 'modulo':
        return values.module;
      case 'disciplina':
        return values.discipline;
      case 'minutos aplicados':
        return values.minutes;
      case 'data':
        return values.date;
      case 'aula':
        return values.aula;
      case 'evento id':
        return values.eventId;
      case 'presenca id':
        return values.presencaId;
      case 'aprendiz id':
        return values.aprendizId;
      case 'disciplina id':
        return values.disciplineId;
      case 'aula id':
        return values.aulaId;
      case 'id':
        return values.id;
      default:
        return '';
    }
  });

const normalizeDisciplineMatchKey = (value: string) =>
  normalizeFieldLabel(value)
    .replace(/\s+-?\s*\d+(?:[,.]\d+)?\s*h(?:oras?)?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const getPlanDisciplineForCoverage = (
  planoEnsinoSheet: SheetTable | null,
  selection: AcademicAttendanceSelection,
  coverage: {
    arco: string;
    module: string;
    discipline: string;
    disciplineId: string;
  },
) => {
  if (!planoEnsinoSheet) {
    return null;
  }

  const coverageModuleKey = normalizeFieldLabel(coverage.module);
  const coverageDisciplineKey = normalizeDisciplineMatchKey(coverage.discipline);
  const coverageDisciplineIdKey = normalizeFieldLabel(coverage.disciplineId);

  return (
    planoEnsinoSheet.rows.find((row) => {
      const rowAprendizId = getAcademicCellValue(
        planoEnsinoSheet,
        row,
        'Aprendiz ID',
      );

      if (rowAprendizId !== selection.aprendizId) {
        return false;
      }

      const rowDisciplineId = getAcademicCellValue(
        planoEnsinoSheet,
        row,
        'Disciplina ID',
      );

      if (
        coverageDisciplineIdKey &&
        normalizeFieldLabel(rowDisciplineId) === coverageDisciplineIdKey
      ) {
        return true;
      }

      const rowModule = getAcademicCellValue(planoEnsinoSheet, row, 'Módulo');
      const rowDiscipline = getAcademicCellValue(
        planoEnsinoSheet,
        row,
        'Disciplina',
      );

      if (normalizeFieldLabel(rowModule) !== coverageModuleKey) {
        return false;
      }

      const rowDisciplineKey = normalizeDisciplineMatchKey(rowDiscipline);
      const canUsePartialMatch =
        rowDisciplineKey.length >= 8 && coverageDisciplineKey.length >= 8;

      return (
        rowDisciplineKey === coverageDisciplineKey ||
        (canUsePartialMatch &&
          (rowDisciplineKey.includes(coverageDisciplineKey) ||
            coverageDisciplineKey.includes(rowDisciplineKey)))
      );
    }) ?? null
  );
};

const isCoverageForAula = (
  coverageSheet: SheetTable,
  row: readonly string[],
  event: AcademicEventSnapshot,
) => {
  const coverageAulaId = getAcademicCellValue(
    coverageSheet,
    row,
    AULA_COVERAGE_AULA_ID_COLUMN,
  );
  const coverageAula = getAcademicCellValue(
    coverageSheet,
    row,
    AULA_COVERAGE_AULA_COLUMN,
  );

  return (
    (event.aulaId && coverageAulaId === event.aulaId) ||
    (!event.aulaId &&
      normalizeFieldLabel(coverageAula) === normalizeFieldLabel(event.aula))
  );
};

const getCoverageRowsForAttendance = (
  coverageSheet: SheetTable | null,
  event: AcademicEventSnapshot,
  aprendizArco: string,
) => {
  if (!coverageSheet || !event.aula) {
    return [];
  }

  return coverageSheet.rows.filter((row) => {
    if (!isCoverageForAula(coverageSheet, row, event)) {
      return false;
    }

    const module = getAcademicCellValue(
      coverageSheet,
      row,
      AULA_COVERAGE_MODULO_COLUMN,
    );

    if (isSharedModule(module)) {
      return true;
    }

    return (
      normalizeFieldLabel(
        getAcademicCellValue(coverageSheet, row, AULA_COVERAGE_ARCO_COLUMN),
      ) === normalizeFieldLabel(aprendizArco)
    );
  });
};

export const validateAcademicAttendance = (
  planoEnsinoSheet: SheetTable | null,
  aulasDisciplinasSheet: SheetTable | null,
  event: AcademicEventSnapshot,
  selections: AcademicAttendanceSelection[],
) => {
  const presentSelections = selections.filter(
    (selection) => selection.status === 'Presente',
  );

  if (presentSelections.length === 0) {
    return { ok: true as const };
  }

  if (!event.aulaId && !event.aula) {
    return {
      ok: false as const,
      message: 'Selecione uma aula antes de registrar presença.',
    };
  }

  if (!aulasDisciplinasSheet) {
    return {
      ok: false as const,
      message:
        'A aula selecionada ainda não possui disciplinas vinculadas para contabilizar horas.',
    };
  }

  const aulaCoverageRows = aulasDisciplinasSheet.rows.filter((row) =>
    isCoverageForAula(aulasDisciplinasSheet, row, event),
  );

  if (aulaCoverageRows.length === 0) {
    return {
      ok: false as const,
      message:
        'A aula selecionada ainda não possui disciplinas vinculadas para contabilizar horas.',
    };
  }

  return { ok: true as const };
};

export const updateAcademicAttendance = (
  fileName: string,
  presencasSheet: SheetTable | null,
  horasAplicadasSheet: SheetTable | null,
  planoEnsinoSheet: SheetTable | null,
  aulasDisciplinasSheet: SheetTable | null,
  event: AcademicEventSnapshot,
  selections: AcademicAttendanceSelection[],
) => {
  const presencasColumns = [...PRESENCAS_REQUIRED_COLUMNS];
  const horasColumns = [...HORAS_APLICADAS_REQUIRED_COLUMNS];
  const selectedAprendizIds = new Set(
    selections.map((selection) => selection.aprendizId),
  );
  const existingPresencasRows = presencasSheet?.rows ?? [];
  const existingHorasRows = horasAplicadasSheet?.rows ?? [];
  const retainedPresencasRows = existingPresencasRows.filter((row) => {
    const rowEventId = presencasSheet
      ? getAcademicCellValue(presencasSheet, row, 'Evento ID')
      : '';
    const rowAprendizId = presencasSheet
      ? getAcademicCellValue(presencasSheet, row, 'Aprendiz ID')
      : '';

    return rowEventId !== event.id || !selectedAprendizIds.has(rowAprendizId);
  });
  const nextPresencasRows = [...retainedPresencasRows];
  const nextPresencaIds = new Set<string>();

  selections.forEach((selection) => {
    const presencaId = stableAcademicId('presenca', [
      event.id,
      selection.aprendizId,
    ]);
    nextPresencaIds.add(presencaId);
    nextPresencasRows.push(
      getAttendanceRow(presencasColumns, {
        aprendiz: selection.aprendiz,
        status: selection.status,
        turma: event.turma,
        date: event.date,
        start: event.start,
        end: event.end,
        aula: event.aula,
        instructor: event.instructor,
        room: event.room,
        eventId: event.id,
        aulaId: event.aulaId,
        aprendizId: selection.aprendizId,
        turmaId: event.turmaId,
        id: presencaId,
      }),
    );
  });

  const retainedHorasRows = existingHorasRows.filter((row) => {
    const rowEventId = horasAplicadasSheet
      ? getAcademicCellValue(horasAplicadasSheet, row, 'Evento ID')
      : '';
    const rowPresencaId = horasAplicadasSheet
      ? getAcademicCellValue(horasAplicadasSheet, row, 'Presença ID')
      : '';

    return rowEventId !== event.id || !nextPresencaIds.has(rowPresencaId);
  });
  const nextHorasRows = [...retainedHorasRows];

  selections
    .filter((selection) => selection.status === 'Presente')
    .forEach((selection) => {
      const presencaId = stableAcademicId('presenca', [
        event.id,
        selection.aprendizId,
      ]);
      const coverageRows = getCoverageRowsForAttendance(
        aulasDisciplinasSheet,
        event,
        selection.arco,
      );

      coverageRows.forEach((coverageRow) => {
        if (!aulasDisciplinasSheet) {
          return;
        }

        const coverageDisciplineId = getAcademicCellValue(
          aulasDisciplinasSheet,
          coverageRow,
          AULA_COVERAGE_DISCIPLINA_ID_COLUMN,
        );
        const discipline = getAcademicCellValue(
          aulasDisciplinasSheet,
          coverageRow,
          AULA_COVERAGE_DISCIPLINA_COLUMN,
        );
        const module = getAcademicCellValue(
          aulasDisciplinasSheet,
          coverageRow,
          AULA_COVERAGE_MODULO_COLUMN,
        );
        const arco = isSharedModule(module)
          ? selection.arco
          : getAcademicCellValue(
              aulasDisciplinasSheet,
              coverageRow,
              AULA_COVERAGE_ARCO_COLUMN,
            );
        const planDisciplineRow = getPlanDisciplineForCoverage(
          planoEnsinoSheet,
          selection,
          {
            arco,
            module,
            discipline,
            disciplineId: coverageDisciplineId,
          },
        );

        if (!planDisciplineRow || !planoEnsinoSheet) {
          return;
        }

        const canonicalArco = getAcademicCellValue(
          planoEnsinoSheet,
          planDisciplineRow,
          'Arco',
        );
        const canonicalModule = getAcademicCellValue(
          planoEnsinoSheet,
          planDisciplineRow,
          'Módulo',
        );
        const canonicalDiscipline = getAcademicCellValue(
          planoEnsinoSheet,
          planDisciplineRow,
          'Disciplina',
        );
        const canonicalDisciplineId = getAcademicCellValue(
          planoEnsinoSheet,
          planDisciplineRow,
          'Disciplina ID',
        );

        nextHorasRows.push(
          getAppliedHoursRow(horasColumns, {
            aprendiz: selection.aprendiz,
            arco: canonicalArco || arco,
            module: canonicalModule || module,
            discipline: canonicalDiscipline || discipline,
            minutes: String(event.durationMinutes),
            date: event.date,
            aula: event.aula,
            eventId: event.id,
            presencaId,
            aprendizId: selection.aprendizId,
            disciplineId: canonicalDisciplineId || coverageDisciplineId,
            aulaId: event.aulaId,
            id: stableAcademicId('hora', [
              presencaId,
              canonicalDisciplineId || coverageDisciplineId,
            ]),
          }),
        );
      });
    });

  const nextPresencasSheet: SheetTable = {
    fileName,
    sheetName: 'Presencas',
    importedAt: new Date().toISOString(),
    columns: presencasColumns,
    rows: nextPresencasRows,
  };
  const nextHorasAplicadasSheet: SheetTable = {
    fileName,
    sheetName: 'Horas Aplicadas',
    importedAt: new Date().toISOString(),
    columns: horasColumns,
    rows: nextHorasRows,
  };
  const nextPlanoProgressoSheet = buildPlanoProgressoSheet(
    fileName,
    planoEnsinoSheet,
    nextHorasAplicadasSheet,
  );

  return {
    presencasSheet: nextPresencasSheet,
    horasAplicadasSheet: nextHorasAplicadasSheet,
    planoProgressoSheet: nextPlanoProgressoSheet,
  };
};

export const saveWorkbookSheets = async (sheets: SheetTable[]) => {
  const sourceResponse = await fetch('/api/base-workbook/file', {
    cache: 'no-store',
  });

  if (!sourceResponse.ok) {
    throw new Error('read-failed');
  }

  const { read, utils, write } = await loadXlsx();
  const sourceFile = await responseToWorkbookFile(
    sourceResponse,
    'DadosElevar.xlsx',
  );
  const workbook = read(await sourceFile.arrayBuffer(), {
    cellDates: true,
  });

  sheets.forEach((sheet) => {
    const sheetName =
      workbook.SheetNames.find(
        (name) =>
          normalizeFieldLabel(name) === normalizeFieldLabel(sheet.sheetName),
      ) ?? sheet.sheetName.slice(0, 31);

    workbook.Sheets[sheetName] = utils.aoa_to_sheet([
      sheet.columns,
      ...sheet.rows,
    ]);

    if (!workbook.SheetNames.includes(sheetName)) {
      workbook.SheetNames.push(sheetName);
    }
  });

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
    throw new Error('save-failed');
  }

  const savedFile = await fetchBaseWorkbookFile();

  await persistManagedWorkbookDataIndexes(savedFile);

  return savedFile;
};

const sheetsAreEqual = (first: SheetTable, second: SheetTable) =>
  JSON.stringify([first.columns, first.rows]) ===
  JSON.stringify([second.columns, second.rows]);

export const syncAcademicWorkbookFromSource = async () => {
  const file = await fetchBaseWorkbookFile().catch(() => null);

  if (!file) {
    return null;
  }

  const sheets = await readAcademicWorkbookSheets(file);
  const nextAprendizesSheet = ensureAprendizStatusSheet(sheets.aprendizes);
  const nextPlanoEnsinoSheet = buildPlanoEnsinoSheet(
    file.name,
    nextAprendizesSheet,
    sheets.arcos,
    sheets.disciplinas,
  );
  const nextPlanoProgressoSheet = buildPlanoProgressoSheet(
    file.name,
    nextPlanoEnsinoSheet,
    sheets.horasAplicadas,
  );
  const sheetsToSave: SheetTable[] = [];

  if (
    nextAprendizesSheet &&
    (!sheets.aprendizes || !sheetsAreEqual(sheets.aprendizes, nextAprendizesSheet))
  ) {
    sheetsToSave.push(nextAprendizesSheet);
  }

  if (
    !sheets.planoEnsino ||
    !sheetsAreEqual(sheets.planoEnsino, nextPlanoEnsinoSheet)
  ) {
    sheetsToSave.push(nextPlanoEnsinoSheet);
  }

  if (
    !sheets.planoProgresso ||
    !sheetsAreEqual(sheets.planoProgresso, nextPlanoProgressoSheet)
  ) {
    sheetsToSave.push(nextPlanoProgressoSheet);
  }

  if (sheetsToSave.length === 0) {
    await persistManagedWorkbookDataIndexes(file);
    return file;
  }

  return saveWorkbookSheets(sheetsToSave);
};
