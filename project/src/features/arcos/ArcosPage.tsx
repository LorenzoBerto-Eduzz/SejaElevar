import { useEffect, useMemo, useState } from 'react';
import {
  ARCOS_ENTITY_ID,
  DISCIPLINAS_ENTITY_ID,
  type SheetTable,
} from '../../shared/data/dataIndex';
import {
  GLOBAL_DATA_CHANGED_EVENT,
  GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
} from '../../shared/data/events';
import {
  ARCOS_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from '../../shared/data/schemas';
import {
  ensureActiveWorkbookManagedSheets,
  fetchBaseWorkbookFile,
  readWorkbookSheetFile,
} from '../../shared/data/workspaceData';
import { GlobalWorkbookToolbar } from '../../shared/ui/GlobalWorkbookToolbar';

type ArcosPageProps = {
  canInitialize?: boolean;
  isActive?: boolean;
};

const ARCOS_WORKBOOK_SHEET = 'Arcos';
const DISCIPLINAS_WORKBOOK_SHEET = 'Disciplinas';
const ARCOS_NAME_COLUMN = 'Arco';
const DISCIPLINE_NAME_COLUMN = 'Disciplina';
const DISCIPLINE_MODULE_COLUMN = 'Módulo';
const DISCIPLINE_ARCO_COLUMN = 'Arco';
const DISCIPLINE_HOURS_COLUMN = 'Carga Horária';
const SHARED_DISCIPLINES_ARCO = 'Todos';
const MODULES = ['Inicial', 'Básico', 'Específico'] as const;

const getColumnIndex = (sheet: SheetTable, columnName: string) =>
  sheet.columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  );

const getCellValue = (
  sheet: SheetTable,
  row: readonly string[],
  columnName: string,
) => {
  const columnIndex = getColumnIndex(sheet, columnName);

  return columnIndex >= 0 ? String(row[columnIndex] ?? '').trim() : '';
};

const createEmptyArcosSheet = (fileName = 'DadosElevar.xlsx'): SheetTable => ({
  fileName,
  sheetName: ARCOS_WORKBOOK_SHEET,
  importedAt: new Date().toISOString(),
  columns: [...ARCOS_REQUIRED_COLUMNS],
  rows: [],
});

const createEmptyDisciplinasSheet = (
  fileName = 'DadosElevar.xlsx',
): SheetTable => ({
  fileName,
  sheetName: DISCIPLINAS_WORKBOOK_SHEET,
  importedAt: new Date().toISOString(),
  columns: [...DISCIPLINAS_REQUIRED_COLUMNS],
  rows: [],
});

const readArcosFromFile = async (file: File) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: ARCOS_ENTITY_ID,
      ensureRecordIds: false,
      preferredSheetName: ARCOS_WORKBOOK_SHEET,
      requiredColumns: ARCOS_REQUIRED_COLUMNS,
    });
  } catch {
    return createEmptyArcosSheet(file.name);
  }
};

const readDisciplinasFromFile = async (file: File) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: DISCIPLINAS_ENTITY_ID,
      ensureRecordIds: false,
      preferredSheetName: DISCIPLINAS_WORKBOOK_SHEET,
      requiredColumns: DISCIPLINAS_REQUIRED_COLUMNS,
    });
  } catch {
    return createEmptyDisciplinasSheet(file.name);
  }
};

type Arco = {
  id: string;
  name: string;
};

type Disciplina = {
  id: string;
  name: string;
  module: string;
  arco: string;
  hours: string;
};

const getArcoModuleDisciplines = (
  disciplines: readonly Disciplina[],
  arcoName: string,
  moduleName: string,
) => {
  const normalizedArco = normalizeFieldLabel(arcoName);
  const normalizedModule = normalizeFieldLabel(moduleName);
  const normalizedSharedArco = normalizeFieldLabel(SHARED_DISCIPLINES_ARCO);

  return disciplines.filter((discipline) => {
    const disciplineModule = normalizeFieldLabel(discipline.module);
    const disciplineArco = normalizeFieldLabel(discipline.arco);

    if (disciplineModule !== normalizedModule) {
      return false;
    }

    if (normalizedModule === normalizeFieldLabel('Específico')) {
      return disciplineArco === normalizedArco;
    }

    return (
      disciplineArco === normalizedSharedArco || disciplineArco === normalizedArco
    );
  });
};

