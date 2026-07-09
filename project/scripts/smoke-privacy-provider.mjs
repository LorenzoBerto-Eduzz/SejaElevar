import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import xlsx from 'xlsx';

const { read, utils, write } = xlsx;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(scriptDir);
const devExePath = join(projectDir, 'dev', 'SejaElevar.exe');
const APRENDIZ_ID = 'apr_privacy_smoke';
const OTHER_APRENDIZ_ID = 'apr_other_smoke';

const getFreePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  server.close();
  await once(server, 'close');
  return port;
};

const appendSheet = (workbook, name, columns, rows = []) => {
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([columns, ...rows]),
    name,
  );
};

const createWorkbookBuffer = ({ includeTarget }) => {
  const workbook = utils.book_new();
  const aprendizesRows = [
    ...(includeTarget
      ? [['Ana Smoke', 'Turma A', APRENDIZ_ID]]
      : []),
    ['Bruno Smoke', 'Turma A', OTHER_APRENDIZ_ID],
  ];
  const personalRows = (targetRow, otherRow) => [
    ...(includeTarget ? [targetRow] : []),
    otherRow,
  ];

  appendSheet(
    workbook,
    'Aprendizes',
    ['Nome', 'Turma', 'ID SejaElevar (não editar)'],
    aprendizesRows,
  );
  appendSheet(
    workbook,
    'Turmas',
    ['Turma', 'Dia', 'Período', 'Instrutor', 'Sala', 'ID SejaElevar (não editar)'],
    [['Turma A', 'Seg', '08:00h - 12:00h', '', '', 'tur_smoke']],
  );
  appendSheet(workbook, 'Arcos', ['Arco', 'Arquivo Ementa', 'ID', 'Ementa ID']);
  appendSheet(
    workbook,
    'Disciplinas',
    ['Disciplina', 'Módulo', 'Arco', 'Carga Horária', 'ID', 'Ementa ID'],
  );
  appendSheet(
    workbook,
    'Aulas',
    ['Aula', 'Cor', 'Instrutor Padrão', 'Sala Padrão', 'ID'],
  );
  appendSheet(
    workbook,
    'Aulas Disciplinas',
    ['Aula', 'Arco', 'Módulo', 'Disciplina', 'Aula ID', 'Disciplina ID', 'ID'],
  );
  appendSheet(
    workbook,
    'Cronograma',
    ['Turma', 'Data', 'Início', 'Fim', 'Tipo', 'Aula', 'Instrutor', 'Sala', 'Cor', 'Aula ID', 'ID'],
  );
  appendSheet(
    workbook,
    'Plano de Ensino',
    ['Aprendiz', 'Arco', 'Módulo', 'Disciplina', 'Carga Horária Total', 'Aprendiz ID', 'Arco ID', 'Disciplina ID', 'ID'],
    personalRows(
      ['Ana Smoke', 'Arco', 'Básico', 'Disciplina', '10h', APRENDIZ_ID, 'arco', 'disc', 'plano_target'],
      ['Bruno Smoke', 'Arco', 'Básico', 'Disciplina', '10h', OTHER_APRENDIZ_ID, 'arco', 'disc', 'plano_other'],
    ),
  );
  appendSheet(
    workbook,
    'Presencas',
    ['Aprendiz', 'Status Presença', 'Turma', 'Data', 'Início', 'Fim', 'Aula', 'Instrutor', 'Sala', 'Evento ID', 'Aula ID', 'Aprendiz ID', 'Turma ID', 'ID'],
    personalRows(
      ['Ana Smoke', 'Presente', 'Turma A', '08/07/2026', '08:00', '09:00', 'Aula', '', '', 'cro', 'aula', APRENDIZ_ID, 'tur_smoke', 'pre_target'],
      ['Bruno Smoke', 'Presente', 'Turma A', '08/07/2026', '08:00', '09:00', 'Aula', '', '', 'cro', 'aula', OTHER_APRENDIZ_ID, 'tur_smoke', 'pre_other'],
    ),
  );
  appendSheet(
    workbook,
    'Horas Aplicadas',
    ['Aprendiz', 'Arco', 'Módulo', 'Disciplina', 'Minutos Aplicados', 'Data', 'Aula', 'Evento ID', 'Presença ID', 'Aprendiz ID', 'Disciplina ID', 'Aula ID', 'ID'],
    personalRows(
      ['Ana Smoke', 'Arco', 'Básico', 'Disciplina', '60', '08/07/2026', 'Aula', 'cro', 'pre_target', APRENDIZ_ID, 'disc', 'aula', 'hora_target'],
      ['Bruno Smoke', 'Arco', 'Básico', 'Disciplina', '60', '08/07/2026', 'Aula', 'cro', 'pre_other', OTHER_APRENDIZ_ID, 'disc', 'aula', 'hora_other'],
    ),
  );
  appendSheet(
    workbook,
    'Plano Progresso',
    ['Aprendiz', 'Arco', 'Módulo', 'Disciplina', 'Carga Horária Total', 'Carga Horária Cumprida', 'Excedente', 'Aprendiz ID', 'Disciplina ID', 'ID'],
    personalRows(
      ['Ana Smoke', 'Arco', 'Básico', 'Disciplina', '10h', '1h', '0h', APRENDIZ_ID, 'disc', 'progress_target'],
      ['Bruno Smoke', 'Arco', 'Básico', 'Disciplina', '10h', '1h', '0h', OTHER_APRENDIZ_ID, 'disc', 'progress_other'],
    ),
  );

  return write(workbook, { bookType: 'xlsx', type: 'buffer' });
};

