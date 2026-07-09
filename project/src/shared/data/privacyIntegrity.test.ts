import { describe, expect, it } from 'vitest';
import type { SheetTable } from './dataIndex';
import type { ManagedWorkbookSheets } from './dataHealth';
import {
  buildAprendizPrivacyPurgedSheets,
  getAprendizPrivacyPurgePreview,
} from './aprendizPrivacy';
import {
  inspectManagedWorkbookDependencies,
  inspectWorkbookImportTransition,
} from './dependencyInspector';
import {
  hashPrivacyRecordId,
  inspectPurgedAprendizReintroduction,
} from './workbookImportIntegrity';
import { SEJA_ELEVAR_ID_COLUMN } from './stableIds';

const createSheet = (
  sheetName: string,
  columns: string[],
  rows: string[][] = [],
): SheetTable => ({
  fileName: 'DadosElevar_teste.xlsx',
  sheetName,
  importedAt: '2026-07-08T00:00:00.000Z',
  columns,
  rows,
});

const createSheets = (): ManagedWorkbookSheets => ({
  aprendizes: createSheet(
    'Aprendizes',
    ['Nome', 'Arco de Aprendizagem', 'Turma', SEJA_ELEVAR_ID_COLUMN],
    [
      ['Ana', 'Administração', 'Turma A', 'apr_ana'],
      ['Bruno', 'Administração', 'Turma A', 'apr_bruno'],
    ],
  ),
  turmas: createSheet(
    'Turmas',
    ['Turma', SEJA_ELEVAR_ID_COLUMN],
    [['Turma A', 'tur_a']],
  ),
  arcos: createSheet(
    'Arcos',
    ['Arco', 'Arquivo Ementa', 'ID', 'Ementa ID'],
    [['Administração', 'ementa.pdf', 'arco_adm', 'eme_adm']],
  ),
  disciplinas: createSheet(
    'Disciplinas',
    ['Disciplina', 'Módulo', 'Arco', 'Carga Horária', 'ID', 'Ementa ID'],
    [['Comunicação', 'Básico', 'Todos', '20h', 'disc_com', 'eme_adm']],
  ),
  aulas: createSheet(
    'Aulas',
    ['Aula', 'Cor', 'Instrutor Padrão', 'Sala Padrão', 'ID'],
    [['Aula Comunicação', '#2069df', '', '', 'aula_com']],
  ),
  aulasDisciplinas: createSheet(
    'Aulas Disciplinas',
    ['Aula', 'Arco', 'Módulo', 'Disciplina', 'Aula ID', 'Disciplina ID', 'ID'],
    [
      [
        'Aula Comunicação',
        'Todos',
        'Básico',
        'Comunicação',
        'aula_com',
        'disc_com',
        'aula_disc_com',
      ],
    ],
  ),
  cronograma: createSheet(
    'Cronograma',
    [
      'Turma',
      'Data',
      'Início',
      'Fim',
      'Tipo',
      'Aula',
      'Instrutor',
      'Sala',
      'Cor',
      'Aula ID',
      'ID',
    ],
    [
      [
        'Turma A',
        '08/07/2026',
        '08:00',
        '09:00',
        'Aula',
        'Aula Comunicação',
        '',
        '',
        '#2069df',
        'aula_com',
        'cro_1',
      ],
    ],
  ),
  planoEnsino: createSheet(
    'Plano de Ensino',
    [
      'Aprendiz',
      'Arco',
      'Módulo',
      'Disciplina',
      'Carga Horária Total',
      'Aprendiz ID',
      'Arco ID',
      'Disciplina ID',
      'ID',
    ],
    [
      ['Ana', 'Administração', 'Básico', 'Comunicação', '20h', 'apr_ana', 'arco_adm', 'disc_com', 'plano_ana'],
      ['Bruno', 'Administração', 'Básico', 'Comunicação', '20h', 'apr_bruno', 'arco_adm', 'disc_com', 'plano_bruno'],
    ],
  ),
  presencas: createSheet(
    'Presencas',
    [
      'Aprendiz',
      'Status Presença',
      'Turma',
      'Data',
      'Início',
      'Fim',
      'Aula',
      'Instrutor',
      'Sala',
      'Evento ID',
      'Aula ID',
      'Aprendiz ID',
      'Turma ID',
      'ID',
    ],
    [
      ['Ana', 'Presente', 'Turma A', '08/07/2026', '08:00', '09:00', 'Aula Comunicação', '', '', 'cro_1', 'aula_com', 'apr_ana', 'tur_a', 'pre_ana'],
      ['Bruno', 'Presente', 'Turma A', '08/07/2026', '08:00', '09:00', 'Aula Comunicação', '', '', 'cro_1', 'aula_com', 'apr_bruno', 'tur_a', 'pre_bruno'],
    ],
  ),
  horasAplicadas: createSheet(
    'Horas Aplicadas',
    [
      'Aprendiz',
      'Arco',
      'Módulo',
      'Disciplina',
      'Minutos Aplicados',
      'Data',
      'Aula',
      'Evento ID',
      'Presença ID',
      'Aprendiz ID',
      'Disciplina ID',
      'Aula ID',
      'ID',
    ],
    [
      ['Ana', 'Administração', 'Básico', 'Comunicação', '60', '08/07/2026', 'Aula Comunicação', 'cro_1', 'pre_ana', 'apr_ana', 'disc_com', 'aula_com', 'hora_ana'],
      ['Bruno', 'Administração', 'Básico', 'Comunicação', '60', '08/07/2026', 'Aula Comunicação', 'cro_1', 'pre_bruno', 'apr_bruno', 'disc_com', 'aula_com', 'hora_bruno'],
    ],
  ),
  planoProgresso: createSheet(
    'Plano Progresso',
    [
      'Aprendiz',
      'Arco',
      'Módulo',
      'Disciplina',
      'Carga Horária Total',
      'Carga Horária Cumprida',
      'Excedente',
      'Aprendiz ID',
      'Disciplina ID',
      'ID',
    ],
    [
      ['Ana', 'Administração', 'Básico', 'Comunicação', '20h', '1h', '0h', 'apr_ana', 'disc_com', 'progresso_ana'],
      ['Bruno', 'Administração', 'Básico', 'Comunicação', '20h', '1h', '0h', 'apr_bruno', 'disc_com', 'progresso_bruno'],
    ],
  ),
});

