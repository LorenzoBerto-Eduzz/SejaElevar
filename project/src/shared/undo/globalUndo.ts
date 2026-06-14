import {
  recordActionHistoryCut,
  recordActionHistoryLine,
  setActionHistoryLinesState,
} from '../actionLog/actionLog';
import type { AppTab } from '../navigation/tabs';

export type GlobalUndoEntry = {
  originTab: AppTab;
  kind: string;
  __historyId?: number;
  __historyIds?: number[];
  __sessionId?: string;
  [key: string]: unknown;
};

type GlobalUndoController = {
  beforeUndo?: () => void;
  undo: (entry: GlobalUndoEntry) => boolean | Promise<boolean>;
  redo?: (entry: GlobalUndoEntry) => boolean | Promise<boolean>;
};

const GLOBAL_UNDO_LIMIT = 200;
const GLOBAL_UNDO_STORAGE_KEY = 'sejaelevar.globalUndo.v1';
const currentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let undoStack: GlobalUndoEntry[] = [];
let redoStack: GlobalUndoEntry[] = [];
const controllers = new Map<AppTab, GlobalUndoController>();
let getActiveTab: () => AppTab = () => 'aprendizes';
let focusTab: (tab: AppTab) => void | Promise<void> = () => {};
let isRunningUndo = false;

const canUseStorage = () =>
  typeof window !== 'undefined' && Boolean(window.localStorage);

const normalizeStoredStack = (value: unknown): GlobalUndoEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is GlobalUndoEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as GlobalUndoEntry).originTab === 'string' &&
        typeof (entry as GlobalUndoEntry).kind === 'string',
    )
    .slice(-GLOBAL_UNDO_LIMIT);
};

const saveGlobalUndoStacks = () => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    GLOBAL_UNDO_STORAGE_KEY,
    JSON.stringify({
      undoStack: undoStack.slice(-GLOBAL_UNDO_LIMIT),
      redoStack: redoStack.slice(-GLOBAL_UNDO_LIMIT),
    }),
  );
};

const loadGlobalUndoStacks = () => {
  if (!canUseStorage()) {
    return;
  }

  try {
    const savedState = JSON.parse(
      window.localStorage.getItem(GLOBAL_UNDO_STORAGE_KEY) || '{}',
    ) as { undoStack?: unknown; redoStack?: unknown };

    undoStack = normalizeStoredStack(savedState.undoStack);
    redoStack = normalizeStoredStack(savedState.redoStack);
  } catch {
    window.localStorage.removeItem(GLOBAL_UNDO_STORAGE_KEY);
    undoStack = [];
    redoStack = [];
  }
};

const remapCheckpointReference = (
  entry: GlobalUndoEntry,
  previousCheckpointId: string,
  nextCheckpointId: string,
) => {
  if (entry.checkpointId === previousCheckpointId) {
    entry.checkpointId = nextCheckpointId;
  }

  if (entry.redoCheckpointId === previousCheckpointId) {
    entry.redoCheckpointId = nextCheckpointId;
  }

  if (entry.restoredCheckpointId === previousCheckpointId) {
    entry.restoredCheckpointId = nextCheckpointId;
  }

  if (Array.isArray(entry.previousUndoStack)) {
    entry.previousUndoStack = (entry.previousUndoStack as GlobalUndoEntry[]).map(
      (nestedEntry) => ({
        ...nestedEntry,
      }),
    );
    (entry.previousUndoStack as GlobalUndoEntry[]).forEach((nestedEntry) =>
      remapCheckpointReference(nestedEntry, previousCheckpointId, nextCheckpointId),
    );
  }
};

export const remapGlobalUndoCheckpointReferences = (
  previousCheckpointId: unknown,
  nextCheckpointId: unknown,
) => {
  if (
    typeof previousCheckpointId !== 'string' ||
    typeof nextCheckpointId !== 'string' ||
    !previousCheckpointId ||
    !nextCheckpointId ||
    previousCheckpointId === nextCheckpointId
  ) {
    return;
  }

  undoStack = undoStack.map((entry) => ({ ...entry }));
  redoStack = redoStack.map((entry) => ({ ...entry }));
  undoStack.forEach((entry) =>
    remapCheckpointReference(entry, previousCheckpointId, nextCheckpointId),
  );
  redoStack.forEach((entry) =>
    remapCheckpointReference(entry, previousCheckpointId, nextCheckpointId),
  );
  saveGlobalUndoStacks();
};

const waitForFrames = (frameCount: number) =>
  new Promise<void>((resolve) => {
    const waitNextFrame = (remainingFrames: number) => {
      if (remainingFrames <= 0) {
        resolve();
        return;
      }

      window.requestAnimationFrame(() => waitNextFrame(remainingFrames - 1));
    };

    waitNextFrame(frameCount);
  });

const tabLabels: Record<AppTab, string> = {
  aprendizes: 'Aprendizes',
  turmas: 'Turmas',
  aulas: 'Aulas',
  arcos: 'Arcos',
  empresas: 'Empresas',
  calendario: 'Calendário',
  documentos: 'Documentos',
};

