import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const launcherDir = 'launcher';
const launcherTargetFramework = 'net8.0-windows10.0.17763.0';
const launcherPublishDir = join(
  launcherDir,
  'bin',
  'Release',
  launcherTargetFramework,
  'win-x64',
  'publish',
);
const launcherFingerprintFile = join('assets', 'launcher-fingerprint.json');

const prepareLauncherIcon = async () => {
  await cp(
    join('src', 'assets', 'windows-icon.ico'),
    join(launcherDir, 'AppIcon.ico'),
  );
};

const listLauncherInputs = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'bin' || entry.name === 'obj' || entry.name === 'AppIcon.ico') {
      continue;
    }

    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listLauncherInputs(path)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
};

const fileExists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const getLauncherFingerprint = async () => {
  const hash = createHash('sha256');
  const files = [
    ...(await listLauncherInputs(launcherDir)),
    join('src', 'assets', 'windows-icon.ico'),
  ].sort();

  for (const file of files) {
    hash.update(relative('.', file));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }

  return {
    version: 1,
    hash: hash.digest('hex'),
  };
};

const readLauncherFingerprint = async (targetDir) => {
  try {
    return JSON.parse(await readFile(join(targetDir, launcherFingerprintFile), 'utf-8'));
  } catch {
    return null;
  }
};

const writeLauncherFingerprint = async (targetDir, fingerprint) => {
  await mkdir(join(targetDir, 'assets'), { recursive: true });
  await writeFile(
    join(targetDir, launcherFingerprintFile),
    `${JSON.stringify(fingerprint, null, 2)}\n`,
    'utf-8',
  );
};

export const publishLauncher = async () => {
  await prepareLauncherIcon();

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
      '-p:IncludeAllContentForSelfExtract=false',
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

export const ensureLauncherIn = async (targetDir) => {
  const fingerprint = await getLauncherFingerprint();
  const previousFingerprint = await readLauncherFingerprint(targetDir);
  const targetExePath = join(targetDir, 'SejaElevar.exe');

  if (
    previousFingerprint?.hash === fingerprint.hash &&
    previousFingerprint?.version === fingerprint.version &&
    (await fileExists(targetExePath))
  ) {
    console.log('Launcher inalterado: mantendo dev/SejaElevar.exe existente.');
    await writeLauncherFingerprint(targetDir, fingerprint);
    return;
  }

  if (!previousFingerprint && (await fileExists(targetExePath))) {
    console.log('Launcher sem fingerprint anterior: registrando estado atual sem republicar exe.');
    await writeLauncherFingerprint(targetDir, fingerprint);
    return;
  }

  await publishLauncher();
  await copyLauncherTo(targetDir);
  await writeLauncherFingerprint(targetDir, fingerprint);
};
