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
import type { ManagedWorkbookSheets } from './dataHealth';
import { normalizeFieldLabel } from './schemas';
import { isInternalColumn } from './stableIds';

export type WorkbookIntegritySeverity = 'error' | 'warning';

export type WorkbookIntegrityIssue = {
  code: string;
  severity: WorkbookIntegritySeverity;
  blocking: boolean;
  area: string;
  title: string;
  detail: string;
  entityId?: string;
  recordId?: string;
};

export type AprendizDependencySummary = {
  aprendizId: string;
  aprendizName: string;
  planoEnsinoRows: number;
  presencaRows: number;
  horasAplicadasRows: number;
  planoProgressoRows: number;
  totalDependentRows: number;
};

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

export const getStoredRecordId = (sheet: SheetTable, row: readonly string[]) => {
  const internalIdColumnIndex = sheet.columns.findIndex(isInternalColumn);
  const genericIdColumnIndex = getColumnIndex(sheet, 'ID');
  const idColumnIndex =
    internalIdColumnIndex >= 0 ? internalIdColumnIndex : genericIdColumnIndex;

  return idColumnIndex >= 0 ? String(row[idColumnIndex] ?? '').trim() : '';
};

const getStoredRecordIds = (sheet: SheetTable) =>
  new Set(sheet.rows.map((row) => getStoredRecordId(sheet, row)).filter(Boolean));

const countRowsByReference = (
  sheet: SheetTable,
  columnName: string,
  recordId: string,
) =>
  sheet.rows.filter(
    (row) => getCellValue(sheet, row, columnName) === recordId,
  ).length;

export const getAprendizDependencySummary = (
  sheets: ManagedWorkbookSheets,
  aprendizId: string,
  aprendizName = '',
): AprendizDependencySummary => {
  const planoEnsinoRows = countRowsByReference(
    sheets.planoEnsino,
    'Aprendiz ID',
    aprendizId,
  );
  const presencaRows = countRowsByReference(
    sheets.presencas,
    'Aprendiz ID',
    aprendizId,
  );
  const horasAplicadasRows = countRowsByReference(
    sheets.horasAplicadas,
    'Aprendiz ID',
    aprendizId,
  );
  const planoProgressoRows = countRowsByReference(
    sheets.planoProgresso,
    'Aprendiz ID',
    aprendizId,
  );

  return {
    aprendizId,
    aprendizName,
    planoEnsinoRows,
    presencaRows,
    horasAplicadasRows,
    planoProgressoRows,
    totalDependentRows:
      planoEnsinoRows +
      presencaRows +
      horasAplicadasRows +
      planoProgressoRows,
  };
};

const createReferenceIssues = (
  sheet: SheetTable,
  referenceColumn: string,
  targetIds: Set<string>,
  options: {
    area: string;
    code: string;
    entityId: string;
    referenceLabel: string;
    targetLabel: string;
    severity?: WorkbookIntegritySeverity;
    blocking?: boolean;
  },
) =>
  sheet.rows.flatMap((row, rowIndex): WorkbookIntegrityIssue[] => {
    const referenceId = getCellValue(sheet, row, referenceColumn);

    if (!referenceId || targetIds.has(referenceId)) {
      return [];
    }

    return [
      {
        code: options.code,
        severity: options.severity ?? 'error',
        blocking: options.blocking ?? true,
        area: options.area,
        title: `${options.referenceLabel} sem ${options.targetLabel}`,
        detail: `${options.referenceLabel} ${rowIndex + 1} referencia "${referenceId}", mas o ${options.targetLabel} correspondente não existe.`,
        entityId: options.entityId,
        recordId: getStoredRecordId(sheet, row),
      },
    ];
  });

