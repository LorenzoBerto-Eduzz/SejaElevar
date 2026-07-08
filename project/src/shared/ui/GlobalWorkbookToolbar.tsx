import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GLOBAL_DATA_CHANGED_EVENT,
  GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT,
  GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
} from '../data/events';
import {
  fetchBaseWorkbookFile,
  fetchRecoveryInfo,
  formatWorkbookValidationToast,
  ensureActiveWorkbookManagedSheets,
  persistManagedWorkbookDataIndexes,
  prepareManagedWorkbookFile,
  recoverGlobalData,
  type RecoveryInfo,
  validateGlobalWorkbookFile,
} from '../data/workspaceData';
import {
  getGlobalUndoBoundarySnapshot,
  pushGlobalBoundaryUndoEntry,
  pushGlobalUndoEntry,
} from '../undo/globalUndo';
import { ThemeToggleButton } from './ThemeToggleButton';
import { useTimedToast } from './useTimedToast';

type GlobalToolbarState = {
  hasWorkbook: boolean;
  recoveryInfo: RecoveryInfo | null;
  hasLoaded: boolean;
};

let latestGlobalToolbarState: GlobalToolbarState = {
  hasWorkbook: false,
  recoveryInfo: null,
  hasLoaded: false,
};
let globalToolbarRefreshId = 0;
let preserveActiveToolbarUntil = 0;
let recoveryUnavailableConfirmationCount = 0;
const globalToolbarStateListeners = new Set<() => void>();

const setLatestGlobalToolbarState = (state: GlobalToolbarState) => {
  latestGlobalToolbarState = state;
  globalToolbarStateListeners.forEach((listener) => listener());
};

const preserveActiveToolbarState = (milliseconds = 1500) => {
  preserveActiveToolbarUntil = Math.max(
    preserveActiveToolbarUntil,
    Date.now() + milliseconds,
  );
};

const shouldPreserveActiveToolbarState = () =>
  Date.now() < preserveActiveToolbarUntil;

const subscribeToGlobalToolbarState = (listener: () => void) => {
  globalToolbarStateListeners.add(listener);
  return () => {
    globalToolbarStateListeners.delete(listener);
  };
};

const normalizeRecoveryInfoForToolbar = (
  info: RecoveryInfo | null | undefined,
) => {
  if (!info) {
    return null;
  }

  const checkpoints =
    info.checkpoints?.map((checkpoint) => {
      const hasWorkbookCheckpoint = (checkpoint.fileCount ?? 0) > 0;

      return {
        ...checkpoint,
        canRecover: checkpoint.canRecover || hasWorkbookCheckpoint,
      };
    }) ?? [];
  const canRecover =
    info.canRecover ||
    checkpoints.some((checkpoint) => checkpoint.canRecover) ||
    ((info.fileCount ?? 0) > 0 && Boolean(info.checkpointId));

  return {
    ...info,
    canRecover,
    checkpoints: checkpoints.length > 0 ? checkpoints : info.checkpoints,
  };
};

const hasRecoverableCheckpoint = (info: RecoveryInfo | null | undefined) =>
  Boolean(info?.canRecover);

const chooseStableRecoveryInfo = (
  fetchedInfo: RecoveryInfo | null | undefined,
  hasActiveWorkbook: boolean,
) => {
  const normalizedInfo = normalizeRecoveryInfoForToolbar(fetchedInfo);
  const previousInfo = latestGlobalToolbarState.recoveryInfo;

  if (hasRecoverableCheckpoint(normalizedInfo)) {
    recoveryUnavailableConfirmationCount = 0;
    return normalizedInfo;
  }

  if (
    hasActiveWorkbook &&
    hasRecoverableCheckpoint(previousInfo) &&
    (shouldPreserveActiveToolbarState() ||
      recoveryUnavailableConfirmationCount < 2)
  ) {
    recoveryUnavailableConfirmationCount += 1;
    return previousInfo;
  }

  recoveryUnavailableConfirmationCount = 0;
  return normalizedInfo;
};

export const useGlobalWorkbookState = () => {
  const [state, setState] = useState(latestGlobalToolbarState);

  useEffect(
    () =>
      subscribeToGlobalToolbarState(() => {
        setState(latestGlobalToolbarState);
      }),
    [],
  );

  return state;
};

export const markGlobalWorkbookAvailable = (
  recoveryInfo?: RecoveryInfo | null,
) => {
  setLatestGlobalToolbarState({
    hasWorkbook: true,
    recoveryInfo: normalizeRecoveryInfoForToolbar(
      recoveryInfo ?? latestGlobalToolbarState.recoveryInfo,
    ),
    hasLoaded: true,
  });
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
    case 'before_migration':
      return 'Recupere os dados para como estavam antes da \u00faltima atualiza\u00e7\u00e3o de estrutura.';
    case 'import_original':
      return 'Recupere os dados para como estavam quando o arquivo foi importado.';
    case 'before_recovery':
    case 'after_recovery':
      return 'Recupere os dados para como estavam antes da \u00faltima recupera\u00e7\u00e3o.';
    default:
      return 'Nenhum backup dispon\u00edvel para recuperar.';
  }
};

