import {
  APRENDIZES_ENTITY_ID,
  ARCOS_ENTITY_ID,
  AULAS_DISCIPLINAS_ENTITY_ID,
  AULAS_ENTITY_ID,
  CRONOGRAMA_ENTITY_ID,
  DISCIPLINAS_ENTITY_ID,
  HORAS_APLICADAS_ENTITY_ID,
  PLANO_ENSINO_ENTITY_ID,
  PLANO_PROGRESSO_ENTITY_ID,
  PRESENCAS_ENTITY_ID,
  TURMAS_ENTITY_ID,
  type SheetTable,
} from './dataIndex';
import {
  APRENDIZES_REQUIRED_COLUMNS,
  ARCOS_REQUIRED_COLUMNS,
  AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
  AULAS_REQUIRED_COLUMNS,
  CRONOGRAMA_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  HORAS_APLICADAS_REQUIRED_COLUMNS,
  PLANO_ENSINO_REQUIRED_COLUMNS,
  PLANO_PROGRESSO_REQUIRED_COLUMNS,
  PRESENCAS_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from './schemas';
import {
  fetchBaseWorkbookFile,
  readWorkbookSheetFile,
} from './workspaceData';

export type DataHealthSeverity = 'error' | 'warning' | 'info';

export type DataHealthIssue = {
  id: string;
  severity: DataHealthSeverity;
  area: string;
  title: string;
  detail: string;
};

export type DataHealthReport = {
  hasWorkbook: boolean;
  checkedAt: string;
  fileName: string | null;
  issues: DataHealthIssue[];
};

type SheetDefinition = {
  entityId: string;
  sheetName: string;
  requiredColumns: readonly string[];
};

const SHEET_DEFINITIONS = {
  aprendizes: {
    entityId: APRENDIZES_ENTITY_ID,
    sheetName: 'Aprendizes',
    requiredColumns: APRENDIZES_REQUIRED_COLUMNS,
  },
  turmas: {
    entityId: TURMAS_ENTITY_ID,
    sheetName: 'Turmas',
    requiredColumns: TURMAS_REQUIRED_COLUMNS,
  },
  arcos: {
    entityId: ARCOS_ENTITY_ID,
    sheetName: 'Arcos',
    requiredColumns: ARCOS_REQUIRED_COLUMNS,
  },
  disciplinas: {
    entityId: DISCIPLINAS_ENTITY_ID,
    sheetName: 'Disciplinas',
    requiredColumns: DISCIPLINAS_REQUIRED_COLUMNS,
  },
  aulas: {
    entityId: AULAS_ENTITY_ID,
    sheetName: 'Aulas',
    requiredColumns: AULAS_REQUIRED_COLUMNS,
  },
  aulasDisciplinas: {
    entityId: AULAS_DISCIPLINAS_ENTITY_ID,
    sheetName: 'Aulas Disciplinas',
    requiredColumns: AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
  },
  cronograma: {
    entityId: CRONOGRAMA_ENTITY_ID,
    sheetName: 'Cronograma',
    requiredColumns: CRONOGRAMA_REQUIRED_COLUMNS,
  },
  presencas: {
    entityId: PRESENCAS_ENTITY_ID,
    sheetName: 'Presencas',
    requiredColumns: PRESENCAS_REQUIRED_COLUMNS,
  },
  horasAplicadas: {
    entityId: HORAS_APLICADAS_ENTITY_ID,
    sheetName: 'Horas Aplicadas',
    requiredColumns: HORAS_APLICADAS_REQUIRED_COLUMNS,
  },
  planoEnsino: {
    entityId: PLANO_ENSINO_ENTITY_ID,
    sheetName: 'Plano de Ensino',
    requiredColumns: PLANO_ENSINO_REQUIRED_COLUMNS,
  },
  planoProgresso: {
    entityId: PLANO_PROGRESSO_ENTITY_ID,
    sheetName: 'Plano Progresso',
    requiredColumns: PLANO_PROGRESSO_REQUIRED_COLUMNS,
  },
} as const satisfies Record<string, SheetDefinition>;

type HealthSheets = {
  aprendizes: SheetTable;
  turmas: SheetTable;
  arcos: SheetTable;
  disciplinas: SheetTable;
  aulas: SheetTable;
  aulasDisciplinas: SheetTable;
  cronograma: SheetTable;
  presencas: SheetTable;
  horasAplicadas: SheetTable;
  planoEnsino: SheetTable;
  planoProgresso: SheetTable;
};

const createEmptySheet = (
  fileName: string,
  definition: SheetDefinition,
): SheetTable => ({
  fileName,
  sheetName: definition.sheetName,
  importedAt: new Date().toISOString(),
  columns: [...definition.requiredColumns],
  rows: [],
});

const readHealthSheet = async (file: File, definition: SheetDefinition) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: definition.entityId,
      ensureRecordIds: false,
      preferredSheetName: definition.sheetName,
      requiredColumns: definition.requiredColumns,
    });
  } catch {
    return createEmptySheet(file.name, definition);
  }
};

