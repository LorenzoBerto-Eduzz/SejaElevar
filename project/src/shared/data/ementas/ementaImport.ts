import {
  GLOBAL_DATA_CHANGED_EVENT,
  GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT,
} from '../events';
import { markGlobalWorkbookAvailable } from '../../ui/GlobalWorkbookToolbar';
import { fetchBaseWorkbookFile, fetchRecoveryInfo } from '../workspaceData';
import { parseEmentaPdf } from './ementaParser';
import { saveParsedEmentaToWorkbook } from './ementaWorkbook';
import { EMENTA_PARSER_VERSION } from './ementaTypes';

const responseToPdfFile = async (response: Response) => {
  const rawFileName = response.headers.get('x-file-name') || 'ementa.pdf';
  const fileName = decodeURIComponent(rawFileName);
  const blob = await response.blob();

  return new File([blob], fileName, {
    type: blob.type || 'application/pdf',
  });
};

const pickEmentaPdf = async () => {
  const response = await fetch('/api/ementas/pick', {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('ementa-pick-failed');
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const result = (await response.json()) as { canceled?: boolean };
    return result.canceled ? null : undefined;
  }

  return responseToPdfFile(response);
};

const storeEmentaPdf = async (
  file: File,
  parsed: Awaited<ReturnType<typeof parseEmentaPdf>>,
) => {
  const response = await fetch('/api/ementas/store', {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      'x-file-name': encodeURIComponent(file.name),
      'x-arco-name': encodeURIComponent(parsed.arco),
      'x-ementa-id': encodeURIComponent(parsed.id),
      'x-parser': encodeURIComponent(EMENTA_PARSER_VERSION),
    },
    body: await file.arrayBuffer(),
  });

  if (!response.ok) {
    throw new Error('ementa-store-failed');
  }

  return (await response.json()) as {
    id?: string;
    fileName?: string;
    originalFileName?: string;
    arco?: string;
  };
};

export const importEmentaFromPicker = async () => {
  const activeWorkbook = await fetchBaseWorkbookFile().catch(() => null);

  if (!activeWorkbook) {
    throw new Error('missing-base-workbook');
  }

  const file = await pickEmentaPdf();

  if (!file) {
    return null;
  }

  const parsed = await parseEmentaPdf(file);
  const stored = await storeEmentaPdf(file, parsed);
  const savedWorkbook = await saveParsedEmentaToWorkbook({
    ...parsed,
    id: stored.id || parsed.id,
    storedFileName: stored.fileName,
  });
  const recoveryInfo = await fetchRecoveryInfo().catch(() => null);

  markGlobalWorkbookAvailable(recoveryInfo);
  window.dispatchEvent(
    new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
      detail: {
        file: savedWorkbook,
        fileName: savedWorkbook.name,
        reason: 'ementa-import',
        force: true,
      },
    }),
  );
  window.dispatchEvent(new Event(GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT));

  return {
    parsed,
    stored,
    workbook: savedWorkbook,
  };
};
