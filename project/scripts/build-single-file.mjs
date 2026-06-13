import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { ensureLauncherIn } from './launcher-utils.mjs';

const distDir = 'dist';
const devDir = 'dev';
const indexPath = join(distDir, 'index.html');
const singleFilePath = join(distDir, 'SejaElevar.html');
const devHtmlPath = join(devDir, 'SejaElevar.html');

const html = await readFile(indexPath, 'utf-8');
const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/);
const styleMatch = html.match(/<link[^>]+href="\.\/assets\/([^"]+\.css)"[^>]*>/);

if (!scriptMatch || !styleMatch) {
  throw new Error('Nao foi possivel encontrar os arquivos gerados em dist/assets.');
}

const packagedHtml = html;

const preservedDevEntries = new Set([
  'assets',
  'dados',
  'documentos_gerados',
  'modelos',
  'SejaElevar.exe',
  'SejaElevar.html',
  'SejaElevar.log',
]);

const cleanDevRoot = async () => {
  await mkdir(devDir, { recursive: true });

  for (const entry of await readdir(devDir, { withFileTypes: true })) {
    if (preservedDevEntries.has(entry.name)) {
      continue;
    }

    await rm(join(devDir, entry.name), { recursive: true, force: true });
  }
};

const preservedDevAssetEntries = new Set(['launcher-fingerprint.json', 'window-settings.json']);

const cleanDevAssets = async () => {
  const devAssetsDir = join(devDir, 'assets');
  await mkdir(devAssetsDir, { recursive: true });

  for (const entry of await readdir(devAssetsDir, { withFileTypes: true })) {
    if (preservedDevAssetEntries.has(entry.name)) {
      continue;
    }

    await rm(join(devAssetsDir, entry.name), { recursive: true, force: true });
  }
};

const getTimestamp = () => {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');

  return `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}${two(
    now.getDate(),
  )}${two(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`;
};

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const migrateLegacyPlanilhas = async (dadosDir) => {
  const legacyDir = join(dadosDir, 'planilhas');

  try {
    const entries = await readdir(legacyDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = join(legacyDir, entry.name);

      if (entry.name === '.gitkeep') {
        await rm(sourcePath, { force: true });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let targetPath = join(dadosDir, entry.name);

      if (await exists(targetPath)) {
        const dotIndex = entry.name.lastIndexOf('.');
        const baseName = dotIndex > 0 ? entry.name.slice(0, dotIndex) : entry.name;
        const extension = dotIndex > 0 ? entry.name.slice(dotIndex) : '';
        targetPath = join(dadosDir, `${baseName}_${getTimestamp()}${extension}`);
      }

      await rename(sourcePath, targetPath);
    }

    await rm(legacyDir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
};

await writeFile(singleFilePath, packagedHtml, 'utf-8');
await cleanDevRoot();
await cleanDevAssets();
await cp(join(distDir, 'assets'), join(devDir, 'assets'), { recursive: true });
await ensureLauncherIn(devDir);
await mkdir(join(devDir, 'dados'), { recursive: true });
await migrateLegacyPlanilhas(join(devDir, 'dados'));
await mkdir(join(devDir, 'modelos'), { recursive: true });
await mkdir(join(devDir, 'documentos_gerados'), { recursive: true });
await rm(join(devDir, 'server.mjs'), { force: true });
await rm(join(devDir, 'Abrir SejaElevar.cmd'), { force: true });
await rm(join(devDir, 'SejaElevar.vbs'), { force: true });
await writeFile(devHtmlPath, packagedHtml, 'utf-8');
await writeFile(join(devDir, 'dados', '.gitkeep'), '', 'utf-8');
await writeFile(join(devDir, 'modelos', '.gitkeep'), '', 'utf-8');
await writeFile(join(devDir, 'documentos_gerados', '.gitkeep'), '', 'utf-8');

console.log(`Arquivo principal criado: ${singleFilePath}`);
console.log(`Dev local atualizado: ${devHtmlPath}`);