const readHealthSheets = async (file: File): Promise<HealthSheets> => ({
  aprendizes: await readHealthSheet(file, SHEET_DEFINITIONS.aprendizes),
  turmas: await readHealthSheet(file, SHEET_DEFINITIONS.turmas),
  arcos: await readHealthSheet(file, SHEET_DEFINITIONS.arcos),
  disciplinas: await readHealthSheet(file, SHEET_DEFINITIONS.disciplinas),
  aulas: await readHealthSheet(file, SHEET_DEFINITIONS.aulas),
  aulasDisciplinas: await readHealthSheet(
    file,
    SHEET_DEFINITIONS.aulasDisciplinas,
  ),
  cronograma: await readHealthSheet(file, SHEET_DEFINITIONS.cronograma),
  presencas: await readHealthSheet(file, SHEET_DEFINITIONS.presencas),
  horasAplicadas: await readHealthSheet(
    file,
    SHEET_DEFINITIONS.horasAplicadas,
  ),
  planoEnsino: await readHealthSheet(file, SHEET_DEFINITIONS.planoEnsino),
  planoProgresso: await readHealthSheet(file, SHEET_DEFINITIONS.planoProgresso),
});

const getColumnIndex = (sheet: SheetTable, columnName: string) =>
  sheet.columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  );

const getCellValue = (
  sheet: SheetTable,
  row: readonly string[],
  columnName: string,
) => {
  const columnIndex = getColumnIndex(sheet, columnName);

  return columnIndex >= 0 ? String(row[columnIndex] ?? '').trim() : '';
};

const getRowsByValue = (
  sheet: SheetTable,
  columnName: string,
  value: string,
) => {
  const valueKey = normalizeFieldLabel(value);

  if (!valueKey) {
    return [];
  }

  return sheet.rows.filter(
    (row) => normalizeFieldLabel(getCellValue(sheet, row, columnName)) === valueKey,
  );
};

const createLookup = (sheet: SheetTable, columnName: string) => {
  const lookup = new Set<string>();

  sheet.rows.forEach((row) => {
    const value = normalizeFieldLabel(getCellValue(sheet, row, columnName));

    if (value) {
      lookup.add(value);
    }
  });

  return lookup;
};

const pushIssue = (
  issues: DataHealthIssue[],
  issue: Omit<DataHealthIssue, 'id'>,
) => {
  issues.push({
    id: `${issue.area}-${issue.title}-${issues.length}`,
    ...issue,
  });
};

const getCoverageDisciplineIds = (
  sheets: HealthSheets,
  aulaId: string,
  aulaName: string,
) => {
  const coverageRowsById = getRowsByValue(
    sheets.aulasDisciplinas,
    'Aula ID',
    aulaId,
  );
  const coverageRows =
    coverageRowsById.length > 0
      ? coverageRowsById
      : getRowsByValue(sheets.aulasDisciplinas, 'Aula', aulaName);

  return new Set(
    coverageRows
      .map((row) => getCellValue(sheets.aulasDisciplinas, row, 'Disciplina ID'))
      .filter(Boolean),
  );
};

const hasMatchingAppliedHours = (
  sheets: HealthSheets,
  presencaId: string,
  aprendizId: string,
  coveredDisciplineIds: Set<string>,
) =>
  sheets.horasAplicadas.rows.some((row) => {
    const rowPresencaId = getCellValue(
      sheets.horasAplicadas,
      row,
      'Presença ID',
    );
    const rowAprendizId = getCellValue(
      sheets.horasAplicadas,
      row,
      'Aprendiz ID',
    );
    const rowDisciplinaId = getCellValue(
      sheets.horasAplicadas,
      row,
      'Disciplina ID',
    );

    return (
      rowPresencaId === presencaId &&
      rowAprendizId === aprendizId &&
      coveredDisciplineIds.has(rowDisciplinaId)
    );
  });

