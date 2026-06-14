export type ActionLogLineState = 'done' | 'undone' | 'discarded' | 'cut';

export type ActionLogEntry = {
  id: number;
  message: string;
  state: ActionLogLineState;
};

declare global {
  interface Window {
    SEJAELEVAR_RELEASE?: boolean;
  }
}

type ActionLogListener = (entries: ActionLogEntry[]) => void;

const ACTION_HISTORY_STORAGE_KEY = 'sejaelevar.dev.actionHistory.v1';
const ACTION_HISTORY_LIMIT = 200;
const actionLogListeners = new Set<ActionLogListener>();
let nextActionLogId = 1;
let actionLogEntries: ActionLogEntry[] = [];

const canUseStorage = () =>
  typeof window !== 'undefined' && Boolean(window.localStorage);

const saveActionLogEntries = () => {
  if (!canUseStorage() || window.SEJAELEVAR_RELEASE) {
    return;
  }

  window.localStorage.setItem(
    ACTION_HISTORY_STORAGE_KEY,
    JSON.stringify(actionLogEntries),
  );
};

const notifyActionLogListeners = () => {
  const snapshot = actionLogEntries.slice();
  actionLogListeners.forEach((listener) => listener(snapshot));
  saveActionLogEntries();
};

const appendActionLogEntry = (
  entry: Omit<ActionLogEntry, 'id'>,
  options: { persist?: boolean } = {},
) => {
  const nextEntry = {
    id: nextActionLogId,
    ...entry,
  };

  nextActionLogId += 1;
  actionLogEntries = [nextEntry, ...actionLogEntries];

  if (actionLogEntries.length > ACTION_HISTORY_LIMIT) {
    actionLogEntries = [
      {
        id: nextActionLogId,
        message:
          'Limite de 200 ações atingido; o histórico mais antigo foi descartado.',
        state: 'cut',
      },
      ...actionLogEntries.slice(0, ACTION_HISTORY_LIMIT - 1),
    ];
    nextActionLogId += 1;
  }

  if (options.persist !== false) {
    notifyActionLogListeners();
  }

  return nextEntry.id;
};

const loadPreviousActionLogEntries = () => {
  if (!canUseStorage() || window.SEJAELEVAR_RELEASE) {
    return;
  }

  try {
    const savedEntries = JSON.parse(
      window.localStorage.getItem(ACTION_HISTORY_STORAGE_KEY) || '[]',
    ) as ActionLogEntry[];

    if (!Array.isArray(savedEntries) || savedEntries.length === 0) {
      return;
    }

    actionLogEntries = savedEntries.slice(0, ACTION_HISTORY_LIMIT);
    nextActionLogId =
      Math.max(...actionLogEntries.map((entry) => entry.id).filter(Number.isFinite), 0) +
      1;
    saveActionLogEntries();
  } catch {
    window.localStorage.removeItem(ACTION_HISTORY_STORAGE_KEY);
  }
};

loadPreviousActionLogEntries();

export const recordActionHistoryLine = (message: string) => {
  return appendActionLogEntry({
    message,
    state: 'done',
  });
};

export const recordActionHistoryCut = (message: string) => {
  return appendActionLogEntry({
    message,
    state: 'cut',
  });
};

export const setActionHistoryLineState = (
  id: unknown,
  state: ActionLogLineState,
) => {
  if (typeof id !== 'number') {
    return;
  }

  actionLogEntries = actionLogEntries.map((entry) =>
    entry.id === id ? { ...entry, state } : entry,
  );
  notifyActionLogListeners();
};

export const setActionHistoryLinesState = (
  ids: unknown[],
  state: ActionLogLineState,
) => {
  const numericIds = new Set(ids.filter((id): id is number => typeof id === 'number'));

  if (numericIds.size === 0) {
    return;
  }

  actionLogEntries = actionLogEntries.map((entry) =>
    numericIds.has(entry.id) ? { ...entry, state } : entry,
  );
  notifyActionLogListeners();
};

export const subscribeActionLog = (listener: ActionLogListener) => {
  actionLogListeners.add(listener);
  listener(actionLogEntries.slice());

  return () => {
    actionLogListeners.delete(listener);
  };
};

export const resetActionHistory = () => {
  actionLogEntries = [];
  nextActionLogId = 1;

  if (canUseStorage()) {
    window.localStorage.removeItem(ACTION_HISTORY_STORAGE_KEY);
  }

  notifyActionLogListeners();
};
