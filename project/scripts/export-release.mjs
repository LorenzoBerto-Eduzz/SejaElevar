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
2. De dois cliques em \`SejaElevar.vbs\`.
3. O app abrira no navegador.
4. Depois disso, use o botao \`Importar .xlsx\` dentro da aba Aprendizes.

## Pastas

- \`assets/\`: arquivos internos do app e futuros arquivos de configuracao/salvamento local.
- \`dados/planilhas/\`: o app grava aqui a copia de trabalho \`aprendizes.xlsx\` usada pela aba Aprendizes.
- \`modelos/\`: modelos de documentos usados para geracao.
- \`documentos_gerados/\`: documentos gerados ou exportados pelo app.

Esta e uma versao local de teste. Nao coloque dados reais no Git.
Os arquivos .gitkeep existem apenas para manter as pastas vazias quando a pasta exportada viaja pelo Git.
`;

const launcher = `Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)

If shell.Run("cmd /c node --version", 0, True) <> 0 Then
  MsgBox "Node.js nao foi encontrado. Instale Node.js LTS para abrir o SejaElevar.", 48, "SejaElevar"
  WScript.Quit 1
End If

shell.CurrentDirectory = folder
shell.Run "node server.mjs", 0, False
`;

async function exportTo(releaseRoot) {
  await mkdir(join(releaseRoot, 'assets'), { recursive: true });
  await mkdir(join(releaseRoot, 'dados', 'planilhas'), { recursive: true });
  await mkdir(join(releaseRoot, 'modelos'), { recursive: true });
  await mkdir(join(releaseRoot, 'documentos_gerados'), { recursive: true });

  await writeFile(join(releaseRoot, 'SejaElevar.html'), releaseHtml, 'utf-8');
  await cp(join(projectDir, 'scripts', 'release-server.mjs'), join(releaseRoot, 'server.mjs'));
  await writeFile(join(releaseRoot, 'SejaElevar.vbs'), launcher, 'utf-8');
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
console.log(`Abra: ${join(releaseRoot, 'SejaElevar.vbs')}`);
