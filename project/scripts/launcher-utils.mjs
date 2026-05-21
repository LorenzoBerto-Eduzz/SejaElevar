import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const launcherDir = 'launcher';
const launcherPublishDir = join(
  launcherDir,
  'bin',
  'Release',
  'net8.0-windows',
  'win-x64',
  'publish',
);

const getPngDimensions = (png) => {
  const signature = png.subarray(0, 8).toString('hex');

  if (signature !== '89504e470d0a1a0a') {
    throw new Error('App icon must be a PNG file.');
  }

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
};

const createIcoFromPng = async () => {
  const png = await readFile(join('src', 'assets', 'app-icon.png'));
  const { width, height } = getPngDimensions(png);
  const header = Buffer.alloc(22);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width >= 256 ? 0 : width, 6);
  header.writeUInt8(height >= 256 ? 0 : height, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);

  await writeFile(join(launcherDir, 'AppIcon.ico'), Buffer.concat([header, png]));
};

export const publishLauncher = async () => {
  await createIcoFromPng();

  const result = spawnSync(
    'dotnet',
    [
      'publish',
      launcherDir,
      '-c',
      'Release',
      '-r',
      'win-x64',
      '--self-contained',
      'true',
      '-p:PublishSingleFile=true',
      '-p:DebugType=None',
      '-p:DebugSymbols=false',
      '-v',
      'minimal',
    ],
    {
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    throw new Error('Falha ao gerar o launcher SejaElevar.exe.');
  }
};

export const copyLauncherTo = async (targetDir) => {
  await mkdir(targetDir, { recursive: true });
  await cp(join(launcherPublishDir, 'SejaElevar.exe'), join(targetDir, 'SejaElevar.exe'));
};