const ID_SHEETS = [
  ['Aprendizes', APRENDIZES_ENTITY_ID, 'aprendizes'],
  ['Turmas', TURMAS_ENTITY_ID, 'turmas'],
  ['Arcos', ARCOS_ENTITY_ID, 'arcos'],
  ['Disciplinas', DISCIPLINAS_ENTITY_ID, 'disciplinas'],
  ['Aulas', AULAS_ENTITY_ID, 'aulas'],
  ['Aulas Disciplinas', AULAS_DISCIPLINAS_ENTITY_ID, 'aulasDisciplinas'],
  ['Cronograma', CRONOGRAMA_ENTITY_ID, 'cronograma'],
  ['Plano de Ensino', PLANO_ENSINO_ENTITY_ID, 'planoEnsino'],
  ['Presenças', PRESENCAS_ENTITY_ID, 'presencas'],
  ['Horas Aplicadas', HORAS_APLICADAS_ENTITY_ID, 'horasAplicadas'],
  ['Plano Progresso', PLANO_PROGRESSO_ENTITY_ID, 'planoProgresso'],
] as const;

const inspectPrimaryIds = (sheets: ManagedWorkbookSheets) => {
  const issues: WorkbookIntegrityIssue[] = [];
  const globalIds = new Map<string, { area: string; entityId: string }>();

  ID_SHEETS.forEach(([area, entityId, sheetKey]) => {
    const sheet = sheets[sheetKey];
    const localIds = new Set<string>();

    sheet.rows.forEach((row, rowIndex) => {
      const recordId = getStoredRecordId(sheet, row);

      if (!recordId) {
        issues.push({
          code: 'missing-record-id',
          severity: 'warning',
          blocking: false,
          area,
          title: 'Registro sem ID estável',
          detail: `Linha ${rowIndex + 1} não possui ID estável e deve ser normalizada pelo aplicativo.`,
          entityId,
        });
        return;
      }

      if (localIds.has(recordId)) {
        issues.push({
          code: 'duplicate-record-id',
          severity: 'error',
          blocking: true,
          area,
          title: 'ID duplicado',
          detail: `O ID "${recordId}" aparece mais de uma vez em ${area}.`,
          entityId,
          recordId,
        });
      }

      localIds.add(recordId);
      const previousOwner = globalIds.get(recordId);

      if (previousOwner && previousOwner.entityId !== entityId) {
        issues.push({
          code: 'cross-entity-id-collision',
          severity: 'error',
          blocking: true,
          area,
          title: 'ID reutilizado por entidades diferentes',
          detail: `O ID "${recordId}" aparece em ${previousOwner.area} e ${area}.`,
          entityId,
          recordId,
        });
      } else {
        globalIds.set(recordId, { area, entityId });
      }
    });
  });

  return issues;
};

