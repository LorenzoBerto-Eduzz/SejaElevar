import {
  recordActionHistoryCut,
  recordActionHistoryLine,
  setActionHistoryLineState,
} from '../actionLog/actionLog';
import type { AppTab } from '../navigation/tabs';

export type GlobalUndoEntry = {
  originTab: AppTab;
  kind: string;
  __historyId?: number;
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
  disciplinas: 'Disciplinas',
  arcos: 'Arcos',
  funcionarios: 'Funcionários',
  empresas: 'Empresas',
  salas: 'Salas',
  calendario: 'Calendário',
  documentos: 'Documentos',
};

const stringifyActionValue = (value: unknown) => String(value ?? '').trim();

const describeChangedValue = (entry: GlobalUndoEntry) => {
  const columnName = stringifyActionValue(entry.columnName) || 'valor';
  const previousValue = stringifyActionValue(entry.previousValue) || 'vazio';
  const nextValue = stringifyActionValue(entry.nextValue) || 'vazio';

  return `${columnName}: "${previousValue}" -> "${nextValue}"`;
};

const describeGlobalUndoEntry = (entry: GlobalUndoEntry) => {
  const tabLabel = tabLabels[entry.originTab] ?? entry.originTab;

  if (entry.kind === 'cell-edit') {
    return `${tabLabel}: editado ${describeChangedValue(entry)}.`;
  }

  if (entry.kind === 'row-insert') {
    return `${tabLabel}: linha cadastrada.`;
  }

  if (entry.kind === 'row-delete') {
    return `${tabLabel}: linha descadastrada.`;
  }

  if (entry.kind === 'registration-draft-edit') {
    return `${tabLabel}: preenchimento de cadastro detectado.`;
  }

  if (entry.kind === 'global-import') {
    return `${tabLabel}: planilha importada.`;
  }

  if (entry.kind === 'global-recovery') {
    return `${tabLabel}: dados recuperados.`;
  }

  return `${tabLabel}: ação detectada.`;
};

const clearRedoPathForNewAction = () => {
  if (redoStack.length === 0) {
    return;
  }

  redoStack = [];
  recordActionHistoryCut('Nova ação detectada; o caminho de refazer foi descartado.');
};

const withHistoryLine = (entry: GlobalUndoEntry) => ({
  ...entry,
  __sessionId: currentSessionId,
  __historyId: recordActionHistoryLine(describeGlobalUndoEntry(entry)),
});

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
    undoStack = [
      ...undoStack.slice(0, -1),
      {
        ...lastUndoEntry,
        ...entry,
        __historyId: lastUndoEntry.__historyId,
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
      setActionHistoryLineState(undoEntry.__historyId, 'undone');
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
      setActionHistoryLineState(redoEntry.__historyId, 'done');
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
