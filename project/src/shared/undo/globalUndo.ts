import type { AppTab } from '../navigation/tabs';

export type GlobalUndoEntry = {
  originTab: AppTab;
  kind: string;
  [key: string]: unknown;
};

type GlobalUndoController = {
  beforeUndo?: () => void;
  undo: (entry: GlobalUndoEntry) => boolean | Promise<boolean>;
};

const GLOBAL_UNDO_LIMIT = 1000;
const GLOBAL_BOUNDARY_UNDO_KINDS = new Set(['global-import', 'global-recovery']);

let undoStack: GlobalUndoEntry[] = [];
const controllers = new Map<AppTab, GlobalUndoController>();
let getActiveTab: () => AppTab = () => 'aprendizes';
let focusTab: (tab: AppTab) => void = () => {};
let isRunningUndo = false;

export const configureGlobalUndoNavigation = (
  activeTabGetter: () => AppTab,
  tabFocusHandler: (tab: AppTab) => void,
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

  if (GLOBAL_BOUNDARY_UNDO_KINDS.has(undoStack.at(-1)?.kind ?? '')) {
    undoStack = [];
  }

  undoStack = [...undoStack, entry].slice(-GLOBAL_UNDO_LIMIT);
};

export const getGlobalUndoBoundarySnapshot = () => {
  if (GLOBAL_BOUNDARY_UNDO_KINDS.has(undoStack.at(-1)?.kind ?? '')) {
    return [];
  }

  return undoStack.slice();
};

export const pushGlobalBoundaryUndoEntry = (
  entry: GlobalUndoEntry,
  previousUndoStack: GlobalUndoEntry[],
) => {
  if (isRunningUndo) {
    return;
  }

  undoStack = [
    {
      ...entry,
      previousUndoStack: previousUndoStack.slice(-GLOBAL_UNDO_LIMIT),
    },
  ];
};

export const replaceGlobalUndoStack = (entries: GlobalUndoEntry[]) => {
  undoStack = entries.slice(-GLOBAL_UNDO_LIMIT);
};

const isUndoShortcut = ({
  ctrlKey,
  key,
  metaKey,
  shiftKey,
}: Pick<KeyboardEvent, 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>) =>
  (ctrlKey || metaKey) && !shiftKey && key.toLowerCase() === 'z';

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
  focusTab(undoEntry.originTab);
  isRunningUndo = true;

  try {
    return Boolean(await controllers.get(undoEntry.originTab)?.undo(undoEntry));
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
  if (event.defaultPrevented || !isUndoShortcut(event)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent?.stopImmediatePropagation?.();
  void runGlobalUndo();
  return true;
};
