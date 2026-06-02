import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const repoRoot = resolve(projectDir, '..');
const devDir = join(projectDir, 'dev');

const primaryReleaseRoot = join(repoRoot, 'exports', 'SejaElevar');
const exportsRoot = join(repoRoot, 'exports');

const devHtmlPath = join(devDir, 'SejaElevar.html');
const devExePath = join(devDir, 'SejaElevar.exe');
const devAssetsPath = join(devDir, 'assets');
const html = await readFile(devHtmlPath, 'utf-8');
const releaseMarker = 'window.SEJAELEVAR_RELEASE=true;';

if (!html.includes('    <script>') && !html.includes(releaseMarker)) {
  throw new Error('Nao foi possivel ativar o modo de release no HTML do pacote dev.');
}

const releaseHtml = html.includes(releaseMarker)
  ? html
  : html.replace(
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

async function exportTo(releaseRoot) {
  const relativeTarget = relative(exportsRoot, releaseRoot);

  if (
    relativeTarget === '' ||
    relativeTarget.startsWith('..') ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('Destino de release fora da pasta exports.');
  }

  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });
  await mkdir(join(releaseRoot, 'assets'), { recursive: true });
  await mkdir(join(releaseRoot, 'dados'), { recursive: true });
  await mkdir(join(releaseRoot, 'modelos'), { recursive: true });
  await mkdir(join(releaseRoot, 'documentos_gerados'), { recursive: true });

  await writeFile(join(releaseRoot, 'SejaElevar.html'), releaseHtml, 'utf-8');
  await cp(devExePath, join(releaseRoot, 'SejaElevar.exe'));
  await cp(devAssetsPath, join(releaseRoot, 'assets'), { recursive: true });
  await writeFile(join(releaseRoot, 'dados', '.gitkeep'), '', 'utf-8');
  await writeFile(join(releaseRoot, 'modelos', '.gitkeep'), '', 'utf-8');
  await writeFile(join(releaseRoot, 'documentos_gerados', '.gitkeep'), '', 'utf-8');
  await writeFile(join(releaseRoot, 'README.md'), readme, 'utf-8');

  return releaseRoot;
}

await access(devExePath);
await access(devAssetsPath);

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
