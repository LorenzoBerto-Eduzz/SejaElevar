import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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

const prepareLauncherIcon = async () => {
  await cp(
    join('src', 'assets', 'windows-icon.ico'),
    join(launcherDir, 'AppIcon.ico'),
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
      '-p:IncludeAllContentForSelfExtract=true',
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
