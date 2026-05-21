import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { copyLauncherTo, publishLauncher } from './launcher-utils.mjs';

const distDir = 'dist';
const devDir = 'dev';
const indexPath = join(distDir, 'index.html');
const singleFilePath = join(distDir, 'SejaElevar.html');
const devHtmlPath = join(devDir, 'SejaElevar.html');

const html = await readFile(indexPath, 'utf-8');
const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/);
const styleMatch = html.match(/<link[^>]+href="\.\/assets\/([^"]+\.css)"[^>]*>/);
const iconMatch = html.match(/<link[^>]+rel="icon"[^>]+href="\.\/assets\/([^"]+)"[^>]*>/);

if (!scriptMatch || !styleMatch) {
  throw new Error('Nao foi possivel encontrar os arquivos gerados em dist/assets.');
}

const scriptFile = basename(scriptMatch[1]);
const styleFile = basename(styleMatch[1]);
const script = await readFile(join(distDir, 'assets', scriptFile), 'utf-8');
const styles = await readFile(join(distDir, 'assets', styleFile), 'utf-8');

const htmlWithoutAssets = html
  .replace(styleMatch[0], () => `<style>\n${styles}\n</style>`)
  .replace(scriptMatch[0], () => '');

const singleFileHtml = htmlWithoutAssets.replace(
  '</body>',
  () => `    <script>\n${script}\n</script>\n  </body>`,
);

await writeFile(singleFilePath, singleFileHtml, 'utf-8');
await publishLauncher();
await mkdir(join(devDir, 'assets'), { recursive: true });
await mkdir(join(devDir, 'dados', 'planilhas'), { recursive: true });
await mkdir(join(devDir, 'modelos'), { recursive: true });
await mkdir(join(devDir, 'documentos_gerados'), { recursive: true });
await rm(join(devDir, 'server.mjs'), { force: true });
await rm(join(devDir, 'Abrir SejaElevar.cmd'), { force: true });
await rm(join(devDir, 'SejaElevar.vbs'), { force: true });
await writeFile(devHtmlPath, singleFileHtml, 'utf-8');
await copyLauncherTo(devDir);
await writeFile(join(devDir, 'dados', 'planilhas', '.gitkeep'), '', 'utf-8');
await writeFile(join(devDir, 'modelos', '.gitkeep'), '', 'utf-8');
await writeFile(join(devDir, 'documentos_gerados', '.gitkeep'), '', 'utf-8');

if (iconMatch) {
  const iconFile = basename(iconMatch[1]);
  await cp(join(distDir, 'assets', iconFile), join(devDir, 'assets', iconFile));
}

console.log(`Arquivo unico criado: ${singleFilePath}`);
console.log(`Dev local atualizado: ${devHtmlPath}`);
