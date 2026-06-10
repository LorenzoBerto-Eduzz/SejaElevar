import { useEffect, useRef, useState, type WheelEvent } from 'react';
import { subscribeActionLog, type ActionLogEntry } from './actionLog';

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

  if (window.SEJAELEVAR_RELEASE) {
    return null;
  }

  const handleToggleWheel = (event: WheelEvent<HTMLButtonElement>) => {
    if (!isOpen || !listRef.current) {
      return;
    }

    event.preventDefault();
    listRef.current.scrollTop += event.deltaY;
    listRef.current.scrollLeft += event.deltaX;
  };

  return (
    <>
      <button
        className={isOpen ? 'action-history-toggle open' : 'action-history-toggle'}
        type="button"
        aria-label="Histórico de ações"
        title="Histórico de ações"
        onClick={() => setIsOpen((currentIsOpen) => !currentIsOpen)}
        onWheel={handleToggleWheel}
      >
        <svg
          aria-hidden="true"
          className="action-history-icon"
          viewBox="0 0 24 24"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v6h6" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {isOpen && (
        <aside className="action-history-panel" aria-label="Histórico de ações">
          <div className="action-history-list" ref={listRef}>
            {entries.length === 0 ? (
              <div className="action-history-line action-history-empty cut">
                <span>Nenhuma ação registrada nesta sessão.</span>
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
