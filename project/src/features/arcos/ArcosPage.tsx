import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARCOS_ENTITY_ID,
  DISCIPLINAS_ENTITY_ID,
  type SheetTable,
} from '../../shared/data/dataIndex';
import { GLOBAL_DATA_CHANGED_EVENT } from '../../shared/data/events';
import { importEmentaFromPicker } from '../../shared/data/ementas/ementaImport';
import { syncAcademicWorkbookFromSource } from '../../shared/data/academicProgress';
import {
  ARCOS_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from '../../shared/data/schemas';
import {
  ensureActiveWorkbookManagedSheets,
  fetchBaseWorkbookFileWithRetry,
  fetchRecoveryInfo,
  readWorkbookSheetFile,
} from '../../shared/data/workspaceData';
import { EmptyWorkbookImportState } from '../../shared/ui/EmptyWorkbookImportState';
import {
  markGlobalWorkbookAvailable,
  useGlobalWorkbookState,
} from '../../shared/ui/GlobalWorkbookToolbar';
import { useTimedToast } from '../../shared/ui/useTimedToast';

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
const DEFAULT_EXPANDED_MODULE_KEYS = new Set([
  normalizeFieldLabel('Específico'),
]);

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

const formatDisciplineHours = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '-';
  }

  const numericValue = trimmedValue.match(/\d+(?:[,.]\d+)?/)?.[0];

  return numericValue ? `${numericValue.replace(',', '.')}h` : trimmedValue;
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