const buildDataHealthIssues = (sheets: HealthSheets) => {
  const issues: DataHealthIssue[] = [];
  const arcoNames = createLookup(sheets.arcos, 'Arco');
  const turmaNames = createLookup(sheets.turmas, 'Turma');
  const aulaIds = createLookup(sheets.aulas, 'ID');
  const aulaNames = createLookup(sheets.aulas, 'Aula');
  const presentePresencaIds = new Set<string>();

  sheets.aprendizes.rows.forEach((row) => {
    const aprendiz = getCellValue(sheets.aprendizes, row, 'Nome') || 'Aprendiz';
    const aprendizId = getCellValue(sheets.aprendizes, row, 'ID');
    const arco = getCellValue(sheets.aprendizes, row, 'Arco de Aprendizagem');
    const turma = getCellValue(sheets.aprendizes, row, 'Turma');

    if (!arco) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Aprendizes',
        title: 'Aprendiz sem Arco',
        detail: `${aprendiz} ainda não possui Arco de Aprendizagem.`,
      });
    } else if (!arcoNames.has(normalizeFieldLabel(arco))) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Aprendizes',
        title: 'Arco não cadastrado',
        detail: `${aprendiz} usa o arco "${arco}", mas esse arco não existe em Arcos.`,
      });
    }

    if (!turma) {
      pushIssue(issues, {
        severity: 'info',
        area: 'Aprendizes',
        title: 'Aprendiz sem Turma',
        detail: `${aprendiz} ainda não está vinculado a uma Turma.`,
      });
    } else if (!turmaNames.has(normalizeFieldLabel(turma))) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Aprendizes',
        title: 'Turma não cadastrada',
        detail: `${aprendiz} usa a turma "${turma}", mas essa turma não existe em Turmas.`,
      });
    }

    if (
      arco &&
      aprendizId &&
      getRowsByValue(sheets.planoEnsino, 'Aprendiz ID', aprendizId).length === 0
    ) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Plano de Ensino',
        title: 'Plano não gerado',
        detail: `${aprendiz} possui arco, mas não possui linhas em Plano de Ensino.`,
      });
    }
  });

  sheets.aulas.rows.forEach((row) => {
    const aula = getCellValue(sheets.aulas, row, 'Aula') || 'Aula sem nome';
    const aulaId = getCellValue(sheets.aulas, row, 'ID');
    const coverageRowsById = getRowsByValue(
      sheets.aulasDisciplinas,
      'Aula ID',
      aulaId,
    );
    const coverageRows =
      coverageRowsById.length > 0
        ? coverageRowsById
        : getRowsByValue(sheets.aulasDisciplinas, 'Aula', aula);

    if (coverageRows.length === 0) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Aulas',
        title: 'Aula sem Disciplinas',
        detail: `${aula} não cobre nenhuma Disciplina.`,
      });
    }
  });

  sheets.cronograma.rows.forEach((row) => {
    const data = getCellValue(sheets.cronograma, row, 'Data') || '-';
    const inicio = getCellValue(sheets.cronograma, row, 'Início') || '-';
    const aula = getCellValue(sheets.cronograma, row, 'Aula');
    const aulaId = getCellValue(sheets.cronograma, row, 'Aula ID');
    const turma = getCellValue(sheets.cronograma, row, 'Turma');

    if (!turma) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Cronograma',
        title: 'Evento sem Turma',
        detail: `Evento em ${data} ${inicio} ainda não possui Turma.`,
      });
    } else if (!turmaNames.has(normalizeFieldLabel(turma))) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Cronograma',
        title: 'Evento com Turma não cadastrada',
        detail: `Evento em ${data} ${inicio} usa "${turma}", mas essa Turma não existe.`,
      });
    }

    if (!aula && !aulaId) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Cronograma',
        title: 'Evento sem Aula',
        detail: `Evento em ${data} ${inicio} ainda não possui Aula selecionada.`,
      });
      return;
    }

    const hasKnownAula =
      (aulaId && aulaIds.has(normalizeFieldLabel(aulaId))) ||
      (aula && aulaNames.has(normalizeFieldLabel(aula)));

    if (!hasKnownAula) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Cronograma',
        title: 'Evento com Aula não cadastrada',
        detail: `Evento em ${data} ${inicio} usa "${aula || aulaId}", mas essa Aula não existe.`,
      });
    }
  });

  sheets.presencas.rows.forEach((row) => {
    const status = getCellValue(sheets.presencas, row, 'Status Presença');

    if (normalizeFieldLabel(status) !== 'presente') {
      return;
    }

    const presencaId = getCellValue(sheets.presencas, row, 'ID');
    const aprendiz = getCellValue(sheets.presencas, row, 'Aprendiz') || 'Aprendiz';
    const aprendizId = getCellValue(sheets.presencas, row, 'Aprendiz ID');
    const aula = getCellValue(sheets.presencas, row, 'Aula');
    const aulaId = getCellValue(sheets.presencas, row, 'Aula ID');
    const data = getCellValue(sheets.presencas, row, 'Data') || '-';

    if (presencaId) {
      presentePresencaIds.add(presencaId);
    }

    if (!aula && !aulaId) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Presenças',
        title: 'Presença sem Aula',
        detail: `${aprendiz} está presente em ${data}, mas a presença não possui Aula.`,
      });
      return;
    }

    const coveredDisciplineIds = getCoverageDisciplineIds(sheets, aulaId, aula);
    const planDisciplineIds = new Set(
      getRowsByValue(sheets.planoEnsino, 'Aprendiz ID', aprendizId)
        .map((planRow) => getCellValue(sheets.planoEnsino, planRow, 'Disciplina ID'))
        .filter(Boolean),
    );
    const appliesToPlan = [...coveredDisciplineIds].some((disciplinaId) =>
      planDisciplineIds.has(disciplinaId),
    );

    if (
      presencaId &&
      aprendizId &&
      appliesToPlan &&
      !hasMatchingAppliedHours(sheets, presencaId, aprendizId, coveredDisciplineIds)
    ) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Horas Aplicadas',
        title: 'Presença sem horas aplicadas',
        detail: `${aprendiz} está presente em ${data}, mas as horas não foram aplicadas ao Plano de Ensino.`,
      });
    }
  });

  sheets.horasAplicadas.rows.forEach((row) => {
    const presencaId = getCellValue(sheets.horasAplicadas, row, 'Presença ID');
    const aprendiz = getCellValue(sheets.horasAplicadas, row, 'Aprendiz') || 'Aprendiz';
    const disciplina =
      getCellValue(sheets.horasAplicadas, row, 'Disciplina') || 'Disciplina';

    if (presencaId && !presentePresencaIds.has(presencaId)) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Horas Aplicadas',
        title: 'Horas sem presença ativa',
        detail: `${aprendiz} possui horas em "${disciplina}", mas a Presença vinculada não está como Presente.`,
      });
    }
  });

  sheets.planoEnsino.rows.forEach((row) => {
    const aprendiz = getCellValue(sheets.planoEnsino, row, 'Aprendiz') || 'Aprendiz';
    const aprendizId = getCellValue(sheets.planoEnsino, row, 'Aprendiz ID');
    const disciplina =
      getCellValue(sheets.planoEnsino, row, 'Disciplina') || 'Disciplina';
    const disciplinaId = getCellValue(sheets.planoEnsino, row, 'Disciplina ID');
    const matchingProgressRows = sheets.planoProgresso.rows.filter(
      (progressRow) =>
        getCellValue(sheets.planoProgresso, progressRow, 'Aprendiz ID') ===
          aprendizId &&
        getCellValue(sheets.planoProgresso, progressRow, 'Disciplina ID') ===
          disciplinaId,
    );

    if (aprendizId && disciplinaId && matchingProgressRows.length === 0) {
      pushIssue(issues, {
        severity: 'warning',
        area: 'Plano Progresso',
        title: 'Progresso não recalculado',
        detail: `${aprendiz} possui "${disciplina}" no Plano de Ensino, mas não há linha correspondente em Plano Progresso.`,
      });
    }
  });

  return issues;
};

export const readDataHealthReport = async (): Promise<DataHealthReport> => {
  const file = await fetchBaseWorkbookFile();

  if (!file) {
    return {
      hasWorkbook: false,
      checkedAt: new Date().toISOString(),
      fileName: null,
      issues: [],
    };
  }

  const sheets = await readHealthSheets(file);

  return {
    hasWorkbook: true,
    checkedAt: new Date().toISOString(),
    fileName: file.name,
    issues: buildDataHealthIssues(sheets),
  };
};
