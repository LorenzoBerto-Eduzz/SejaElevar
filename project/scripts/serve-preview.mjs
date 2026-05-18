import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const preferredPort = Number(process.env.PORT || 5173);
const shouldOpen = process.argv.includes('--open');
const distDir = resolve('dist');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('A pasta dist/ ainda nao existe. Rode: npm run build');
  process.exit(1);
}

const openBrowser = (url) => {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
};

const safePathForUrl = async (requestUrl) => {
  const url = new URL(requestUrl || '/', `http://${host}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath =
    decodedPath === '/' ? join(distDir, 'index.html') : join(distDir, decodedPath);
  const normalizedPath = normalize(requestedPath);

  if (!normalizedPath.startsWith(distDir)) {
    return null;
  }

  try {
    const fileStat = await stat(normalizedPath);
    if (fileStat.isFile()) {
      return normalizedPath;
    }
  } catch {
    return join(distDir, 'index.html');
  }

  return join(distDir, 'index.html');
};

const server = createServer(async (request, response) => {
  const filePath = await safePathForUrl(request.url);

  if (!filePath) {
    response.writeHead(403);
    response.end('Acesso negado');
    return;
  }

  const extension = extname(filePath);
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${preferredPort} ja esta em uso.`);
    console.error('Feche o outro processo ou rode com outra porta:');
    console.error('  $env:PORT=5174; npm start');
    process.exit(1);
  }

  throw error;
});

server.listen(preferredPort, host, () => {
  const url = `http://${host}:${preferredPort}`;
  console.log(`SejaElevar aberto em ${url}`);
  if (shouldOpen) {
    openBrowser(url);
  }
});
