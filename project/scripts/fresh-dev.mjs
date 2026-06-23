import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const devDir = 'dev';
const dadosDir = join(devDir, 'dados');
const checkpointsDir = join(dadosDir, 'checkpoints');
const sistemaDir = join(dadosDir, 'sistema');
const ementasDir = join(dadosDir, 'ementas');
const assetsDir = join(devDir, 'assets');

const keepGitkeepOnly = async (dir) => {
  await mkdir(dir, { recursive: true });

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') {
      continue;
    }

    await rm(join(dir, entry.name), { recursive: true, force: true });
  }

  const gitkeepPath = join(dir, '.gitkeep');

  try {
    await access(gitkeepPath);
  } catch {
    await writeFile(gitkeepPath, '', 'utf-8');
  }
};

const ensureGitkeep = async (dir) => {
  const gitkeepPath = join(dir, '.gitkeep');

  try {
    await access(gitkeepPath);
  } catch {
    await writeFile(gitkeepPath, '', 'utf-8');
  }
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
await mkdir(assetsDir, { recursive: true });
try {
  await writeFile(
    join(assetsDir, 'freshdev-reset.json'),
    JSON.stringify({ createdAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
} catch {
  console.warn('Aviso: dados limpos, mas nao foi possivel atualizar freshdev-reset.json.');
}

console.log('Freshdev concluido: dados limpo e historico dev marcado para limpar no proximo inicio.');
