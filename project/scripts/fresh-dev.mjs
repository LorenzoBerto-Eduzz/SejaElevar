import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const devDir = 'dev';
const dadosDir = join(devDir, 'dados');
const checkpointsDir = join(dadosDir, 'checkpoints');
const sistemaDir = join(dadosDir, 'sistema');
const assetsDir = join(devDir, 'assets');

const keepGitkeepOnly = async (dir) => {
  await mkdir(dir, { recursive: true });

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') {
      continue;
    }

    await rm(join(dir, entry.name), { recursive: true, force: true });
  }

  await writeFile(join(dir, '.gitkeep'), '', 'utf-8');
};

await mkdir(dadosDir, { recursive: true });
await keepGitkeepOnly(checkpointsDir);
await keepGitkeepOnly(sistemaDir);

for (const entry of await readdir(dadosDir, { withFileTypes: true })) {
  if (
    entry.name === '.gitkeep' ||
    entry.name === 'checkpoints' ||
    entry.name === 'sistema'
  ) {
    continue;
  }

  await rm(join(dadosDir, entry.name), { recursive: true, force: true });
}

await writeFile(join(dadosDir, '.gitkeep'), '', 'utf-8');
await mkdir(assetsDir, { recursive: true });
await writeFile(
  join(assetsDir, 'freshdev-reset.json'),
  JSON.stringify({ createdAt: new Date().toISOString() }, null, 2),
  'utf-8',
);

console.log('Freshdev concluido: dados limpo e historico dev marcado para limpar no proximo inicio.');
