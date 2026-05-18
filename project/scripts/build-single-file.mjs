import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const distDir = 'dist';
const indexPath = join(distDir, 'index.html');
const singleFilePath = join(distDir, 'SejaElevar.html');

const html = await readFile(indexPath, 'utf-8');
const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/);
const styleMatch = html.match(/<link[^>]+href="\.\/assets\/([^"]+\.css)"[^>]*>/);

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
console.log(`Arquivo unico criado: ${singleFilePath}`);