const readArcosWorkbookBundle = async (file: File) => {
  const [arcosSheet, disciplinasSheet] = await Promise.all([
    readArcosFromFile(file),
    readDisciplinasFromFile(file),
  ]);

  return {
    arcosSheet,
    disciplinasSheet,
  };
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
  const [hasActiveWorkbook, setHasActiveWorkbook] = useState(false);
  const [hasCheckedWorkbook, setHasCheckedWorkbook] = useState(false);
  const [isImportingEmenta, setIsImportingEmenta] = useState(false);
  const latestArcosSheetRef = useRef<SheetTable | null>(null);
  const latestDisciplinasSheetRef = useRef<SheetTable | null>(null);
  const globalWorkbookState = useGlobalWorkbookState();
  const { message: ementaToast, showToast: showEmentaToast } =
    useTimedToast();
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set(DEFAULT_EXPANDED_MODULE_KEYS),
  );

  useEffect(() => {
    latestArcosSheetRef.current = arcosSheet;
  }, [arcosSheet]);

  useEffect(() => {
    latestDisciplinasSheetRef.current = disciplinasSheet;
  }, [disciplinasSheet]);

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

        const file = changedFile ?? (await fetchBaseWorkbookFileWithRetry());

        if (!isMounted) {
          return;
        }

        if (!file) {
          setArcosSheet(null);
          setDisciplinasSheet(null);
          setHasActiveWorkbook(false);
          setHasCheckedWorkbook(true);
          return;
        }

        const {
          arcosSheet: nextArcosSheet,
          disciplinasSheet: nextDisciplinasSheet,
        } = await readArcosWorkbookBundle(file);

        if (!isMounted) {
          return;
        }

        setArcosSheet(nextArcosSheet);
        setDisciplinasSheet(nextDisciplinasSheet);
        setHasActiveWorkbook(true);
        setHasCheckedWorkbook(true);
        markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
      } catch {
        if (!isMounted) {
          return;
        }

        const retryFile = await fetchBaseWorkbookFileWithRetry(6, 260).catch(
          () => null,
        );

        if (retryFile) {
          try {
            const {
              arcosSheet: nextArcosSheet,
              disciplinasSheet: nextDisciplinasSheet,
            } = await readArcosWorkbookBundle(retryFile);

            if (!isMounted) {
              return;
            }

            setArcosSheet(nextArcosSheet);
            setDisciplinasSheet(nextDisciplinasSheet);
            setHasActiveWorkbook(true);
            setHasCheckedWorkbook(true);
            markGlobalWorkbookAvailable(
              await fetchRecoveryInfo().catch(() => null),
            );
            return;
          } catch {
            // Keep the current visible workbook state below if one already exists.
          }
        }

        if (latestArcosSheetRef.current || latestDisciplinasSheetRef.current) {
          setHasActiveWorkbook(true);
          setHasCheckedWorkbook(true);
          return;
        }

        if (globalWorkbookState.hasWorkbook) {
          setArcosSheet(createEmptyArcosSheet());
          setDisciplinasSheet(createEmptyDisciplinasSheet());
          setHasActiveWorkbook(true);
        }

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
  }, [canInitialize, globalWorkbookState.hasWorkbook]);

  const hasWorkbookForPage = hasActiveWorkbook || globalWorkbookState.hasWorkbook;
  const shouldShowEmptyImportState = hasCheckedWorkbook && !hasWorkbookForPage;
  const shouldShowArcosBoard = hasCheckedWorkbook && hasWorkbookForPage;
  const shouldShowAddArcoLabel = arcos.length === 0;
  const arcosGridTemplateColumns = `${
    arcos.length > 0
      ? `repeat(${arcos.length}, var(--arcos-column-width, 280px)) `
      : ''
  }${shouldShowAddArcoLabel ? 'max-content' : 'var(--menu-button-size)'}`;
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
  const addArcoFromEmenta = async () => {
    if (isImportingEmenta) {
      return;
    }

    setIsImportingEmenta(true);

    try {
      await importEmentaFromPicker();
      const syncedFile = await syncAcademicWorkbookFromSource().catch(
        () => null,
      );

      if (syncedFile) {
        window.dispatchEvent(
          new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
            detail: { file: syncedFile },
          }),
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      showEmentaToast(
        errorMessage === 'missing-base-workbook'
          ? 'Importe o DadosElevar antes de adicionar uma ementa'
          : errorMessage === 'specific-disciplines-not-found'
            ? 'Não foi possível encontrar disciplinas específicas na ementa'
            : errorMessage === 'disciplines-not-found'
              ? 'Não foi possível encontrar disciplinas na ementa'
          : 'N\u00e3o foi poss\u00edvel ler a ementa',
      );
    } finally {
      setIsImportingEmenta(false);
    }
  };

  return (
    <section className="feature-page" aria-labelledby="arcos-title">
      <div className="feature-heading">
        <div>
          <h1 id="arcos-title">Arcos</h1>
        </div>
        <div className="table-toolbar" aria-label="Ações da página">
          <div className="table-toolbar-track">
            <button
              className={
                isImportingEmenta || !hasWorkbookForPage
                  ? 'square-action disabled'
                  : 'square-action'
              }
              type="button"
              aria-label="Adicionar arco"
              title="Adicionar Arco"
              disabled={isImportingEmenta || !hasWorkbookForPage}
              onClick={() => void addArcoFromEmenta()}
            >
              <SquarePlusIcon />
            </button>
          </div>
        </div>
      </div>

      {shouldShowEmptyImportState && <EmptyWorkbookImportState />}

      {shouldShowArcosBoard && (
        <div className="data-table-panel arcos-data-panel">
          <div className="data-table-frame arcos-board-frame">
            <div className="arcos-board" role="region" tabIndex={0}>
              <div
                className="arcos-board-content"
                style={{
                  gridTemplateColumns: arcosGridTemplateColumns,
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
                <section
                  className={
                    shouldShowAddArcoLabel
                      ? 'arco-header-cell arco-add-header-cell empty'
                      : 'arco-header-cell arco-add-header-cell'
                  }
                  role="listitem"
                >
                  <button
                    className={
                      shouldShowAddArcoLabel
                        ? 'arco-add-button with-label'
                        : 'arco-add-button'
                    }
                    type="button"
                    aria-label="Adicionar arco"
                    title="Adicionar Arco"
                    disabled={isImportingEmenta || !arcosSheet}
                    onClick={() => void addArcoFromEmenta()}
                  >
                    <SquarePlusIcon />
                    {shouldShowAddArcoLabel && (
                      <span className="arco-add-label">Adicionar Arco</span>
                    )}
                  </button>
                </section>

                {arcos.length > 0 &&
                  MODULES.map((moduleName) => {
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
                                    >
                                      <DisciplineName name={discipline.name} />
                                      <span className="arco-discipline-side">
                                        <span className="arco-discipline-hours">
                                          {formatDisciplineHours(discipline.hours)}
                                        </span>
                                        <button
                                          className="arco-discipline-corner-action arco-discipline-lessons-action"
                                          type="button"
                                          aria-label={`Ver aulas de ${discipline.name}`}
                                        >
                                          <LessonsIcon />
                                        </button>
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="arco-discipline-row empty">
                                    <DisciplineName name="-" />
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
      {ementaToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {ementaToast}
        </div>
      )}
    </section>
  );
}

function DisciplineName({ name }: { name: string }) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [isExpandable, setIsExpandable] = useState(false);

  useEffect(() => {
    const wrapElement = wrapRef.current;
    const textElement = textRef.current;

    if (!wrapElement || !textElement) {
      return;
    }

    const updateExpandableState = () => {
      setIsExpandable(
        textElement.scrollHeight > textElement.clientHeight + 1 ||
          textElement.scrollWidth > textElement.clientWidth + 1,
      );
    };

    updateExpandableState();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateExpandableState);

      return () => window.removeEventListener('resize', updateExpandableState);
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateExpandableState);
    });
    observer.observe(wrapElement);

    return () => observer.disconnect();
  }, [name]);

  return (
    <span
      className={
        isExpandable
          ? 'arco-discipline-name-wrap expandable'
          : 'arco-discipline-name-wrap'
      }
      ref={wrapRef}
    >
      <span className="arco-discipline-name" ref={textRef}>
        {name}
      </span>
    </span>
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

function SquarePlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
    </svg>
  );
}
