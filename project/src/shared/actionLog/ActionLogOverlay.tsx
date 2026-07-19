import { useEffect, useRef, useState } from 'react';
import { subscribeActionLog, type ActionLogEntry } from './actionLog';
import {
  DATA_HEALTH_PANEL_CLOSE_EVENT,
  DATA_HEALTH_PANEL_OPEN_EVENT,
} from '../ui/DataHealthButton';
import {
  OPEN_GLOBAL_RECOVERY_EVENT,
  useGlobalWorkbookState,
} from '../ui/GlobalWorkbookToolbar';

export const TOGGLE_ACTION_HISTORY_EVENT =
  'sejaelevar:toggle-action-history';

export function ActionLogOverlay() {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { recoveryInfo } = useGlobalWorkbookState();
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);

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
      setIsOpen((currentIsOpen) => {
        const nextIsOpen = !currentIsOpen;

        if (nextIsOpen) {
          window.dispatchEvent(new Event(DATA_HEALTH_PANEL_CLOSE_EVENT));
        }

        return nextIsOpen;
      });
    };
    const closeHistory = () => setIsOpen(false);

    window.addEventListener(TOGGLE_ACTION_HISTORY_EVENT, toggleHistory);
    window.addEventListener(DATA_HEALTH_PANEL_OPEN_EVENT, closeHistory);

    return () => {
      window.removeEventListener(TOGGLE_ACTION_HISTORY_EVENT, toggleHistory);
      window.removeEventListener(DATA_HEALTH_PANEL_OPEN_EVENT, closeHistory);
    };
  }, []);

  if (window.SEJAELEVAR_RELEASE) {
    return null;
  }

  const openRecovery = () => {
    if (!canRecoverBackup) {
      return;
    }

    window.dispatchEvent(new Event(OPEN_GLOBAL_RECOVERY_EVENT));
  };

  return (
    <>
      {isOpen && (
        <aside
          className="action-history-panel"
          aria-label={"Hist\u00f3rico de a\u00e7\u00f5es"}
        >
          <div className="action-history-header">
            <h2>{"Hist\u00f3rico"}</h2>
            <button
              className="settings-close action-history-close"
              type="button"
              aria-label="Fechar hist\u00f3rico"
              onClick={() => setIsOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          <button
            className="settings-update-button action-history-recovery-button"
            type="button"
            disabled={!canRecoverBackup}
            onClick={openRecovery}
          >
            <RotateClockwiseIcon />
            <span className="settings-update-label">{"Recuperar dados"}</span>
          </button>
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
