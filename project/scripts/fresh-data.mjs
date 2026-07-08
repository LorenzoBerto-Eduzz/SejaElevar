import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import xlsx from 'xlsx';

const { utils, writeFile: writeWorkbookFile } = xlsx;

const devDir = 'dev';
const dadosDir = join(devDir, 'dados');
const checkpointsDir = join(dadosDir, 'checkpoints');
const sistemaDir = join(dadosDir, 'sistema');
const ementasDir = join(dadosDir, 'ementas');
const assetsDir = join(devDir, 'assets');

const workbookSheets = [
  [
    'Aprendizes',
    [
      'Nome',
      'Sexo',
      'Data de Nascimento',
      'Idade',
      'Contato',
      'E-mail',
      'CPF',
      'RG',
      'Turma',
      'Responsável',
      'Contato do Responsável',
      'E-mail do Responsável',
      'Endereço',
      'Instituição de Ensino',
      'Empresa',
      'Data de Admissão',
      'Data do Término',
      'Arco de Aprendizagem',
      'Função',
      'ID SejaElevar (não editar)',
      'Status',
    ],
  ],
  [
    'Turmas',
    ['Turma', 'Dia', 'Período', 'Instrutor', 'Sala', 'ID SejaElevar (não editar)'],
  ],
  ['Arcos', ['Arco', 'Arquivo Ementa', 'ID', 'Ementa ID']],
  ['Disciplinas', ['Disciplina', 'Módulo', 'Arco', 'Carga Horária', 'ID', 'Ementa ID']],
  ['Aulas', ['Aula', 'Cor', 'Instrutor Padrão', 'Sala Padrão', 'ID']],
  [
    'Aulas Disciplinas',
    ['Aula', 'Arco', 'Módulo', 'Disciplina', 'Aula ID', 'Disciplina ID', 'ID'],
  ],
  [
    'Cronograma',
    ['Turma', 'Data', 'Início', 'Fim', 'Tipo', 'Aula', 'Instrutor', 'Sala', 'Cor', 'Aula ID', 'ID'],
  ],
  ['Opções', ['Tipo', 'Valor']],
  [
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
  ],
  [
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
  ],
  [
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
  ],
  [
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
  ],
  [
    'Sistema SejaElevar',
    ['Chave', 'Valor'],
    [
      ['schemaVersion', '1'],
      ['schemaUpdatedAt', new Date().toISOString()],
    ],
  ],
];

const ensureGitkeep = async (dir) => {
  await mkdir(dir, { recursive: true });

  const gitkeepPath = join(dir, '.gitkeep');

  try {
    await access(gitkeepPath);
  } catch {
    await writeFile(gitkeepPath, '', 'utf-8');
  }
};

const keepGitkeepOnly = async (dir) => {
  await ensureGitkeep(dir);

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') {
      continue;
    }

    await rm(join(dir, entry.name), { recursive: true, force: true });
  }
};

const createEmptyWorkbook = (filePath) => {
  const workbook = utils.book_new();

  workbookSheets.forEach(([sheetName, columns, rows = []]) => {
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet([columns, ...rows]),
      sheetName,
    );
  });

  workbook.Workbook = {
    ...(workbook.Workbook ?? {}),
    Sheets: workbook.SheetNames.map((sheetName) => ({
      name: sheetName,
      Hidden: sheetName === 'Sistema SejaElevar' ? 1 : 0,
    })),
  };

  writeWorkbookFile(workbook, filePath);
};

const createTimestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    pad(now.getDate()),
    pad(now.getMonth() + 1),
    String(now.getFullYear()).slice(-2),
  ].join('');
};

await mkdir(dadosDir, { recursive: true });
await keepGitkeepOnly(checkpointsDir);
await keepGitkeepOnly(sistemaDir);
await keepGitkeepOnly(ementasDir);

for (const entry of await readdir(dadosDir, { withFileTypes: true })) {
  if (
    entry.name === '.gitkeep' ||
    entry.name === 'checkpoints' ||
    entry.name === 'ementas' ||
    entry.name === 'sistema'
  ) {
    continue;
  }

  await rm(join(dadosDir, entry.name), { recursive: true, force: true });
}

await ensureGitkeep(dadosDir);

const fileName = `DadosElevar_${createTimestamp()}.xlsx`;
const filePath = join(dadosDir, fileName);

createEmptyWorkbook(filePath);

await writeFile(
  join(sistemaDir, 'dados-elevar-controle.json'),
  JSON.stringify(
    {
      OnUseFile: fileName,
      BackupFile: null,
      BackupReason: null,
      RecoveryEnabled: false,
      HasEditingHistory: false,
      CaptureBackupOnNextSave: false,
    },
    null,
    2,
  ),
  'utf-8',
);

await mkdir(assetsDir, { recursive: true });
try {
  await writeFile(
    join(assetsDir, 'freshdev-reset.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), mode: 'freshdata' }, null, 2),
    'utf-8',
  );
} catch {
  console.warn('Aviso: dados criados, mas nao foi possivel atualizar freshdev-reset.json.');
}

console.log(`Freshdata concluido: ${fileName} criado como DadosElevar ativo vazio.`);