export function ArcosPage({
  canInitialize = true,
  isActive = true,
}: ArcosPageProps) {
  const [arcosSheet, setArcosSheet] = useState<SheetTable | null>(null);
  const [disciplinasSheet, setDisciplinasSheet] = useState<SheetTable | null>(
    null,
  );
  const [hasCheckedWorkbook, setHasCheckedWorkbook] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set(),
  );

  const arcos = useMemo<Arco[]>(() => {
    if (!arcosSheet) {
      return [];
    }

    const seen = new Set<string>();

    return arcosSheet.rows
      .map((row, rowIndex) => ({
        id: getCellValue(arcosSheet, row, 'ID') || `arco#${rowIndex + 1}`,
        name: getCellValue(arcosSheet, row, ARCOS_NAME_COLUMN),
      }))
      .filter(({ name }) => name !== '')
      .filter(({ name }) => {
        const key = normalizeFieldLabel(name);

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }, [arcosSheet]);

  const disciplinas = useMemo<Disciplina[]>(() => {
    if (!disciplinasSheet) {
      return [];
    }

    return disciplinasSheet.rows
      .map((row, rowIndex) => ({
        id:
          getCellValue(disciplinasSheet, row, 'ID') ||
          `disciplina#${rowIndex + 1}`,
        name: getCellValue(disciplinasSheet, row, DISCIPLINE_NAME_COLUMN),
        module: getCellValue(disciplinasSheet, row, DISCIPLINE_MODULE_COLUMN),
        arco: getCellValue(disciplinasSheet, row, DISCIPLINE_ARCO_COLUMN),
        hours: getCellValue(disciplinasSheet, row, DISCIPLINE_HOURS_COLUMN),
      }))
      .filter(({ name }) => name !== '');
  }, [disciplinasSheet]);

  useEffect(() => {
    if (!canInitialize) {
      return;
    }

    let isMounted = true;

    const loadWorkbook = async (changedFile?: File | null) => {
      try {
        if (!changedFile) {
          await ensureActiveWorkbookManagedSheets().catch(() => false);
        }

        const file = changedFile ?? (await fetchBaseWorkbookFile());

        if (!isMounted) {
          return;
        }

        if (!file) {
          setArcosSheet(null);
          setHasCheckedWorkbook(true);
          return;
        }

        const [nextArcosSheet, nextDisciplinasSheet] = await Promise.all([
          readArcosFromFile(file),
          readDisciplinasFromFile(file),
        ]);

        if (!isMounted) {
          return;
        }

        setArcosSheet(nextArcosSheet);
        setDisciplinasSheet(nextDisciplinasSheet);
        setHasCheckedWorkbook(true);
      } catch {
        if (!isMounted) {
          return;
        }

        setArcosSheet(null);
        setDisciplinasSheet(null);
        setHasCheckedWorkbook(true);
      }
    };

    const handleGlobalDataChanged = (event: Event) => {
      const changedFile =
        event instanceof CustomEvent && event.detail?.file instanceof File
          ? event.detail.file
          : null;

      void loadWorkbook(changedFile);
    };

    void loadWorkbook();
    window.addEventListener(GLOBAL_DATA_CHANGED_EVENT, handleGlobalDataChanged);

    return () => {
      isMounted = false;
      window.removeEventListener(
        GLOBAL_DATA_CHANGED_EVENT,
        handleGlobalDataChanged,
      );
    };
  }, [canInitialize]);

  const shouldShowImportState = hasCheckedWorkbook && !arcosSheet;
  const shouldShowEmptyState =
    hasCheckedWorkbook && arcosSheet !== null && arcos.length === 0;
  const toggleModule = (moduleName: string) => {
    const moduleKey = normalizeFieldLabel(moduleName);

    setExpandedModules((current) => {
      const next = new Set(current);

      if (next.has(moduleKey)) {
        next.delete(moduleKey);
      } else {
        next.add(moduleKey);
      }

      return next;
    });
  };

  return (
    <section className="feature-page" aria-labelledby="arcos-title">
      <div className="feature-heading">
        <div>
          <h1 id="arcos-title">Arcos</h1>
        </div>
        <div className="table-toolbar" aria-label="Ações da página">
          <div className="table-toolbar-track">
            {isActive && <GlobalWorkbookToolbar />}
          </div>
        </div>
      </div>

      {shouldShowImportState && (
        <div
          className="empty-data-state empty-tool-state"
          role="region"
          aria-label="Importar DadosElevar"
        >
          <button
            className="primary-action import-empty-action"
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new Event(GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT),
              )
            }
          >
            Importar .xlsx
          </button>
        </div>
      )}

      {shouldShowEmptyState && (
        <div className="empty-data-state placeholder-state" role="region">
          <h2>Nenhum arco cadastrado</h2>
        </div>
      )}

      {arcosSheet && arcos.length > 0 && (
        <div className="data-table-panel arcos-data-panel">
          <div className="data-table-frame arcos-board-frame">
            <div className="arcos-board" role="region" tabIndex={0}>
              <div
                className="arcos-board-content"
                style={{
                  gridTemplateColumns: `repeat(${arcos.length}, var(--arcos-column-width, 280px))`,
                }}
              >
                {arcos.map((arco) => (
                  <section
                    className="arco-header-cell"
                    role="listitem"
                    key={arco.id}
                  >
                    <div className="arco-group-header">
                      <span className="arco-header-title">{arco.name}</span>
                    </div>
                  </section>
                ))}

                {MODULES.map((moduleName) => {
                  const moduleKey = normalizeFieldLabel(moduleName);
                  const isExpanded = expandedModules.has(moduleKey);

                  return (
                    <section className="arcos-module-section" key={moduleName}>
                      <button
                        className="arcos-module-button"
                        type="button"
                        onClick={() => toggleModule(moduleName)}
                      >
                        <span className="arcos-module-button-text">
                          {moduleName}
                          <ModuleArrowIcon isExpanded={isExpanded} />
                        </span>
                      </button>
                      {isExpanded && (
                        <div
                          className="arcos-module-columns"
                          style={{
                            gridTemplateColumns: `repeat(${arcos.length}, var(--arcos-column-width, 280px))`,
                          }}
                        >
                          {arcos.map((arco) => {
                            const moduleDisciplines = getArcoModuleDisciplines(
                              disciplinas,
                              arco.name,
                              moduleName,
                            );

                            return (
                              <div
                                className="arco-discipline-list"
                                key={`${arco.id}:${moduleName}`}
                              >
                                {moduleDisciplines.length > 0 ? (
                                  moduleDisciplines.map((discipline) => (
                                    <div
                                      className="arco-discipline-row"
                                      key={discipline.id}
                                      title={discipline.name}
                                    >
                                      <span className="arco-discipline-name">
                                        {discipline.name}
                                      </span>
                                      <span className="arco-discipline-side">
                                        <span className="arco-discipline-hours">
                                          {discipline.hours || '-'}
                                        </span>
                                      </span>
                                      <button
                                        className="arco-discipline-corner-action arco-discipline-lessons-action"
                                        type="button"
                                        aria-label={`Ver aulas de ${discipline.name}`}
                                        title="Aulas"
                                      >
                                        <LessonsIcon />
                                      </button>
                                      <button
                                        className="arco-discipline-corner-action arco-discipline-delete-action"
                                        type="button"
                                        aria-label={`Excluir ${discipline.name}`}
                                        title="Excluir disciplina"
                                      >
                                        <DeleteIcon />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <div className="arco-discipline-row empty">
                                    <span className="arco-discipline-name">
                                      -
                                    </span>
                                    <span className="arco-discipline-side">
                                      <span className="arco-discipline-hours">
                                        -
                                      </span>
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
                  </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ModuleArrowIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={isExpanded ? 'arcos-module-arrow expanded' : 'arcos-module-arrow'}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
}

function LessonsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 19a9 9 0 0 1 6 0a9 9 0 0 0 6 0a9 9 0 0 1 6 0" />
      <path d="M3 6a9 9 0 0 1 6 0a9 9 0 0 0 6 0a9 9 0 0 1 6 0" />
      <path d="M3 6v13" />
      <path d="M21 6v13" />
      <path d="M12 6v13" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
