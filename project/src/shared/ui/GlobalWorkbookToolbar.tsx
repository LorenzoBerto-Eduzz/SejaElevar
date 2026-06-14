import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GLOBAL_DATA_CHANGED_EVENT,
  GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
} from '../data/events';
import { BASE_WORKBOOK_SHEETS } from '../data/baseWorkbook';
import { getWorkbookSheet } from '../data/workbookSheets';
import { normalizeColumnsForSchema } from '../data/schemas';
import {
  getGlobalUndoBoundarySnapshot,
  pushGlobalBoundaryUndoEntry,
  pushGlobalUndoEntry,
} from '../undo/globalUndo';
import { ThemeToggleButton } from './ThemeToggleButton';

type XlsxModule = typeof import('xlsx');
type XlsxWorksheet = ReturnType<XlsxModule['utils']['aoa_to_sheet']>;

type RecoveryReason =
  | 'before_import'
  | 'before_edit'
  | 'before_session_edit'
  | 'import_original'
  | 'before_recovery'
  | 'after_recovery';

type RecoveryInfo = {
  available: boolean;
  canRecover: boolean;
  checkpointId?: string | null;
  formattedUpdatedAt?: string | null;
  fileCount?: number | null;
  importCount?: number | null;
  reason?: RecoveryReason | null;
  checkpoints?: Array<{
    checkpointId?: string | null;
    canRecover: boolean;
    formattedUpdatedAt?: string | null;
    fileCount?: number | null;
    importCount?: number | null;
    reason?: RecoveryReason | null;
  }>;
};

type GlobalToolbarState = {
  hasWorkbook: boolean;
  recoveryInfo: RecoveryInfo | null;
  hasLoaded: boolean;
};

const ACTIVE_WORKBOOK_SHEETS = BASE_WORKBOOK_SHEETS.filter(
  (sheet) => sheet.status === 'active-legacy-workbook',
);

let xlsxModulePromise: Promise<XlsxModule> | null = null;
let latestGlobalToolbarState: GlobalToolbarState = {
  hasWorkbook: false,
  recoveryInfo: null,
  hasLoaded: false,
};

const loadXlsx = () => {
  xlsxModulePromise ??= import('xlsx');
  return xlsxModulePromise;
};

const extractColumns = (
  utils: XlsxModule['utils'],
  worksheet: XlsxWorksheet,
) => {
  const rows = utils.sheet_to_json<string[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });

  return (rows[0] ?? []).map((column) => String(column ?? '').trim());
};

const validateGlobalWorkbookFile = async (file: File) => {
  const { read, utils } = await loadXlsx();
  const workbook = read(await file.arrayBuffer(), {
    cellDates: true,
  });

  for (const sheetDefinition of ACTIVE_WORKBOOK_SHEETS) {
    const { worksheet } = getWorkbookSheet(
      workbook,
      sheetDefinition.sheetName,
    );

    if (!worksheet) {
      throw new Error('missing-required-sheet');
    }

    const columns = extractColumns(utils, worksheet);
    const { missingColumns } = normalizeColumnsForSchema(
      columns,
      sheetDefinition.requiredColumns,
    );

    if (missingColumns.length > 0) {
      throw new Error('missing-required-columns');
    }
  }
};

