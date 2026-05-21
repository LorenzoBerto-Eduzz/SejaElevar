import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

const releaseRoot = dirname(fileURLToPath(import.meta.url));
const planilhasDir = join(releaseRoot, 'dados', 'planilhas');
const workbookPath = join(planilhasDir, 'aprendizes.xlsx');
const workbookMetaPath = join(planilhasDir, 'aprendizes.json');
const preferredPort = Number(process.env.SEJAELEVAR_PORT || 3838);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const sendJson = (response, status, body) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

const getOriginalFileName = async () => {
  try {
    const metadata = JSON.parse(await readFile(workbookMetaPath, 'utf-8'));
    return metadata.originalFileName || 'aprendizes.xlsx';
  } catch {
    return 'aprendizes.xlsx';
  }
};

const serveWorkbook = async (response) => {
  try {
    await stat(workbookPath);
  } catch {
    sendJson(response, 404, { error: 'Planilha nao importada.' });
    return;
  }

  response.writeHead(200, {
    'content-type': mimeTypes['.xlsx'],
    'content-disposition': 'inline; filename="aprendizes.xlsx"',
    'x-file-name': encodeURIComponent(await getOriginalFileName()),
    'cache-control': 'no-store',
  });
  createReadStream(workbookPath).pipe(response);
};

const saveWorkbook = async (request, response) => {
  const body = await readBody(request);

  if (body.length === 0) {
    sendJson(response, 400, { error: 'Arquivo vazio.' });
    return;
  }

  await mkdir(planilhasDir, { recursive: true });
  await writeFile(workbookPath, body);

  const rawName = request.headers['x-file-name'];
  const originalFileName =
    typeof rawName === 'string' && rawName
      ? decodeURIComponent(rawName)
      : 'aprendizes.xlsx';

  await writeFile(
    workbookMetaPath,
    JSON.stringify(
      {
        originalFileName,
        storedFileName: 'aprendizes.xlsx',
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );

  sendJson(response, 200, {
    ok: true,
    fileName: 'aprendizes.xlsx',
    originalFileName,
  });
};

const serveStatic = async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname =
    requestUrl.pathname === '/'
      ? '/SejaElevar.html'
      : decodeURIComponent(requestUrl.pathname);
  const normalizedPath = pathname.replace(/^\/+/, '').replaceAll('\\', '/');
  const requestedPath = join(releaseRoot, normalizedPath);

  if (!requestedPath.startsWith(releaseRoot)) {
    sendJson(response, 403, { error: 'Caminho bloqueado.' });
    return;
  }

  try {
    await stat(requestedPath);
  } catch {
    response.writeHead(302, { location: '/' });
    response.end();
    return;
  }

  response.writeHead(200, {
    'content-type': mimeTypes[extname(requestedPath)] || 'application/octet-stream',
  });
  createReadStream(requestedPath).pipe(response);
};

await mkdir(planilhasDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

    if (request.method === 'GET' && requestUrl.pathname === '/api/app/status') {
      sendJson(response, 200, {
        localServer: true,
        releaseRoot,
        workbookPath,
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/aprendizes/file') {
      await serveWorkbook(response);
      return;
    }

    if (
      (request.method === 'POST' &&
        requestUrl.pathname === '/api/aprendizes/import') ||
      (request.method === 'PUT' && requestUrl.pathname === '/api/aprendizes/file')
    ) {
      await saveWorkbook(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Erro interno do servidor local.' });
  }
});

const listen = (port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(port);
    });
  });

let port = preferredPort;

for (;;) {
  try {
    await listen(port);
    break;
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') {
      throw error;
    }
    port += 1;
  }
}

const url = `http://127.0.0.1:${port}/`;

console.log(`SejaElevar aberto em ${url}`);
console.log(`Dados em ${planilhasDir}`);

if (process.platform === 'win32' && process.env.SEJAELEVAR_NO_OPEN !== '1') {
  spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}
