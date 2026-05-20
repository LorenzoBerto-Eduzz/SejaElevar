import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
2. De dois cliques em \`SejaElevar.html\`.
3. O app abrira no navegador. Voce pode favoritar a pagina aberta.

## Pastas

- \`assets/\`: arquivos internos do app e futuros arquivos de configuracao/salvamento local.
- \`dados/planilhas/\`: coloque aqui as planilhas \`.xlsx\` usadas pelo app.
- \`modelos/\`: modelos de documentos usados para geracao.
- \`documentos_gerados/\`: documentos gerados ou exportados pelo app.

Esta e uma versao local de teste. Nao coloque dados reais no Git.
Os arquivos .gitkeep existem apenas para manter as pastas vazias quando a pasta exportada viaja pelo Git.
`;

async function exportTo(releaseRoot) {
  await mkdir(join(releaseRoot, 'assets'), { recursive: true });
  await mkdir(join(releaseRoot, 'dados', 'planilhas'), { recursive: true });
  await mkdir(join(releaseRoot, 'modelos'), { recursive: true });
  await mkdir(join(releaseRoot, 'documentos_gerados'), { recursive: true });

  await writeFile(join(releaseRoot, 'SejaElevar.html'), releaseHtml, 'utf-8');
  await writeFile(join(releaseRoot, 'dados', 'planilhas', '.gitkeep'), '', 'utf-8');
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
console.log(`Abra: ${join(releaseRoot, 'SejaElevar.html')}`);
