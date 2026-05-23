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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyLauncherTo } from './launcher-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const repoRoot = resolve(projectDir, '..');
const distDir = join(projectDir, 'dist');

const primaryReleaseRoot = join(repoRoot, 'exports', 'SejaElevar');

const builtHtmlPath = join(distDir, 'SejaElevar.html');
const html = await readFile(builtHtmlPath, 'utf-8');
const releaseHtml = html.replace(
  '    <script>',
  '    <script>window.SEJAELEVAR_RELEASE=true;</script>\n    <script>',
);

const readme = `# SejaElevar

## Como abrir

1. Abra esta pasta.
2. De dois cliques em \`SejaElevar.exe\`.
3. O app abrira no navegador.
4. Use o botao \`Importar .xlsx\` dentro da aba Aprendizes.

Observacao: o aplicativo usa a pasta \`dados/\` como local central dos dados. Ao importar ou editar, a planilha em uso e gravada como \`Aprendizes_hhmmssddmmyy.xlsx\`.

## Pastas

- \`assets/\`: arquivos internos do app e futuros arquivos de configuracao/salvamento local.
- \`dados/\`: planilhas e outros dados usados/editados pelo app.
- \`modelos/\`: modelos de documentos usados para geracao.
- \`documentos_gerados/\`: documentos gerados ou exportados pelo app.

Esta e uma versao local de teste. Nao coloque dados reais no Git.
Os arquivos .gitkeep existem apenas para manter as pastas vazias quando a pasta exportada viaja pelo Git.
`;

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

async function exportTo(releaseRoot) {
  await rm(join(releaseRoot, 'Abrir SejaElevar.cmd'), { force: true });
  await rm(join(releaseRoot, 'SejaElevar.vbs'), { force: true });
  await rm(join(releaseRoot, 'server.mjs'), { force: true });
  await mkdir(join(releaseRoot, 'assets'), { recursive: true });
  await mkdir(join(releaseRoot, 'dados'), { recursive: true });
  await migrateLegacyPlanilhas(join(releaseRoot, 'dados'));
  await mkdir(join(releaseRoot, 'modelos'), { recursive: true });
  await mkdir(join(releaseRoot, 'documentos_gerados'), { recursive: true });

  await writeFile(join(releaseRoot, 'SejaElevar.html'), releaseHtml, 'utf-8');
  await copyLauncherTo(releaseRoot);
  await writeFile(join(releaseRoot, 'dados', '.gitkeep'), '', 'utf-8');
  await writeFile(join(releaseRoot, 'modelos', '.gitkeep'), '', 'utf-8');
  await writeFile(join(releaseRoot, 'documentos_gerados', '.gitkeep'), '', 'utf-8');

  const iconMatch = html.match(
    /<link[^>]+rel="icon"[^>]+href="\.\/assets\/([^"]+)"[^>]*>/,
  );

  if (iconMatch) {
    const iconFile = basename(iconMatch[1]);
    await cp(join(distDir, 'assets', iconFile), join(releaseRoot, 'assets', iconFile));
  }

  await writeFile(join(releaseRoot, 'README.md'), readme, 'utf-8');

  return releaseRoot;
}

let releaseRoot = primaryReleaseRoot;

try {
  await exportTo(releaseRoot);
} catch (error) {
  if (error?.code !== 'EPERM') {
    throw error;
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '-');
  releaseRoot = join(repoRoot, 'exports', `SejaElevar-${stamp}`);
  await exportTo(releaseRoot);
  console.warn(
    `A pasta principal estava bloqueada pelo Windows. Criado fallback em: ${releaseRoot}`,
  );
}

console.log(`Release local criado em: ${releaseRoot}`);
console.log(`Abra: ${join(releaseRoot, 'SejaElevar.exe')}`);