describe('Aprendiz privacy purge', () => {
  it('removes every target-owned academic row and preserves other data', () => {
    const source = createSheets();
    const purged = buildAprendizPrivacyPurgedSheets(source, 'apr_ana');

    expect(purged.aprendizes.rows).toHaveLength(1);
    expect(purged.aprendizes.rows[0]?.[0]).toBe('Bruno');
    expect(purged.planoEnsino.rows).toHaveLength(1);
    expect(purged.presencas.rows).toHaveLength(1);
    expect(purged.horasAplicadas.rows).toHaveLength(1);
    expect(purged.planoProgresso.rows).toHaveLength(1);
    expect(purged.cronograma).toBe(source.cronograma);
    expect(purged.aulas).toBe(source.aulas);
  });

  it('reports the exact personal rows that will be deleted', () => {
    const preview = getAprendizPrivacyPurgePreview(
      createSheets(),
      'apr_ana',
      'Ana',
    );

    expect(preview).toMatchObject({
      aprendizRowCount: 1,
      planoEnsinoRows: 1,
      presencaRows: 1,
      horasAplicadasRows: 1,
      planoProgressoRows: 1,
      totalDependentRows: 4,
    });
  });
});

describe('Workbook dependency integrity', () => {
  it('detects duplicate primary IDs and orphaned personal history', () => {
    const sheets = createSheets();
    sheets.aprendizes.rows[1]![3] = 'apr_ana';
    sheets.presencas.rows[0]![11] = 'apr_missing';

    const issueCodes = inspectManagedWorkbookDependencies(sheets).map(
      (issue) => issue.code,
    );

    expect(issueCodes).toContain('duplicate-record-id');
    expect(issueCodes).toContain('orphan-presenca-aprendiz');
  });

  it('checks live Arco/Disciplina links without blocking frozen Aula history', () => {
    const sheets = createSheets();
    sheets.planoEnsino.rows[0]![6] = 'arco_missing';
    sheets.presencas.rows[0]![10] = 'aula_historica_removida';

    const issues = inspectManagedWorkbookDependencies(sheets);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'orphan-plano-arco',
        blocking: true,
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'orphan-presenca-aula',
        severity: 'warning',
        blocking: false,
      }),
    );
  });

  it('blocks a manually removed Aprendiz before candidate import', () => {
    const current = createSheets();
    const candidate = createSheets();
    candidate.aprendizes.rows = candidate.aprendizes.rows.slice(1);

    const issues = inspectWorkbookImportTransition(current, candidate);
    const removalIssue = issues.find(
      (issue) => issue.code === 'external-aprendiz-removal',
    );

    expect(removalIssue).toMatchObject({
      blocking: true,
      recordId: 'apr_ana',
    });
  });

  it('blocks an old workbook from reintroducing a purged identity', async () => {
    const candidate = createSheets();
    const purgedHashes = new Set([
      await hashPrivacyRecordId('apr_ana'),
    ]);

    const issues = await inspectPurgedAprendizReintroduction(
      candidate,
      purgedHashes,
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'purged-aprendiz-reintroduced',
        blocking: true,
        recordId: 'apr_ana',
      }),
    ]);
  });
});