const stringifyActionValue = (value: unknown) => String(value ?? '').trim();

const describeHistoryPrefix = (entry: GlobalUndoEntry) => {
  const tabLabel = tabLabels[entry.originTab] ?? entry.originTab;

  return `${tabLabel} |`;
};

const getEntryItemRef = (entry: GlobalUndoEntry) =>
  stringifyActionValue(entry.itemRef) ||
  stringifyActionValue(entry.recordId) ||
  stringifyActionValue(entry.itemLabel) ||
  '';

const describeChangedValue = (entry: GlobalUndoEntry) => {
  const columnName = stringifyActionValue(entry.columnName) || 'valor';
  const previousValue = stringifyActionValue(entry.previousValue) || 'vazio';
  const nextValue = stringifyActionValue(entry.nextValue) || 'vazio';

  return `${columnName}: "${previousValue}" -> "${nextValue}"`;
};

const describeGlobalUndoEntry = (entry: GlobalUndoEntry) => {
  const prefix = describeHistoryPrefix(entry);
  const itemRef = getEntryItemRef(entry);
  const itemPart = itemRef ? ` | ${itemRef}` : '';

  if (entry.kind === 'cell-edit') {
    return `${prefix} editado${itemPart} | ${describeChangedValue(entry)}`;
  }

  if (entry.kind === 'row-insert') {
    return `${prefix} cadastrado${itemPart}`;
  }

  if (entry.kind === 'row-delete') {
    return `${prefix} descadastrado${itemPart}`;
  }

  if (entry.kind === 'registration-draft-edit') {
    return `${prefix} preenchido${itemPart} | ${describeChangedValue(entry)}`;
  }

  if (entry.kind === 'global-import') {
    const fileName = stringifyActionValue(entry.fileName);
    return `Dados | importado${fileName ? ` | ${fileName}` : ''}`;
  }

  if (entry.kind === 'global-recovery') {
    return 'Dados | recuperado';
  }

  return `${prefix} ação`;
};

const getEntryHistoryIds = (entry: GlobalUndoEntry) => {
  const ids = Array.isArray(entry.__historyIds)
    ? entry.__historyIds.filter((id): id is number => typeof id === 'number')
    : [];

  if (typeof entry.__historyId === 'number' && !ids.includes(entry.__historyId)) {
    ids.push(entry.__historyId);
  }

  return ids;
};

const clearRedoPathForNewAction = () => {
  if (redoStack.length === 0) {
    return;
  }

  setActionHistoryLinesState(
    redoStack.flatMap(getEntryHistoryIds),
    'discarded',
  );
  recordActionHistoryCut(
    'Refazer descartado: nova a\u00e7\u00e3o substituiu o caminho anterior.',
  );
  redoStack = [];
};

const withHistoryLine = (entry: GlobalUndoEntry) => {
  const historyId = recordActionHistoryLine(describeGlobalUndoEntry(entry));

  return {
    ...entry,
    __sessionId: currentSessionId,
    __historyId: historyId,
    __historyIds: [historyId],
  };
};

loadGlobalUndoStacks();

export const configureGlobalUndoNavigation = (
  activeTabGetter: () => AppTab,
  tabFocusHandler: (tab: AppTab) => void | Promise<void>,
) => {
  getActiveTab = activeTabGetter;
  focusTab = tabFocusHandler;
};

export const registerGlobalUndoController = (
  tab: AppTab,
  controller: GlobalUndoController,
) => {
  controllers.set(tab, controller);

  return () => {
    if (controllers.get(tab) === controller) {
      controllers.delete(tab);
    }
  };
};

export const pushGlobalUndoEntry = (entry: GlobalUndoEntry) => {
  if (isRunningUndo) {
    return;
  }

  clearRedoPathForNewAction();
  undoStack = [...undoStack, withHistoryLine(entry)].slice(-GLOBAL_UNDO_LIMIT);
  saveGlobalUndoStacks();
};

export const getGlobalUndoBoundarySnapshot = () => {
  return undoStack.slice();
};

export const pushGlobalBoundaryUndoEntry = (
  entry: GlobalUndoEntry,
  previousUndoStack: GlobalUndoEntry[],
) => {
  if (isRunningUndo) {
    return;
  }

  const lastUndoEntry = undoStack.at(-1);

  if (
    entry.kind === 'global-import' &&
    lastUndoEntry?.kind === 'global-import' &&
    lastUndoEntry.checkpointId === entry.checkpointId &&
    lastUndoEntry.__sessionId === currentSessionId
  ) {
    clearRedoPathForNewAction();
    const historyId = recordActionHistoryLine(describeGlobalUndoEntry(entry));

    undoStack = [
      ...undoStack.slice(0, -1),
      {
        ...lastUndoEntry,
        ...entry,
        __historyId: historyId,
        __historyIds: [...getEntryHistoryIds(lastUndoEntry), historyId],
        __sessionId: currentSessionId,
        previousUndoStack: lastUndoEntry.previousUndoStack,
      },
    ].slice(-GLOBAL_UNDO_LIMIT);
    saveGlobalUndoStacks();
    return;
  }

  clearRedoPathForNewAction();
  const historyEntry = withHistoryLine(entry);

  undoStack = [
    ...undoStack,
    {
      ...historyEntry,
      previousUndoStack: previousUndoStack.slice(-GLOBAL_UNDO_LIMIT),
    },
  ].slice(-GLOBAL_UNDO_LIMIT);
  saveGlobalUndoStacks();
};