export const inspectManagedWorkbookDependencies = (
  sheets: ManagedWorkbookSheets,
) => {
  const issues = inspectPrimaryIds(sheets);
  const aprendizIds = getStoredRecordIds(sheets.aprendizes);
  const arcoIds = getStoredRecordIds(sheets.arcos);
  const turmaIds = getStoredRecordIds(sheets.turmas);
  const aulaIds = getStoredRecordIds(sheets.aulas);
  const disciplinaIds = getStoredRecordIds(sheets.disciplinas);
  const eventoIds = getStoredRecordIds(sheets.cronograma);
  const presencaIds = getStoredRecordIds(sheets.presencas);

  issues.push(
    ...createReferenceIssues(
      sheets.planoEnsino,
      'Aprendiz ID',
      aprendizIds,
      {
        area: 'Plano de Ensino',
        code: 'orphan-plano-aprendiz',
        entityId: PLANO_ENSINO_ENTITY_ID,
        referenceLabel: 'Linha do Plano de Ensino',
        targetLabel: 'Aprendiz',
      },
    ),
    ...createReferenceIssues(
      sheets.planoEnsino,
      'Arco ID',
      arcoIds,
      {
        area: 'Plano de Ensino',
        code: 'orphan-plano-arco',
        entityId: PLANO_ENSINO_ENTITY_ID,
        referenceLabel: 'Linha do Plano de Ensino',
        targetLabel: 'Arco',
      },
    ),
    ...createReferenceIssues(
      sheets.planoEnsino,
      'Disciplina ID',
      disciplinaIds,
      {
        area: 'Plano de Ensino',
        code: 'orphan-plano-disciplina',
        entityId: PLANO_ENSINO_ENTITY_ID,
        referenceLabel: 'Linha do Plano de Ensino',
        targetLabel: 'Disciplina',
      },
    ),
    ...createReferenceIssues(
      sheets.presencas,
      'Aprendiz ID',
      aprendizIds,
      {
        area: 'Presenças',
        code: 'orphan-presenca-aprendiz',
        entityId: PRESENCAS_ENTITY_ID,
        referenceLabel: 'Presença',
        targetLabel: 'Aprendiz',
      },
    ),
    ...createReferenceIssues(
      sheets.presencas,
      'Turma ID',
      turmaIds,
      {
        area: 'Presenças',
        code: 'orphan-presenca-turma',
        entityId: PRESENCAS_ENTITY_ID,
        referenceLabel: 'Presença',
        targetLabel: 'Turma',
        severity: 'warning',
        blocking: false,
      },
    ),
    ...createReferenceIssues(
      sheets.presencas,
      'Aula ID',
      aulaIds,
      {
        area: 'Presenças',
        code: 'orphan-presenca-aula',
        entityId: PRESENCAS_ENTITY_ID,
        referenceLabel: 'Presença',
        targetLabel: 'Aula',
        severity: 'warning',
        blocking: false,
      },
    ),
    ...createReferenceIssues(
      sheets.horasAplicadas,
      'Aprendiz ID',
      aprendizIds,
      {
        area: 'Horas Aplicadas',
        code: 'orphan-horas-aprendiz',
        entityId: HORAS_APLICADAS_ENTITY_ID,
        referenceLabel: 'Horas Aplicadas',
        targetLabel: 'Aprendiz',
      },
    ),
    ...createReferenceIssues(
      sheets.horasAplicadas,
      'Evento ID',
      eventoIds,
      {
        area: 'Horas Aplicadas',
        code: 'orphan-horas-evento',
        entityId: HORAS_APLICADAS_ENTITY_ID,
        referenceLabel: 'Horas Aplicadas',
        targetLabel: 'Evento',
      },
    ),
    ...createReferenceIssues(
      sheets.horasAplicadas,
      'Disciplina ID',
      disciplinaIds,
      {
        area: 'Horas Aplicadas',
        code: 'orphan-horas-disciplina',
        entityId: HORAS_APLICADAS_ENTITY_ID,
        referenceLabel: 'Horas Aplicadas',
        targetLabel: 'Disciplina',
        severity: 'warning',
        blocking: false,
      },
    ),
    ...createReferenceIssues(
      sheets.horasAplicadas,
      'Aula ID',
      aulaIds,
      {
        area: 'Horas Aplicadas',
        code: 'orphan-horas-aula',
        entityId: HORAS_APLICADAS_ENTITY_ID,
        referenceLabel: 'Horas Aplicadas',
        targetLabel: 'Aula',
        severity: 'warning',
        blocking: false,
      },
    ),
    ...createReferenceIssues(
      sheets.planoProgresso,
      'Aprendiz ID',
      aprendizIds,
      {
        area: 'Plano Progresso',
        code: 'orphan-progresso-aprendiz',
        entityId: PLANO_PROGRESSO_ENTITY_ID,
        referenceLabel: 'Linha de progresso',
        targetLabel: 'Aprendiz',
      },
    ),
    ...createReferenceIssues(
      sheets.planoProgresso,
      'Disciplina ID',
      disciplinaIds,
      {
        area: 'Plano Progresso',
        code: 'orphan-progresso-disciplina',
        entityId: PLANO_PROGRESSO_ENTITY_ID,
        referenceLabel: 'Linha de progresso',
        targetLabel: 'Disciplina',
      },
    ),
    ...createReferenceIssues(
      sheets.aulasDisciplinas,
      'Aula ID',
      aulaIds,
      {
        area: 'Aulas Disciplinas',
        code: 'orphan-coverage-aula',
        entityId: AULAS_DISCIPLINAS_ENTITY_ID,
        referenceLabel: 'Cobertura',
        targetLabel: 'Aula',
      },
    ),
    ...createReferenceIssues(
      sheets.aulasDisciplinas,
      'Disciplina ID',
      disciplinaIds,
      {
        area: 'Aulas Disciplinas',
        code: 'orphan-coverage-disciplina',
        entityId: AULAS_DISCIPLINAS_ENTITY_ID,
        referenceLabel: 'Cobertura',
        targetLabel: 'Disciplina',
      },
    ),
    ...createReferenceIssues(
      sheets.presencas,
      'Evento ID',
      eventoIds,
      {
        area: 'Presenças',
        code: 'orphan-presenca-evento',
        entityId: PRESENCAS_ENTITY_ID,
        referenceLabel: 'Presença',
        targetLabel: 'Evento',
      },
    ),
    ...createReferenceIssues(
      sheets.cronograma,
      'Aula ID',
      aulaIds,
      {
        area: 'Cronograma',
        code: 'orphan-evento-aula',
        entityId: CRONOGRAMA_ENTITY_ID,
        referenceLabel: 'Evento',
        targetLabel: 'Aula',
        severity: 'warning',
        blocking: false,
      },
    ),
    ...createReferenceIssues(
      sheets.horasAplicadas,
      'Presença ID',
      presencaIds,
      {
        area: 'Horas Aplicadas',
        code: 'orphan-horas-presenca',
        entityId: HORAS_APLICADAS_ENTITY_ID,
        referenceLabel: 'Horas Aplicadas',
        targetLabel: 'Presença',
      },
    ),
  );

  return issues;
};