type GlobalWorkbookToolbarProps = {
  className?: string;
  includeThemeToggle?: boolean;
  listenForImportRequests?: boolean;
};

export function GlobalWorkbookToolbar({
  className = '',
  includeThemeToggle = true,
  listenForImportRequests = true,
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
  const {
    clearToast: clearInvalidImportToast,
    message: invalidImportToast,
    showToast: showInvalidImportToastMessage,
  } = useTimedToast();

  const refreshGlobalDataState = async () => {
    const refreshId = ++globalToolbarRefreshId;
    const [fileResponse, fetchedRecoveryInfo] = await Promise.all([
      fetch('/api/base-workbook/file', {
        cache: 'no-store',
      }).catch(() => null),
      fetchRecoveryInfo()
        .then(normalizeRecoveryInfoForToolbar)
        .catch(() => latestGlobalToolbarState.recoveryInfo),
    ]);
    const nextHasWorkbook =
      fileResponse === null
        ? latestGlobalToolbarState.hasWorkbook
        : fileResponse.ok || latestGlobalToolbarState.hasWorkbook;
    const nextRecoveryInfo = chooseStableRecoveryInfo(
      fetchedRecoveryInfo,
      nextHasWorkbook,
    );

    if (nextHasWorkbook) {
      await ensureActiveWorkbookManagedSheets().catch(() => false);
    } else {
      void persistManagedWorkbookDataIndexes(null);
    }

    const nextState = {
      hasWorkbook: nextHasWorkbook,
      recoveryInfo: nextRecoveryInfo,
      hasLoaded: true,
    };

    if (refreshId !== globalToolbarRefreshId) {
      setHasWorkbook(latestGlobalToolbarState.hasWorkbook);
      setRecoveryInfo(latestGlobalToolbarState.recoveryInfo);
      return latestGlobalToolbarState.recoveryInfo;
    }

    setLatestGlobalToolbarState(nextState);
    setHasWorkbook(nextState.hasWorkbook);
    setRecoveryInfo(nextState.recoveryInfo);
    return nextRecoveryInfo;
  };

  useEffect(() => {
    const unsubscribe = subscribeToGlobalToolbarState(() => {
      setHasWorkbook(latestGlobalToolbarState.hasWorkbook);
      setRecoveryInfo(latestGlobalToolbarState.recoveryInfo);
    });

    if (!latestGlobalToolbarState.hasLoaded) {
      void refreshGlobalDataState();
    }

    const handleGlobalDataChanged = () => {
      void refreshGlobalDataState();
    };
    const handleGlobalToolbarRefreshRequested = () => {
      preserveActiveToolbarState(2500);
      void refreshGlobalDataState();
      window.setTimeout(() => void refreshGlobalDataState(), 150);
      window.setTimeout(() => void refreshGlobalDataState(), 600);
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
      GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT,
      handleGlobalToolbarRefreshRequested,
    );
    if (listenForImportRequests) {
      window.addEventListener(
        GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
        handleImportRequest,
      );
    }

    return () => {
      window.removeEventListener(
        GLOBAL_DATA_CHANGED_EVENT,
        handleGlobalDataChanged,
      );
      window.removeEventListener(
        GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT,
        handleGlobalToolbarRefreshRequested,
      );
      if (listenForImportRequests) {
        window.removeEventListener(
          GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
          handleImportRequest,
        );
      }
      unsubscribe();
    };
  }, []);

  const showInvalidImportToast = (message?: string) => {
    showInvalidImportToastMessage(
      message || 'Arquivo escolhido n\u00e3o possui os valores necess\u00e1rios',
    );
  };

  const importWorkingFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    let importSucceeded = false;
    let previousUndoStack: ReturnType<typeof getGlobalUndoBoundarySnapshot> = [];
    let result: {
      fileName?: string;
      globalCheckpointId?: string | null;
    } = {};
    let importedWorkbookFile: File | null = null;

    try {
      previousUndoStack = getGlobalUndoBoundarySnapshot();
      await validateGlobalWorkbookFile(file);
      const preparedWorkbook = await prepareManagedWorkbookFile(file);
      const fileBuffer = preparedWorkbook.buffer;

      const response = await fetch('/api/base-workbook/import', {
        method: 'POST',
        headers: {
          'content-type':
            file.type ||
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: fileBuffer,
      });

      if (!response.ok) {
        throw new Error('import-failed');
      }

      result = (await response.json()) as {
        fileName?: string;
        globalCheckpointId?: string | null;
      };
      importedWorkbookFile = new File(
        [fileBuffer.slice(0)],
        result.fileName || file.name,
        {
          type:
            file.type ||
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      );
      await persistManagedWorkbookDataIndexes(importedWorkbookFile);
      importSucceeded = true;
    } catch (error) {
      showInvalidImportToast(formatWorkbookValidationToast(error));
      return;
    }

    try {
      const nextRecoveryInfo = await refreshGlobalDataState();

      window.dispatchEvent(
        new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
          detail: {
            file: importedWorkbookFile,
            fileName: result.fileName || file.name,
          },
        }),
      );

      if (!nextRecoveryInfo?.canRecover) {
        return;
      }

      pushGlobalBoundaryUndoEntry(
        {
          originTab: 'aprendizes',
          kind: 'global-import',
          checkpointId: result.globalCheckpointId,
          fileName: result.fileName || file.name,
        },
        previousUndoStack,
      );
    } catch {
      if (!importSucceeded) {
        showInvalidImportToast('Não foi possível confirmar a importação.');
      }
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
      clearInvalidImportToast();
      const response = await fetch('/api/base-workbook/export', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('export-failed');
      }

      await refreshGlobalDataState();
    } catch {
      showInvalidImportToast('N\u00e3o foi poss\u00edvel exportar os dados.');
    }
  };

  const recoverBackup = async (checkpointId?: string | null) => {
    if (!recoveryInfo?.canRecover || isRecoveringBackup) {
      return;
    }

    const recoveredCheckpoint = recoveryCheckpoints.find((checkpoint) =>
      checkpointId
        ? checkpoint.checkpointId === checkpointId
        : checkpoint === latestRecoveryCheckpoint,
    );

    preserveActiveToolbarState();
    setIsRecoveringBackup(true);

    try {
      const result = await recoverGlobalData(checkpointId);
      if (typeof result.hasWorkbook === 'boolean' || result.recoveryInfo) {
        const nextState = {
          hasWorkbook:
            typeof result.hasWorkbook === 'boolean'
              ? result.hasWorkbook
              : latestGlobalToolbarState.hasWorkbook,
          recoveryInfo:
            normalizeRecoveryInfoForToolbar(result.recoveryInfo) ??
            latestGlobalToolbarState.recoveryInfo,
          hasLoaded: true,
        };

        setLatestGlobalToolbarState(nextState);
        setHasWorkbook(nextState.hasWorkbook);
        setRecoveryInfo(nextState.recoveryInfo);
      }

      await ensureActiveWorkbookManagedSheets().catch(() => false);
      const recoveredFile = await fetchBaseWorkbookFile().catch(() => null);
      await persistManagedWorkbookDataIndexes(recoveredFile);
      window.dispatchEvent(
        new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
          detail: {
            file: recoveredFile,
            reason: 'recovery',
            force: true,
          },
        }),
      );
      if (result.checkpointId) {
        pushGlobalUndoEntry({
          originTab: 'aprendizes',
          kind: 'global-recovery',
          checkpointId: result.checkpointId,
          recoveredAtLabel: recoveredCheckpoint?.formattedUpdatedAt,
          restoredCheckpointId: checkpointId,
        });
      }
      window.setTimeout(() => void refreshGlobalDataState(), 100);
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
  const latestRecoveryCheckpoint = recoveryCheckpoints[0] ?? null;
  const olderRecoveryCheckpoints = recoveryCheckpoints.slice(1);
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
        {latestRecoveryCheckpoint ? (
          <p>{getRecoveryDescription(recoveryInfo)}</p>
        ) : null}
        <div className="recovery-checkpoint-list">
          {latestRecoveryCheckpoint ? (
            <button
              className="primary-action recovery-confirm-action"
              type="button"
              disabled={!latestRecoveryCheckpoint.canRecover || isRecoveringBackup}
              onClick={() =>
                void recoverBackup(latestRecoveryCheckpoint.checkpointId)
              }
            >
              <RotateClockwiseIcon />
              {isRecoveringBackup
                ? 'Recuperando...'
                : `Recuperar dados em ${
                    latestRecoveryCheckpoint.formattedUpdatedAt || 'checkpoint'
                  }`}
            </button>
          ) : null}
          {olderRecoveryCheckpoints.length > 0 ? (
            <>
              <span className="recovery-other-backups-label">
                Outros backups:
              </span>
              {olderRecoveryCheckpoints.map((checkpoint) => (
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
            </>
          ) : null}
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
              ? 'square-action'
              : 'square-action disabled'
          }
          type="button"
          aria-label="Recuperar dados"
          title="Recuperar Dados"
          disabled={!canRecoverBackup}
          onClick={() => setIsRecoveryDialogOpen(true)}
        >
          <RotateClockwiseIcon />
        </button>
        {includeThemeToggle && <ThemeToggleButton />}
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