const fetchRecoveryInfo = async () => {
  const response = await fetch('/api/recovery', {
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as RecoveryInfo;
};

const recoverGlobalData = async (checkpointId?: unknown) => {
  const headers: Record<string, string> =
    typeof checkpointId === 'string' && checkpointId
      ? { 'x-checkpoint-id': checkpointId }
      : {};
  const response = await fetch('/api/recovery', {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    throw new Error('recovery-failed');
  }

  const result = (await response.json()) as { checkpointId?: string | null };
  window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
  return result;
};

const getRecoveryDescription = (info: RecoveryInfo | null) => {
  switch (info?.reason) {
    case 'before_import':
      if ((info.fileCount ?? 0) === 0) {
        return (info.importCount ?? 0) > 1
          ? 'Recupere os dados para como estavam antes das primeiras importa\u00e7\u00f5es.'
          : 'Recupere os dados para como estavam antes da primeira importa\u00e7\u00e3o.';
      }

      return (info.importCount ?? 0) > 1
        ? 'Recupere os dados para como estavam antes das \u00faltimas importa\u00e7\u00f5es.'
        : 'Recupere os dados para como estavam antes da \u00faltima importa\u00e7\u00e3o.';
    case 'before_edit':
      return 'Recupere os dados para como estavam antes de edi\u00e7\u00f5es nesta sess\u00e3o.';
    case 'before_session_edit':
      return 'Recupere os dados para como estavam antes da \u00faltima sess\u00e3o com edi\u00e7\u00f5es.';
    case 'import_original':
      return 'Recupere os dados para como estavam quando foram importados pela primeira vez.';
    case 'before_recovery':
      return 'Recupere os dados para como estavam antes da \u00faltima recupera\u00e7\u00e3o.';
    case 'after_recovery':
      return 'Recupere os dados para como estavam ap\u00f3s a \u00faltima recupera\u00e7\u00e3o.';
    default:
      return 'Nenhum backup dispon\u00edvel para recuperar.';
  }
};

type GlobalWorkbookToolbarProps = {
  className?: string;
};

export function GlobalWorkbookToolbar({
  className = '',
}: GlobalWorkbookToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasWorkbook, setHasWorkbook] = useState(
    latestGlobalToolbarState.hasWorkbook,
  );
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(
    latestGlobalToolbarState.recoveryInfo,
  );
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [isRecoveringBackup, setIsRecoveringBackup] = useState(false);
  const [invalidImportToast, setInvalidImportToast] = useState('');

  const refreshGlobalDataState = async () => {
    const [fileResponse, nextRecoveryInfo] = await Promise.all([
      fetch('/api/base-workbook/file', {
        cache: 'no-store',
      }).catch(() => null),
      fetchRecoveryInfo().catch(() => null),
    ]);

    latestGlobalToolbarState = {
      hasWorkbook: Boolean(fileResponse?.ok),
      recoveryInfo: nextRecoveryInfo,
      hasLoaded: true,
    };
    setHasWorkbook(latestGlobalToolbarState.hasWorkbook);
    setRecoveryInfo(latestGlobalToolbarState.recoveryInfo);
    return nextRecoveryInfo;
  };

  useEffect(() => {
    void refreshGlobalDataState();

    const handleGlobalDataChanged = () => {
      void refreshGlobalDataState();
    };
    const handleImportRequest = (event: Event) => {
      const requestedFile =
        event instanceof CustomEvent && event.detail instanceof File
          ? event.detail
          : undefined;

      if (requestedFile) {
        void importWorkingFile(requestedFile);
        return;
      }

      importFromPicker();
    };

    window.addEventListener(GLOBAL_DATA_CHANGED_EVENT, handleGlobalDataChanged);
    window.addEventListener(
      GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
      handleImportRequest,
    );

    return () => {
      window.removeEventListener(
        GLOBAL_DATA_CHANGED_EVENT,
        handleGlobalDataChanged,
      );
      window.removeEventListener(
        GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
        handleImportRequest,
      );
    };
  }, []);

  const showInvalidImportToast = () => {
    setInvalidImportToast('');
    window.setTimeout(() => {
      setInvalidImportToast(
        'Arquivo escolhido n\u00e3o possui os valores necess\u00e1rios',
      );
    }, 0);
  };

  const importWorkingFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const previousUndoStack = getGlobalUndoBoundarySnapshot();
      await validateGlobalWorkbookFile(file);

      const response = await fetch('/api/base-workbook/import', {
        method: 'POST',
        headers: {
          'content-type':
            file.type ||
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });

      if (!response.ok) {
        throw new Error('import-failed');
      }

      const result = (await response.json()) as {
        fileName?: string;
        globalCheckpointId?: string | null;
      };
      const nextRecoveryInfo = await refreshGlobalDataState();
      window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));

      if (nextRecoveryInfo?.canRecover) {
        pushGlobalBoundaryUndoEntry(
          {
            originTab: 'aprendizes',
            kind: 'global-import',
            checkpointId: result.globalCheckpointId,
            fileName: result.fileName || file.name,
          },
          previousUndoStack,
        );
      }
    } catch {
      showInvalidImportToast();
    }
  };

  const importFromPicker = () => {
    fileInputRef.current?.click();
  };

  const exportWorkingFile = async () => {
    if (!hasWorkbook) {
      return;
    }

    try {
      const response = await fetch('/api/base-workbook/export', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('export-failed');
      }

      await refreshGlobalDataState();
    } catch {
      setInvalidImportToast('N\u00e3o foi poss\u00edvel exportar os dados.');
    }
  };

  const recoverBackup = async (checkpointId?: string | null) => {
    if (!recoveryInfo?.canRecover || isRecoveringBackup) {
      return;
    }

    setIsRecoveringBackup(true);

    try {
      const result = await recoverGlobalData(checkpointId);
      if (result.checkpointId) {
        pushGlobalUndoEntry({
          originTab: 'aprendizes',
          kind: 'global-recovery',
          checkpointId: result.checkpointId,
          restoredCheckpointId: checkpointId,
        });
      }
      await refreshGlobalDataState();
      setIsRecoveryDialogOpen(false);
    } finally {
      setIsRecoveringBackup(false);
    }
  };

  const recoveryCheckpoints =
    recoveryInfo?.checkpoints && recoveryInfo.checkpoints.length > 0
      ? recoveryInfo.checkpoints
      : recoveryInfo?.canRecover
        ? [
            {
              checkpointId: recoveryInfo.checkpointId,
              canRecover: recoveryInfo.canRecover,
              formattedUpdatedAt: recoveryInfo.formattedUpdatedAt,
            },
          ]
        : [];
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);
  const toolbarClassName = className ? `${className} global-data-toolbar` : 'global-data-toolbar';
  const recoveryDialog = isRecoveryDialogOpen ? (
    <div
      className="page-modal-backdrop"
      role="presentation"
      onMouseDown={() => setIsRecoveryDialogOpen(false)}
    >
      <div
        className="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-recovery-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="recovery-dialog-header">
          <h2 id="global-recovery-dialog-title">Recuperar Dados</h2>
          <button
            className="dialog-close-button"
            type="button"
            aria-label="Fechar"
            onClick={() => setIsRecoveryDialogOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
        <p>{getRecoveryDescription(recoveryInfo)}</p>
        <div className="recovery-checkpoint-list">
          {recoveryCheckpoints.map((checkpoint) => (
            <button
              className="primary-action recovery-confirm-action"
              type="button"
              disabled={!checkpoint.canRecover || isRecoveringBackup}
              key={checkpoint.checkpointId ?? checkpoint.formattedUpdatedAt}
              onClick={() => void recoverBackup(checkpoint.checkpointId)}
            >
              <RotateClockwiseIcon />
              {isRecoveringBackup
                ? 'Recuperando...'
                : `Recuperar dados em ${
                    checkpoint.formattedUpdatedAt || 'checkpoint'
                  }`}
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : null;
  const modalRoot =
    typeof document === 'undefined'
      ? null
      : document.querySelector('.app-shell') ?? document.body;

  return (
    <>
      <span className={toolbarClassName}>
        <button
          className="square-action"
          type="button"
          aria-label="Importar dados"
          title="Importar .xlsx"
          onClick={importFromPicker}
        >
          <ImportIcon />
        </button>
        <button
          className={hasWorkbook ? 'square-action' : 'square-action disabled'}
          type="button"
          aria-label="Exportar dados"
          title="Exportar Dados"
          disabled={!hasWorkbook}
          onClick={() => void exportWorkingFile()}
        >
          <ExportIcon />
        </button>
        <button
          className={
            canRecoverBackup
              ? 'square-action toolbar-section-start'
              : 'square-action toolbar-section-start disabled'
          }
          type="button"
          aria-label="Recuperar dados"
          title="Recuperar Dados"
          disabled={!canRecoverBackup}
          onClick={() => setIsRecoveryDialogOpen(true)}
        >
          <RotateClockwiseIcon />
        </button>
        <ThemeToggleButton className="toolbar-section-start" />
      </span>

      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => {
          void importWorkingFile(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      {invalidImportToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {invalidImportToast}
        </div>
      )}
      {recoveryDialog && modalRoot
        ? createPortal(recoveryDialog, modalRoot)
        : recoveryDialog}
    </>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function RotateClockwiseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.95 11a8 8 0 1 0 -2.2 6.95" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
