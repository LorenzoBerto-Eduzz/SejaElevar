import { useEffect, useState } from 'react';
import { subscribeActionLog, type ActionLogEntry } from './actionLog';

export function ActionLogOverlay() {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (window.SEJAELEVAR_RELEASE) {
      return;
    }

    return subscribeActionLog(setEntries);
  }, []);

  if (window.SEJAELEVAR_RELEASE) {
    return null;
  }

  return (
    <>
      <button
        className={isOpen ? 'action-history-toggle open' : 'action-history-toggle'}
        type="button"
        aria-label="Histórico de ações"
        title="Histórico de ações"
        onClick={() => setIsOpen((currentIsOpen) => !currentIsOpen)}
      >
        H
      </button>
      {isOpen && (
        <aside className="action-history-panel" aria-label="Histórico de ações">
          <div className="action-history-list">
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