const waitForProvider = async (baseUrl) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/privacy/state`, {
        cache: 'no-store',
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Provider is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Provider did not start in time.');
};

const getSheetRows = (buffer, sheetName) => {
  const workbook = read(buffer, { cellDates: true });
  const worksheet = workbook.Sheets[sheetName];
  return utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: '',
    raw: false,
  });
};

const stopProvider = async (provider) => {
  if (!provider || provider.exitCode !== null) {
    return;
  }

  const exited = once(provider, 'exit');
  provider.kill();
  await exited;
};

const removeTempRoot = async (tempRoot) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'EPERM' || attempt === 9) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
};

const run = async () => {
  await stat(devExePath);
  const tempRoot = await mkdtemp(join(tmpdir(), 'sejaelevar-privacy-smoke-'));
  const dadosDir = join(tempRoot, 'dados');
  const checkpointsDir = join(dadosDir, 'checkpoints');
  const sistemaDir = join(dadosDir, 'sistema');
  const personalDocsDir = join(
    tempRoot,
    'documentos_gerados',
    'aprendizes',
    APRENDIZ_ID,
  );
  const workbookName = 'DadosElevar_privacy_smoke.xlsx';
  const activeWorkbookPath = join(dadosDir, workbookName);
  const checkpointName = 'DadosElevar_checkpoint_smoke.xlsx';
  const checkpointPath = join(checkpointsDir, checkpointName);
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let provider;

  try {
    await Promise.all([
      mkdir(checkpointsDir, { recursive: true }),
      mkdir(sistemaDir, { recursive: true }),
      mkdir(personalDocsDir, { recursive: true }),
      copyFile(devExePath, join(tempRoot, 'SejaElevar.exe')),
      writeFile(join(tempRoot, 'SejaElevar.html'), '<!doctype html><title>Smoke</title>'),
    ]);
    const sourceWorkbook = createWorkbookBuffer({ includeTarget: true });
    const purgedWorkbook = createWorkbookBuffer({ includeTarget: false });

    await Promise.all([
      writeFile(activeWorkbookPath, sourceWorkbook),
      writeFile(checkpointPath, sourceWorkbook),
      writeFile(join(checkpointsDir, '.gitkeep'), ''),
      writeFile(join(personalDocsDir, 'documento.txt'), 'personal'),
      writeFile(join(sistemaDir, 'data-index.json'), '{"stale":true}'),
      writeFile(
        join(sistemaDir, 'dados-elevar-controle.json'),
        JSON.stringify({
          OnUseFile: workbookName,
          BackupFile: null,
          BackupReason: null,
          RecoveryEnabled: true,
          HasEditingHistory: true,
          CaptureBackupOnNextSave: false,
        }),
      ),
      writeFile(
        join(sistemaDir, 'controle-global.json'),
        JSON.stringify({
          CheckpointId: checkpointName,
          Reason: 'before_edit',
          CreatedAt: new Date().toISOString(),
          RecoveryEnabled: true,
          HasEditingHistory: true,
          CaptureBackupOnNextSave: false,
          Checkpoints: [
            {
              CheckpointId: checkpointName,
              Reason: 'before_edit',
              CreatedAt: new Date().toISOString(),
              RecoveryEnabled: true,
            },
          ],
          LastCheckpointAction: 'edit',
        }),
      ),
    ]);

    provider = spawn(join(tempRoot, 'SejaElevar.exe'), [], {
      cwd: tempRoot,
      env: {
        ...process.env,
        SEJAELEVAR_NO_OPEN: '1',
        SEJAELEVAR_PORT: String(port),
        SEJAELEVAR_IDLE_TIMEOUT_MS: '60000',
      },
      stdio: 'ignore',
      windowsHide: true,
    });

    await waitForProvider(baseUrl);
    const purgeResponse = await fetch(
      `${baseUrl}/api/privacy/aprendiz-purge`,
      {
        method: 'PUT',
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-aprendiz-id': encodeURIComponent(APRENDIZ_ID),
          'x-privacy-confirmed': 'true',
        },
        body: purgedWorkbook,
      },
    );

    if (!purgeResponse.ok) {
      throw new Error(`Purge failed with HTTP ${purgeResponse.status}.`);
    }

    const purgeResult = await purgeResponse.json();
    const activeWorkbook = await readFile(activeWorkbookPath);
    const aprendizRows = getSheetRows(activeWorkbook, 'Aprendizes');
    const checkpointEntries = await readdir(checkpointsDir);
    const privacyState = JSON.parse(
      (await readFile(join(sistemaDir, 'privacy-state.json'), 'utf8')).replace(
        /^\uFEFF/,
        '',
      ),
    );
    const expectedHash = createHash('sha256')
      .update(APRENDIZ_ID)
      .digest('hex');

    if (aprendizRows.some((row) => row.includes(APRENDIZ_ID))) {
      throw new Error('Purged Aprendiz still exists in active workbook.');
    }

    if (!aprendizRows.some((row) => row.includes(OTHER_APRENDIZ_ID))) {
      throw new Error('Unrelated Aprendiz was removed.');
    }

    if (checkpointEntries.length !== 1 || checkpointEntries[0] !== '.gitkeep') {
      throw new Error('Checkpoint cleanup did not preserve only .gitkeep.');
    }

    try {
      await stat(personalDocsDir);
      throw new Error('Personal document folder still exists.');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (!privacyState.purgedAprendizIdHashes?.includes(expectedHash)) {
      throw new Error('Purged ID tombstone was not written.');
    }

    if (!purgeResult.historyResetId || purgeResult.recoveryReset !== true) {
      throw new Error('Purge response did not reset history/recovery.');
    }

    console.log('Privacy provider smoke passed.');
  } finally {
    await stopProvider(provider);
    await removeTempRoot(tempRoot);
  }
};

await run();