export const replaceGlobalUndoStack = (entries: GlobalUndoEntry[]) => {
  undoStack = entries.slice(-GLOBAL_UNDO_LIMIT);
  saveGlobalUndoStacks();
};

export const resetGlobalUndoHistory = () => {
  undoStack = [];
  redoStack = [];

  if (canUseStorage()) {
    window.localStorage.removeItem(GLOBAL_UNDO_STORAGE_KEY);
  }
};

export const isGlobalUndoInProgress = () => isRunningUndo;

const isUndoShortcut = ({
  ctrlKey,
  key,
  metaKey,
  shiftKey,
}: Pick<KeyboardEvent, 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>) =>
  (ctrlKey || metaKey) && !shiftKey && key.toLowerCase() === 'z';

const isRedoShortcut = ({
  ctrlKey,
  key,
  metaKey,
  shiftKey,
}: Pick<KeyboardEvent, 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>) =>
  (ctrlKey || metaKey) &&
  ((key.toLowerCase() === 'y' && !shiftKey) ||
    (key.toLowerCase() === 'z' && shiftKey));

const runHistoryEntry = async (
  entry: GlobalUndoEntry,
  direction: 'undo' | 'redo',
) => {
  const didSwitchTabs = getActiveTab() !== entry.originTab;

  if (getActiveTab() !== entry.originTab) {
    await focusTab(entry.originTab);
    await waitForFrames(2);
  }

  let didRun = false;
  const maximumAttempts = didSwitchTabs ? 8 : 1;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const controller = controllers.get(entry.originTab);
    const handler = direction === 'undo' ? controller?.undo : controller?.redo;

    if (handler) {
      didRun = Boolean(await handler(entry));
    }

    if (didRun) {
      break;
    }

    if (attempt < maximumAttempts - 1) {
      await waitForFrames(2);
    }
  }

  return didRun;
};

export const runGlobalUndo = async () => {
  if (isRunningUndo) {
    return false;
  }

  controllers.get(getActiveTab())?.beforeUndo?.();

  const undoEntry = undoStack.at(-1);

  if (!undoEntry) {
    return false;
  }

  undoStack = undoStack.slice(0, -1);
  isRunningUndo = true;

  try {
    const didUndo = await runHistoryEntry(undoEntry, 'undo');

    if (!didUndo) {
      undoStack = [...undoStack, undoEntry].slice(-GLOBAL_UNDO_LIMIT);
    } else {
      redoStack = [...redoStack, undoEntry].slice(-GLOBAL_UNDO_LIMIT);
      setActionHistoryLinesState(getEntryHistoryIds(undoEntry), 'undone');
    }

    saveGlobalUndoStacks();
    return didUndo;
  } finally {
    isRunningUndo = false;
  }
};

export const runGlobalRedo = async () => {
  if (isRunningUndo) {
    return false;
  }

  const redoEntry = redoStack.at(-1);

  if (!redoEntry) {
    return false;
  }

  redoStack = redoStack.slice(0, -1);
  isRunningUndo = true;

  try {
    const didRedo = await runHistoryEntry(redoEntry, 'redo');

    if (!didRedo) {
      redoStack = [...redoStack, redoEntry].slice(-GLOBAL_UNDO_LIMIT);
    } else {
      undoStack = [...undoStack, redoEntry].slice(-GLOBAL_UNDO_LIMIT);
      setActionHistoryLinesState(getEntryHistoryIds(redoEntry), 'done');
    }

    saveGlobalUndoStacks();
    return didRedo;
  } finally {
    isRunningUndo = false;
  }
};

export const handleGlobalUndoShortcut = (
  event: Pick<
    KeyboardEvent,
    | 'ctrlKey'
    | 'defaultPrevented'
    | 'key'
    | 'metaKey'
    | 'preventDefault'
    | 'shiftKey'
    | 'stopPropagation'
  > & { nativeEvent?: { stopImmediatePropagation?: () => void } },
) => {
  if (event.defaultPrevented) {
    return false;
  }

  const shouldRedo = isRedoShortcut(event);
  const shouldUndo = !shouldRedo && isUndoShortcut(event);

  if (!shouldUndo && !shouldRedo) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent?.stopImmediatePropagation?.();

  if (shouldRedo) {
    void runGlobalRedo();
  } else {
    void runGlobalUndo();
  }

  return true;
};
