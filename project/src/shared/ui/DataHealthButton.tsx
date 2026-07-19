import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type DataHealthIssue,
  type DataHealthReport,
  type DataHealthSeverity,
  readDataHealthReport,
} from '../data/dataHealth';
import { GLOBAL_DATA_CHANGED_EVENT } from '../data/events';

export const DATA_HEALTH_PANEL_OPEN_EVENT = 'sejaelevar:data-health-open';
export const DATA_HEALTH_PANEL_CLOSE_EVENT = 'sejaelevar:data-health-close';

let openDataHealthPanelId: symbol | null = null;

const severityLabels: Record<DataHealthSeverity, string> = {
  error: 'Cr\u00edtico',
  warning: 'Aten\u00e7\u00e3o',
  info: 'Info',
};

const getSeverityCount = (
  issues: DataHealthIssue[],
  severity: DataHealthSeverity,
) => issues.filter((issue) => issue.severity === severity).length;

const repairPtBrText = (value: string) =>
  value
    .replaceAll('Ã£', 'ã')
    .replaceAll('Ã¡', 'á')
    .replaceAll('Ã¢', 'â')
    .replaceAll('Ã©', 'é')
    .replaceAll('Ãª', 'ê')
    .replaceAll('Ã­', 'í')
    .replaceAll('Ã³', 'ó')
    .replaceAll('Ã´', 'ô')
    .replaceAll('Ãº', 'ú')
    .replaceAll('Ã§', 'ç')
    .replaceAll('Ã', 'Á')
    .replaceAll('Ã‰', 'É')
    .replaceAll('Ã“', 'Ó')
    .replaceAll('Ã‡', 'Ç');

type DataHealthButtonProps = {
  placement?: 'floating' | 'settings' | 'toolbar';
};

export function DataHealthButton({
  placement = 'floating',
}: DataHealthButtonProps) {
  const panelIdRef = useRef(Symbol('data-health-panel'));
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
  const highestSeverity =
    summary.errors > 0
      ? 'error'
      : summary.warnings > 0
        ? 'warning'
        : summary.info > 0
          ? 'info'
          : 'ok';
  const highestSeverityCount =
    highestSeverity === 'error'
      ? summary.errors
      : highestSeverity === 'warning'
        ? summary.warnings
        : 0;

  const refreshReport = async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const nextReport = await readDataHealthReport();
      setReport(nextReport);
      return nextReport;
    } catch {
      setErrorMessage(
        'N\u00e3o foi poss\u00edvel verificar as pend\u00eancias.',
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  };

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
    if (placement !== 'toolbar') {
      return;
    }

    void refreshReport();

    const handleGlobalDataChanged = () => {
      void refreshReport();
    };

    window.addEventListener(GLOBAL_DATA_CHANGED_EVENT, handleGlobalDataChanged);

    return () =>
      window.removeEventListener(
        GLOBAL_DATA_CHANGED_EVENT,
        handleGlobalDataChanged,
      );
  }, [placement]);

  useEffect(() => {
    const closePanel = () => {
      openDataHealthPanelId = null;
      setIsOpen(false);
    };

    window.addEventListener(DATA_HEALTH_PANEL_CLOSE_EVENT, closePanel);

    return () => {
      window.removeEventListener(DATA_HEALTH_PANEL_CLOSE_EVENT, closePanel);
      if (openDataHealthPanelId === panelIdRef.current) {
        openDataHealthPanelId = null;
      }
    };
  }, []);

  const togglePanel = async () => {
    if (isOpen || openDataHealthPanelId !== null) {
      openDataHealthPanelId = null;
      window.dispatchEvent(new Event(DATA_HEALTH_PANEL_CLOSE_EVENT));
      setIsOpen(false);
      return;
    }

    window.dispatchEvent(new Event(DATA_HEALTH_PANEL_CLOSE_EVENT));
    window.dispatchEvent(new Event(DATA_HEALTH_PANEL_OPEN_EVENT));

    if (!report) {
      await refreshReport();
    }

    openDataHealthPanelId = panelIdRef.current;
    setIsOpen(true);
  };

  const panel = isOpen ? (
    <section
      className={`data-health-panel placement-${placement}`}
      aria-label="Pend\u00eancias dos dados"
    >
      <header className="data-health-header">
        <div>
          <span className="data-health-title">Pend\u00eancias</span>
          <span className="data-health-subtitle">
            {report?.fileName ? repairPtBrText(report.fileName) : 'DadosElevar'}
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
        {!isLoading && errorMessage && (
          <p className="data-health-empty">{errorMessage}</p>
        )}

        {!isLoading && !errorMessage && report?.hasWorkbook === false && (
          <p className="data-health-empty">
            Importe um DadosElevar para verificar pend\u00eancias.
          </p>
        )}

        {!isLoading &&
          !errorMessage &&
          report?.hasWorkbook &&
          report.issues.length === 0 && (
            <p className="data-health-empty">
              Nenhuma pend\u00eancia encontrada.
            </p>
          )}

        {!isLoading &&
          !errorMessage &&
          report?.issues.map((issue) => (
            <article
              className={`data-health-issue severity-${issue.severity}`}
              key={issue.id}
            >
              <div className="data-health-issue-top">
                <span>{repairPtBrText(issue.area)}</span>
                <strong>{severityLabels[issue.severity]}</strong>
              </div>
              <h3>{repairPtBrText(issue.title)}</h3>
              <p>{repairPtBrText(issue.detail)}</p>
            </article>
          ))}
      </div>
    </section>
  ) : null;
  const panelRoot =
    typeof document === 'undefined'
      ? null
      : document.querySelector('.app-shell') ?? document.body;

  return (
    <div className={`data-health-widget placement-${placement}`}>
      <button
        className={[
          'data-health-button',
          `severity-${highestSeverity}`,
          issueCount > 0 ? 'has-issues' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        type="button"
        aria-label="Pend\u00eancias"
        title={
          highestSeverityCount > 0
            ? `${highestSeverityCount} pend\u00eancia${
                highestSeverityCount === 1 ? '' : 's'
              }`
            : 'Pend\u00eancias'
        }
        aria-expanded={isOpen}
        onClick={togglePanel}
      >
        <DataHealthIcon
          countLabel={
            highestSeverityCount > 0 ? String(highestSeverityCount) : ''
          }
        />
        {placement === 'settings' && (
          <span className="data-health-button-label">
            Pend\u00eancias dos dados
          </span>
        )}
      </button>

      {panel && panelRoot ? createPortal(panel, panelRoot) : panel}
    </div>
  );
}

type DataHealthIconProps = {
  countLabel?: string;
};

function DataHealthIcon({ countLabel = '' }: DataHealthIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5c0 5 -3 8 -7 10c-4 -2 -7 -5 -7 -10v-5l7 -3" />
      {countLabel ? (
        <text
          x="12"
          y="12.65"
          dominantBaseline="middle"
          textAnchor="middle"
        >
          {countLabel}
        </text>
      ) : (
        <path d="M9 12l2 2l4 -5" />
      )}
    </svg>
  );
}
