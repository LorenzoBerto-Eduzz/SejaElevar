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
  MissingRequiredColumnsError,
  readWorkbookSheetFile,
} from './workspaceData';
import { inspectManagedWorkbookDependencies } from './dependencyInspector';
import { getSheetRecordId } from './stableIds';

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

type SheetReadIssue = Omit<DataHealthIssue, 'id'>;

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

export type ManagedWorkbookSheets = {
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

const getSheetReadIssue = (
  definition: SheetDefinition,
  error: unknown,
): SheetReadIssue => {
  if (error instanceof MissingRequiredColumnsError) {
    return {
      severity: 'error',
      area: definition.sheetName,
      title: 'Colunas obrigatórias ausentes',
      detail: `${definition.sheetName} não possui: ${error.missingColumns.join(', ')}.`,
    };
  }

  const message = error instanceof Error ? error.message : '';

  if (message === 'missing-sheet') {
    return {
      severity: 'error',
      area: definition.sheetName,
      title: 'Aba obrigatória ausente',
      detail: `A aba ${definition.sheetName} não existe no DadosElevar em uso.`,
    };
  }

  if (message === 'empty-sheet') {
    return {
      severity: 'error',
      area: definition.sheetName,
      title: 'Aba sem cabeçalho reconhecido',
      detail: `${definition.sheetName} existe, mas o aplicativo não encontrou um cabeçalho compatível.`,
    };
  }

  return {
    severity: 'error',
    area: definition.sheetName,
    title: 'Aba não pôde ser lida',
    detail: `${definition.sheetName} não pôde ser verificada pelo aplicativo.`,
  };
};

const readHealthSheetWithIssue = async (
  file: File,
  definition: SheetDefinition,
) => {
  try {
    return {
      issue: null,
      sheet: await readWorkbookSheetFile(file, {
        entityId: definition.entityId,
        ensureRecordIds: false,
        preferredSheetName: definition.sheetName,
        requiredColumns: definition.requiredColumns,
      }),
    };
  } catch (error) {
    return {
      issue: getSheetReadIssue(definition, error),
      sheet: createEmptySheet(file.name, definition),
    };
  }
};

const readManagedWorkbookSheetsWithIssues = async (file: File) => {
  const entries = await Promise.all(
    Object.entries(SHEET_DEFINITIONS).map(async ([key, definition]) => ({
      key,
      ...(await readHealthSheetWithIssue(file, definition)),
    })),
  );
  const sheets = Object.fromEntries(
    entries.map(({ key, sheet }) => [key, sheet]),
  ) as ManagedWorkbookSheets;
  const issues = entries.flatMap(({ issue }) => (issue ? [issue] : []));

  return { issues, sheets };
};

export const readManagedWorkbookSheets = async (
  file: File,
): Promise<ManagedWorkbookSheets> =>
  (await readManagedWorkbookSheetsWithIssues(file)).sheets;

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

const parseNumber = (value: string) => {
  const normalized = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
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

const severityOrder: Record<DataHealthSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const sortIssuesBySeverity = (issues: DataHealthIssue[]) =>
  [...issues].sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.area.localeCompare(right.area, 'pt-BR') ||
      left.title.localeCompare(right.title, 'pt-BR'),
  );

const pushDuplicateValueIssues = (
  issues: DataHealthIssue[],
  sheet: SheetTable,
  {
    area,
    columns,
    detailLabel,
    severity = 'error',
  }: {
    area: string;
    columns: string[];
    detailLabel: string;
    severity?: DataHealthSeverity;
  },
) => {
  const values = new Map<string, { label: string; count: number }>();

  sheet.rows.forEach((row) => {
    const parts = columns.map((column) => getCellValue(sheet, row, column));

    if (parts.some((part) => !part)) {
      return;
    }

    const key = parts.map(normalizeFieldLabel).join('|');
    const current = values.get(key);

    values.set(key, {
      label: current?.label ?? parts.join(' / '),
      count: (current?.count ?? 0) + 1,
    });
  });

  values.forEach(({ count, label }) => {
    if (count <= 1) {
      return;
    }

    pushIssue(issues, {
      severity,
      area,
      title: 'Valor duplicado',
      detail: `${detailLabel} "${label}" aparece ${count} vezes.`,
    });
  });
};

const pushBlankRequiredValueIssue = (
  issues: DataHealthIssue[],
  {
    area,
    rowIndex,
    field,
    label,
    severity = 'error',
  }: {
    area: string;
    rowIndex: number;
    field: string;
    label: string;
    severity?: DataHealthSeverity;
  },
) => {
  pushIssue(issues, {
    severity,
    area,
    title: `${field} vazio`,
    detail: `${label} na linha ${rowIndex + 1} não possui ${field}.`,
  });
};

const getCoverageDisciplineIds = (
  sheets: ManagedWorkbookSheets,
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
  sheets: ManagedWorkbookSheets,
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

export const buildDataHealthIssues = (sheets: ManagedWorkbookSheets) => {
  const issues: DataHealthIssue[] = [];
  const arcoNames = createLookup(sheets.arcos, 'Arco');
  const turmaNames = createLookup(sheets.turmas, 'Turma');
  const aulaIds = createLookup(sheets.aulas, 'ID');
  const aulaNames = createLookup(sheets.aulas, 'Aula');
  const presentePresencaIds = new Set<string>();
  const appliedMinutesByPlanKey = new Map<string, number>();

  pushDuplicateValueIssues(issues, sheets.arcos, {
    area: 'Arcos',
    columns: ['Arco'],
    detailLabel: 'O Arco',
  });
  pushDuplicateValueIssues(issues, sheets.turmas, {
    area: 'Turmas',
    columns: ['Turma'],
    detailLabel: 'A Turma',
  });
  pushDuplicateValueIssues(issues, sheets.aulas, {
    area: 'Aulas',
    columns: ['Aula'],
    detailLabel: 'A Aula',
  });
  pushDuplicateValueIssues(issues, sheets.disciplinas, {
    area: 'Disciplinas',
    columns: ['Arco', 'Módulo', 'Disciplina'],
    detailLabel: 'A Disciplina',
  });
  pushDuplicateValueIssues(issues, sheets.aulasDisciplinas, {
    area: 'Aulas Disciplinas',
    columns: ['Aula ID', 'Disciplina ID'],
    detailLabel: 'A cobertura',
    severity: 'warning',
  });

  sheets.turmas.rows.forEach((row, rowIndex) => {
    if (!getCellValue(sheets.turmas, row, 'Turma')) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Turmas',
        rowIndex,
        field: 'Turma',
        label: 'Registro de Turma',
      });
    }
  });

  sheets.arcos.rows.forEach((row, rowIndex) => {
    if (!getCellValue(sheets.arcos, row, 'Arco')) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Arcos',
        rowIndex,
        field: 'Arco',
        label: 'Registro de Arco',
      });
    }
  });

  sheets.disciplinas.rows.forEach((row, rowIndex) => {
    const disciplina = getCellValue(sheets.disciplinas, row, 'Disciplina');
    const modulo = getCellValue(sheets.disciplinas, row, 'Módulo');
    const arco = getCellValue(sheets.disciplinas, row, 'Arco');
    const cargaHoraria = getCellValue(sheets.disciplinas, row, 'Carga Horária');
    const cargaHorariaNumber = parseNumber(cargaHoraria);

    if (!disciplina) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Disciplinas',
        rowIndex,
        field: 'Disciplina',
        label: 'Registro de Disciplina',
      });
    }

    if (!modulo) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Disciplinas',
        rowIndex,
        field: 'Módulo',
        label: disciplina || 'Registro de Disciplina',
      });
    }

    if (!arco) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Disciplinas',
        rowIndex,
        field: 'Arco',
        label: disciplina || 'Registro de Disciplina',
      });
    }

    if (!cargaHoraria || cargaHorariaNumber === null || cargaHorariaNumber <= 0) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Disciplinas',
        title: 'Carga horária inválida',
        detail: `${disciplina || `Linha ${rowIndex + 1}`} possui carga horária "${cargaHoraria || 'vazia'}".`,
      });
    }
  });

  sheets.aulas.rows.forEach((row, rowIndex) => {
    if (!getCellValue(sheets.aulas, row, 'Aula')) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Aulas',
        rowIndex,
        field: 'Aula',
        label: 'Registro de Aula',
      });
    }
  });

  sheets.aulasDisciplinas.rows.forEach((row, rowIndex) => {
    const aula = getCellValue(sheets.aulasDisciplinas, row, 'Aula');
    const disciplina = getCellValue(
      sheets.aulasDisciplinas,
      row,
      'Disciplina',
    );

    if (!getCellValue(sheets.aulasDisciplinas, row, 'Aula ID')) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Aulas Disciplinas',
        rowIndex,
        field: 'Aula ID',
        label: aula || 'Cobertura',
      });
    }

    if (!getCellValue(sheets.aulasDisciplinas, row, 'Disciplina ID')) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Aulas Disciplinas',
        rowIndex,
        field: 'Disciplina ID',
        label: disciplina || 'Cobertura',
      });
    }
  });

  sheets.aprendizes.rows.forEach((row, rowIndex) => {
    const aprendiz = getCellValue(sheets.aprendizes, row, 'Nome') || 'Aprendiz';
    const aprendizId = getSheetRecordId(
      sheets.aprendizes,
      rowIndex,
      APRENDIZES_ENTITY_ID,
    );
    const arco = getCellValue(sheets.aprendizes, row, 'Arco de Aprendizagem');
    const turma = getCellValue(sheets.aprendizes, row, 'Turma');

    if (!getCellValue(sheets.aprendizes, row, 'Nome')) {
      pushBlankRequiredValueIssue(issues, {
        area: 'Aprendizes',
        rowIndex,
        field: 'Nome',
        label: 'Registro de Aprendiz',
      });
    }

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
    const fim = getCellValue(sheets.cronograma, row, 'Fim') || '-';
    const aula = getCellValue(sheets.cronograma, row, 'Aula');
    const aulaId = getCellValue(sheets.cronograma, row, 'Aula ID');
    const turma = getCellValue(sheets.cronograma, row, 'Turma');

    if (data === '-' || inicio === '-' || fim === '-') {
      pushIssue(issues, {
        severity: 'error',
        area: 'Cronograma',
        title: 'Evento sem data ou horário',
        detail: `Evento "${aula || turma || 'sem identificação'}" possui Data/Início/Fim incompletos.`,
      });
    }

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

    const normalizedStatus = normalizeFieldLabel(status);

    if (
      status &&
      normalizedStatus !== 'presente' &&
      normalizedStatus !== 'ausente'
    ) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Presenças',
        title: 'Status de presença inválido',
        detail: `Status "${status}" não é Presente nem Ausente.`,
      });
    }

    if (normalizedStatus !== 'presente') {
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

  sheets.horasAplicadas.rows.forEach((row) => {
    const aprendiz =
      getCellValue(sheets.horasAplicadas, row, 'Aprendiz') || 'Aprendiz';
    const disciplina =
      getCellValue(sheets.horasAplicadas, row, 'Disciplina') || 'Disciplina';
    const aprendizId = getCellValue(sheets.horasAplicadas, row, 'Aprendiz ID');
    const disciplinaId = getCellValue(
      sheets.horasAplicadas,
      row,
      'Disciplina ID',
    );
    const minutos = getCellValue(
      sheets.horasAplicadas,
      row,
      'Minutos Aplicados',
    );
    const parsedMinutes = parseNumber(minutos);

    if (parsedMinutes === null || parsedMinutes <= 0) {
      pushIssue(issues, {
        severity: 'error',
        area: 'Horas Aplicadas',
        title: 'Minutos inválidos',
        detail: `${aprendiz} possui "${disciplina}" com minutos aplicados "${minutos || 'vazio'}".`,
      });
    }

    if (aprendizId && disciplinaId && parsedMinutes !== null) {
      const planKey = `${aprendizId}|${disciplinaId}`;

      appliedMinutesByPlanKey.set(
        planKey,
        (appliedMinutesByPlanKey.get(planKey) ?? 0) + parsedMinutes,
      );
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

  sheets.planoProgresso.rows.forEach((row) => {
    const aprendiz =
      getCellValue(sheets.planoProgresso, row, 'Aprendiz') || 'Aprendiz';
    const disciplina =
      getCellValue(sheets.planoProgresso, row, 'Disciplina') || 'Disciplina';
    const aprendizId = getCellValue(sheets.planoProgresso, row, 'Aprendiz ID');
    const disciplinaId = getCellValue(
      sheets.planoProgresso,
      row,
      'Disciplina ID',
    );
    const totalHours = parseNumber(
      getCellValue(sheets.planoProgresso, row, 'Carga Horária Total'),
    );
    const fulfilledHours = parseNumber(
      getCellValue(sheets.planoProgresso, row, 'Carga Horária Cumprida'),
    );
    const excessHours = parseNumber(
      getCellValue(sheets.planoProgresso, row, 'Excedente'),
    );
    const appliedMinutes = appliedMinutesByPlanKey.get(
      `${aprendizId}|${disciplinaId}`,
    );
    const appliedHours =
      appliedMinutes === undefined ? null : appliedMinutes / 60;

    if (appliedHours !== null && fulfilledHours !== null) {
      const difference = Math.abs(fulfilledHours - appliedHours);

      if (difference > 0.01) {
        pushIssue(issues, {
          severity: 'error',
          area: 'Plano Progresso',
          title: 'Carga cumprida desatualizada',
          detail: `${aprendiz} / ${disciplina} mostra ${fulfilledHours}h, mas Horas Aplicadas somam ${appliedHours}h.`,
        });
      }
    }

    if (totalHours !== null && appliedHours !== null && excessHours !== null) {
      const expectedExcess = Math.max(0, appliedHours - totalHours);
      const difference = Math.abs(excessHours - expectedExcess);

      if (difference > 0.01) {
        pushIssue(issues, {
          severity: 'warning',
          area: 'Plano Progresso',
          title: 'Excedente desatualizado',
          detail: `${aprendiz} / ${disciplina} mostra excedente ${excessHours}h, mas o esperado é ${expectedExcess}h.`,
        });
      }
    }
  });

  inspectManagedWorkbookDependencies(sheets).forEach((issue) => {
    pushIssue(issues, {
      severity: issue.severity,
      area: issue.area,
      title: issue.title,
      detail: issue.detail,
    });
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

  const { issues: readIssues, sheets } =
    await readManagedWorkbookSheetsWithIssues(file);

  return {
    hasWorkbook: true,
    checkedAt: new Date().toISOString(),
    fileName: file.name,
    issues: sortIssuesBySeverity([
      ...readIssues.map((issue, index) => ({
        id: `${issue.area}-${issue.title}-estrutura-${index}`,
        ...issue,
      })),
      ...buildDataHealthIssues(sheets),
    ]),
  };
};
