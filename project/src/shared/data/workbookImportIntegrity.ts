import {
  readManagedWorkbookSheets,
  type ManagedWorkbookSheets,
} from './dataHealth';
import {
  getStoredRecordId,
  inspectWorkbookImportTransition,
  WorkbookIntegrityError,
  type WorkbookIntegrityIssue,
} from './dependencyInspector';
import { fetchBaseWorkbookFile } from './workspaceData';
import { APRENDIZES_ENTITY_ID } from './dataIndex';

export type WorkbookImportIntegrityResult = {
  candidateSheets: ManagedWorkbookSheets;
  currentSheets: ManagedWorkbookSheets | null;
  issues: WorkbookIntegrityIssue[];
};

export const hashPrivacyRecordId = async (recordId: string) => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(recordId),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const inspectPurgedAprendizReintroduction = async (
  candidateSheets: ManagedWorkbookSheets,
  purgedAprendizIdHashes: Set<string>,
): Promise<WorkbookIntegrityIssue[]> => {
  const candidateAprendizIds = candidateSheets.aprendizes.rows
    .map((row) => getStoredRecordId(candidateSheets.aprendizes, row))
    .filter(Boolean);
  const candidateAprendizIdHashes = await Promise.all(
    candidateAprendizIds.map(hashPrivacyRecordId),
  );

  return candidateAprendizIdHashes.flatMap(
    (recordIdHash, index): WorkbookIntegrityIssue[] => {
      if (!purgedAprendizIdHashes.has(recordIdHash)) {
        return [];
      }

      return [
        {
          code: 'purged-aprendiz-reintroduced',
          severity: 'error',
          blocking: true,
          area: 'Importação',
          title: 'Dados pessoais anteriormente excluídos',
          detail:
            'O arquivo escolhido tenta reintroduzir um Aprendiz que passou por exclusão permanente. Cadastre novamente pelo aplicativo somente se houver uma nova relação institucional.',
          entityId: APRENDIZES_ENTITY_ID,
          recordId: candidateAprendizIds[index],
        },
      ];
    },
  );
};

const readPurgedAprendizIdHashes = async () => {
  try {
    const response = await fetch('/api/privacy/state', {
      cache: 'no-store',
    });

    if (!response.ok) {
      return new Set<string>();
    }

    const state = (await response.json()) as {
      purgedAprendizIdHashes?: unknown;
    };
    const hashes = Array.isArray(state.purgedAprendizIdHashes)
      ? state.purgedAprendizIdHashes
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      : [];

    return new Set(hashes);
  } catch {
    return new Set<string>();
  }
};

export const validateWorkbookImportIntegrity = async (
  candidateFile: File,
): Promise<WorkbookImportIntegrityResult> => {
  const currentFile = await fetchBaseWorkbookFile();
  const [candidateSheets, currentSheets, purgedAprendizIdHashes] = await Promise.all([
    readManagedWorkbookSheets(candidateFile),
    currentFile ? readManagedWorkbookSheets(currentFile) : Promise.resolve(null),
    readPurgedAprendizIdHashes(),
  ]);
  const issues = inspectWorkbookImportTransition(currentSheets, candidateSheets);
  issues.push(
    ...(await inspectPurgedAprendizReintroduction(
      candidateSheets,
      purgedAprendizIdHashes,
    )),
  );
  const blockingIssues = issues.filter((issue) => issue.blocking);

  if (blockingIssues.length > 0) {
    throw new WorkbookIntegrityError(blockingIssues);
  }

  return {
    candidateSheets,
    currentSheets,
    issues,
  };
};
