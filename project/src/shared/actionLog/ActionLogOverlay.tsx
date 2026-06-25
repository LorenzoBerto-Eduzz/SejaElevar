import { useEffect, useRef, useState } from 'react';
import { subscribeActionLog, type ActionLogEntry } from './actionLog';

export const TOGGLE_ACTION_HISTORY_EVENT =
  'sejaelevar:toggle-action-history';

export function ActionLogOverlay() {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.SEJAELEVAR_RELEASE) {
      return;
    }

    return subscribeActionLog(setEntries);
  }, []);

  useEffect(() => {
    if (window.SEJAELEVAR_RELEASE) {
      return;
    }

    const toggleHistory = () => {
      setIsOpen((currentIsOpen) => !currentIsOpen);
    };

    window.addEventListener(TOGGLE_ACTION_HISTORY_EVENT, toggleHistory);

    return () =>
      window.removeEventListener(TOGGLE_ACTION_HISTORY_EVENT, toggleHistory);
  }, []);

  if (window.SEJAELEVAR_RELEASE) {
    return null;
  }

  return (
    <>
      {isOpen && (
        <aside
          className="action-history-panel"
          aria-label={"Hist\u00f3rico de a\u00e7\u00f5es"}
        >
          <div className="action-history-list" ref={listRef}>
            {entries.length === 0 ? (
              <div className="action-history-line action-history-empty cut">
                <span>{"Nenhuma a\u00e7\u00e3o registrada nesta sess\u00e3o."}</span>
              </div>
            ) : (
              entries.map((entry) => (
                <div
                  className={`action-history-line ${entry.state}`}
                  key={entry.id}
                >
                  <span>{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </>
  );
}