export const inspectWorkbookImportTransition = (
  currentSheets: ManagedWorkbookSheets | null,
  candidateSheets: ManagedWorkbookSheets,
) => {
  const issues = inspectManagedWorkbookDependencies(candidateSheets);

  if (!currentSheets) {
    return issues;
  }

  const currentAprendizes = new Map(
    currentSheets.aprendizes.rows
      .map((row) => [
        getStoredRecordId(currentSheets.aprendizes, row),
        getCellValue(currentSheets.aprendizes, row, 'Nome'),
      ] as const)
      .filter(([recordId]) => Boolean(recordId)),
  );
  const candidateAprendizIds = getStoredRecordIds(candidateSheets.aprendizes);

  currentAprendizes.forEach((aprendizName, aprendizId) => {
    if (candidateAprendizIds.has(aprendizId)) {
      return;
    }

    const summary = getAprendizDependencySummary(
      currentSheets,
      aprendizId,
      aprendizName,
    );

    issues.push({
      code: 'external-aprendiz-removal',
      severity: 'error',
      blocking: true,
      area: 'Importação',
      title: 'Aprendiz removido fora do aplicativo',
      detail:
        `${aprendizName || aprendizId} não está no arquivo escolhido. ` +
        `A exclusão precisa usar o fluxo de privacidade do aplicativo` +
        (summary.totalDependentRows > 0
          ? `; existem ${summary.totalDependentRows} registros pessoais vinculados.`
          : '.'),
      entityId: APRENDIZES_ENTITY_ID,
      recordId: aprendizId,
    });
  });

  const currentHasStableAprendizIds = currentAprendizes.size > 0;
  const candidateRowsWithoutIds = candidateSheets.aprendizes.rows.filter(
    (row) => !getStoredRecordId(candidateSheets.aprendizes, row),
  ).length;

  if (currentHasStableAprendizIds && candidateRowsWithoutIds > 0) {
    issues.push({
      code: 'candidate-aprendiz-ids-missing',
      severity: 'error',
      blocking: true,
      area: 'Importação',
      title: 'IDs dos Aprendizes foram removidos',
      detail:
        'O arquivo escolhido removeu IDs estáveis de Aprendizes existentes. O aplicativo não pode adivinhar identidades.',
      entityId: APRENDIZES_ENTITY_ID,
    });
  }

  return issues;
};

export class WorkbookIntegrityError extends Error {
  issues: WorkbookIntegrityIssue[];

  constructor(issues: WorkbookIntegrityIssue[]) {
    super('invalid-workbook-integrity');
    this.issues = issues;
  }
}

export const formatWorkbookIntegrityToast = (error: unknown) => {
  if (!(error instanceof WorkbookIntegrityError)) {
    return null;
  }

  const firstIssue = error.issues[0];
  const remainingCount = Math.max(0, error.issues.length - 1);

  return `${firstIssue.detail}${
    remainingCount > 0
      ? `\nMais ${remainingCount} inconsistência${remainingCount === 1 ? '' : 's'} precisa${remainingCount === 1 ? '' : 'm'} ser corrigida${remainingCount === 1 ? '' : 's'}.`
      : ''
  }`;
};
