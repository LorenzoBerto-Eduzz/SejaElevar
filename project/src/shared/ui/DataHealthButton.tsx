import { useEffect, useMemo, useState } from 'react';
import {
  type DataHealthIssue,
  type DataHealthReport,
  type DataHealthSeverity,
  readDataHealthReport,
} from '../data/dataHealth';
import { GLOBAL_DATA_CHANGED_EVENT } from '../data/events';

const severityLabels: Record<DataHealthSeverity, string> = {
  error: 'Crítico',
  warning: 'Atenção',
  info: 'Info',
};

const getSeverityCount = (
  issues: DataHealthIssue[],
  severity: DataHealthSeverity,
) => issues.filter((issue) => issue.severity === severity).length;

export function DataHealthButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<DataHealthReport | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const issueCount = report?.issues.length ?? 0;
  const summary = useMemo(
    () => ({
      errors: getSeverityCount(report?.issues ?? [], 'error'),
      warnings: getSeverityCount(report?.issues ?? [], 'warning'),
      info: getSeverityCount(report?.issues ?? [], 'info'),
    }),
    [report],
  );

  const refreshReport = async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      setReport(await readDataHealthReport());
    } catch {
      setErrorMessage('Não foi possível verificar as pendências.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void refreshReport();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleGlobalDataChanged = () => {
      void refreshReport();
    };

    window.addEventListener(GLOBAL_DATA_CHANGED_EVENT, handleGlobalDataChanged);

    return () =>
      window.removeEventListener(
        GLOBAL_DATA_CHANGED_EVENT,
        handleGlobalDataChanged,
      );
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (target?.closest('.data-health-widget')) {
        return;
      }

      setIsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  return (
    <div className="data-health-widget">
      <button
        className={
          issueCount > 0
            ? 'data-health-button has-issues'
            : 'data-health-button'
        }
        type="button"
        aria-label="Pendências"
        title="Pendências"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <DataHealthIcon />
        {issueCount > 0 && (
          <span className="data-health-count">{issueCount}</span>
        )}
      </button>

      {isOpen && (
        <section
          className="data-health-panel"
          aria-label="Pendências dos dados"
        >
          <header className="data-health-header">
            <div>
              <span className="data-health-title">Pendências</span>
              <span className="data-health-subtitle">
                {report?.fileName ?? 'DadosElevar'}
              </span>
            </div>
            <button
              className="data-health-refresh"
              type="button"
              onClick={refreshReport}
              disabled={isLoading}
            >
              Atualizar
            </button>
          </header>

          <div className="data-health-summary" aria-label="Resumo">
            <span className="severity-error">{summary.errors}</span>
            <span className="severity-warning">{summary.warnings}</span>
            <span className="severity-info">{summary.info}</span>
          </div>

          <div className="data-health-body">
            {isLoading && <p className="data-health-empty">Verificando...</p>}

            {!isLoading && errorMessage && (
              <p className="data-health-empty">{errorMessage}</p>
            )}

            {!isLoading && !errorMessage && report?.hasWorkbook === false && (
              <p className="data-health-empty">
                Importe um DadosElevar para verificar pendências.
              </p>
            )}

            {!isLoading &&
              !errorMessage &&
              report?.hasWorkbook &&
              report.issues.length === 0 && (
                <p className="data-health-empty">Nenhuma pendência encontrada.</p>
              )}

            {!isLoading &&
              !errorMessage &&
              report?.issues.map((issue) => (
                <article
                  className={`data-health-issue severity-${issue.severity}`}
                  key={issue.id}
                >
                  <div className="data-health-issue-top">
                    <span>{issue.area}</span>
                    <strong>{severityLabels[issue.severity]}</strong>
                  </div>
                  <h3>{issue.title}</h3>
                  <p>{issue.detail}</p>
                </article>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DataHealthIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5c0 5 -3 8 -7 10c-4 -2 -7 -5 -7 -10v-5l7 -3" />
      <path d="M9 12l2 2l4 -5" />
    </svg>
  );
}
