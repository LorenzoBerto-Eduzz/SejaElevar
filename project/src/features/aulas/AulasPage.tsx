import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  AULAS_DISCIPLINAS_ENTITY_ID,
  AULAS_ENTITY_ID,
  ARCOS_ENTITY_ID,
  CRONOGRAMA_ENTITY_ID,
  DISCIPLINAS_ENTITY_ID,
  type SheetTable,
} from '../../shared/data/dataIndex';
import { GLOBAL_DATA_CHANGED_EVENT } from '../../shared/data/events';
import {
  AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
  AULAS_REQUIRED_COLUMNS,
  ARCOS_REQUIRED_COLUMNS,
  CRONOGRAMA_REQUIRED_COLUMNS,
  DISCIPLINAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from '../../shared/data/schemas';
import {
  AULA_COVERAGE_ARC_COLUMN,
  AULA_COVERAGE_DISCIPLINE_COLUMN,
  AULA_COVERAGE_DISCIPLINE_ID_COLUMN,
  AULA_COVERAGE_ID_COLUMN,
  AULA_COVERAGE_LESSON_COLUMN,
  AULA_COVERAGE_LESSON_ID_COLUMN,
  AULA_COVERAGE_MODULE_COLUMN,
  buildAulaCoverageOptions,
  isSpecificDisciplineModule,
  type AulaCoverageOption,
} from '../../shared/data/aulaCoverage';
import {
  ensureActiveWorkbookManagedSheets,
  fetchBaseWorkbookFile,
  fetchBaseWorkbookFileWithRetry,
  loadXlsx,
  persistManagedWorkbookDataIndexes,
  readWorkbookSheetFile,
  responseToWorkbookFile,
} from '../../shared/data/workspaceData';
import {
  emptyWorkbookOptions,
  mergeWorkbookOptionValues,
  normalizeWorkbookOptionKey,
  persistWorkbookOption,
  readWorkbookOptions,
  type WorkbookOptionType,
} from '../../shared/data/workbookOptions';
import { generateStableRecordId } from '../../shared/data/stableIds';
import {
  pushGlobalUndoEntry,
  registerGlobalUndoController,
  type GlobalUndoEntry,
} from '../../shared/undo/globalUndo';
import { EmptyWorkbookImportState } from '../../shared/ui/EmptyWorkbookImportState';

type AulasPageProps = {
  canInitialize?: boolean;
  isActive?: boolean;
};

type AulaItem = {
  color: string;
  defaultInstructor: string;
  defaultRoom: string;
  id: string;
  isDraft?: boolean;
  name: string;
  rowIndex: number;
};

type AulaCoverageItem = {
  id: string;
  aulaId: string;
  aulaName: string;
  arco: string;
  discipline: string;
  disciplineId: string;
  module: string;
  row: string[];
  rowIndex: number;
};

const AULAS_WORKBOOK_SHEET = 'Aulas';
const AULAS_DISCIPLINAS_WORKBOOK_SHEET = 'Aulas Disciplinas';
const CRONOGRAMA_WORKBOOK_SHEET = 'Cronograma';
const AULA_NAME_COLUMN = 'Aula';
const AULA_COLOR_COLUMN = 'Cor';
const AULA_DEFAULT_INSTRUCTOR_COLUMN = 'Instrutor Padrão';
const AULA_DEFAULT_ROOM_COLUMN = 'Sala Padrão';
const CRONOGRAMA_LESSON_ID_COLUMN = 'Aula ID';
const CRONOGRAMA_LESSON_COLUMN = 'Aula';
const DEFAULT_AULA_COLOR = '#2069df';
const AULA_COLOR_HISTORY_STORAGE_KEY = 'sejaelevar.aulas.colorHistory.v1';
const AULA_COLOR_HISTORY_LIMIT = 29;
const AULA_COLOR_POPUP_WIDTH = 220;
const AULA_COLOR_POPUP_HEIGHT = 72;
const AULA_COLOR_POPUP_GAP = 8;
const AULA_COLOR_POPUP_EDGE_GAP = 8;
const DRAFT_AULA: AulaItem = {
  color: DEFAULT_AULA_COLOR,
  defaultInstructor: '',
  defaultRoom: '',
  id: 'aula-draft',
  isDraft: true,
  name: '',
  rowIndex: -1,
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeHexColor = (value: string) => {
  const trimmedValue = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(trimmedValue)) {
    return trimmedValue.toLowerCase();
  }

  return DEFAULT_AULA_COLOR;
};

const readAulaColorHistory = () => {
  if (typeof window === 'undefined') {
    return [DEFAULT_AULA_COLOR];
  }

  try {
    const savedHistory = window.localStorage.getItem(AULA_COLOR_HISTORY_STORAGE_KEY);

    if (!savedHistory) {
      return [DEFAULT_AULA_COLOR];
    }

    const parsedHistory = JSON.parse(savedHistory);

    if (!Array.isArray(parsedHistory)) {
      return [DEFAULT_AULA_COLOR];
    }

    const validColors = parsedHistory
      .filter((color): color is string => typeof color === 'string')
      .map(normalizeHexColor)
      .filter((color, index, colors) => colors.indexOf(color) === index)
      .slice(0, AULA_COLOR_HISTORY_LIMIT);

    return validColors.length > 0 ? validColors : [DEFAULT_AULA_COLOR];
  } catch {
    return [DEFAULT_AULA_COLOR];
  }
};

const saveAulaColorHistory = (colors: readonly string[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    AULA_COLOR_HISTORY_STORAGE_KEY,
    JSON.stringify(colors.slice(0, AULA_COLOR_HISTORY_LIMIT)),
  );
};

const addAulaColorHistoryEntry = (
  color: string,
  currentHistory: readonly string[],
) => {
  const normalizedColor = normalizeHexColor(color);
  const nextHistory = [
    normalizedColor,
    ...currentHistory.filter((historyColor) => historyColor !== normalizedColor),
  ].slice(0, AULA_COLOR_HISTORY_LIMIT);

  saveAulaColorHistory(nextHistory);

  return nextHistory;
};

const createEmptyAulasSheet = (fileName = 'DadosElevar.xlsx'): SheetTable => ({
  fileName,
  sheetName: AULAS_WORKBOOK_SHEET,
  importedAt: new Date().toISOString(),
  columns: [...AULAS_REQUIRED_COLUMNS],
  rows: [],
});

const createEmptyWorkbookSheet = (
  fileName: string,
  sheetName: string,
  columns: readonly string[],
): SheetTable => ({
  fileName,
  sheetName,
  importedAt: new Date().toISOString(),
  columns: [...columns],
  rows: [],
});

const normalizeAulasColumnLabel = (value: string) => {
  const normalizedValue = normalizeFieldLabel(value);

  if (normalizedValue === normalizeFieldLabel('MÃ³dulo')) {
    return normalizeFieldLabel('Módulo');
  }

  if (normalizedValue === normalizeFieldLabel('Carga HorÃ¡ria')) {
    return normalizeFieldLabel('Carga Horária');
  }

  return normalizedValue;
};

const getColumnIndex = (sheet: SheetTable, columnName: string) => {
  const columnKey = normalizeAulasColumnLabel(columnName);

  return sheet.columns.findIndex(
    (column) => normalizeAulasColumnLabel(column) === columnKey,
  );
};

const getCellValue = (
  sheet: SheetTable,
  row: readonly string[],
  columnName: string,
) => {
  const columnIndex = getColumnIndex(sheet, columnName);

  return columnIndex >= 0 ? String(row[columnIndex] ?? '').trim() : '';
};

const readAulasFromFile = async (file: File) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: AULAS_ENTITY_ID,
      ensureRecordIds: false,
      preferredSheetName: AULAS_WORKBOOK_SHEET,
      requiredColumns: AULAS_REQUIRED_COLUMNS,
    });
  } catch {
    return createEmptyAulasSheet(file.name);
  }
};

const readWorkbookSheetWithFallback = async (
  file: File,
  entityId: string,
  sheetName: string,
  requiredColumns: readonly string[],
) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId,
      ensureRecordIds: false,
      preferredSheetName: sheetName,
      requiredColumns,
    });
  } catch {
    return createEmptyWorkbookSheet(file.name, sheetName, requiredColumns);
  }
};

const fetchLegacyWorkbookFile = async (path: string, fallbackFileName: string) => {
  const response = await fetch(path, {
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('read-failed');
  }

  return responseToWorkbookFile(response, fallbackFileName);
};

const fetchAulasWorkbookFile = async () => {
  const baseFile = await fetchBaseWorkbookFileWithRetry();

  if (baseFile) {
    return baseFile;
  }

  const legacyAprendizesFile = await fetchLegacyWorkbookFile(
    '/api/aprendizes/file',
    'Aprendizes.xlsx',
  ).catch(() => null);

  if (legacyAprendizesFile) {
    return legacyAprendizesFile;
  }

  return fetchLegacyWorkbookFile('/api/turmas/file', 'Turmas.xlsx').catch(
    () => null,
  );
};

const readAulasWorkbookBundle = async (file: File) => {
  const [
    aulasSheet,
    coverageSheet,
    arcosSheet,
    disciplinasSheet,
    workbookOptions,
  ] = await Promise.all([
    readAulasFromFile(file),
    readWorkbookSheetWithFallback(
      file,
      AULAS_DISCIPLINAS_ENTITY_ID,
      AULAS_DISCIPLINAS_WORKBOOK_SHEET,
      AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
    ),
    readWorkbookSheetWithFallback(
      file,
      ARCOS_ENTITY_ID,
      'Arcos',
      ARCOS_REQUIRED_COLUMNS,
    ),
    readWorkbookSheetWithFallback(
      file,
      DISCIPLINAS_ENTITY_ID,
      'Disciplinas',
      DISCIPLINAS_REQUIRED_COLUMNS,
    ),
    readWorkbookOptions(file).catch(emptyWorkbookOptions),
  ]);

  return {
    arcosSheet,
    aulasSheet,
    coverageSheet,
    disciplinasSheet,
    workbookOptions,
  };
};

export function AulasPage({
  canInitialize = true,
  isActive = true,
}: AulasPageProps) {
  const [aulasSheet, setAulasSheet] = useState<SheetTable | null>(null);
  const [coverageSheet, setCoverageSheet] = useState<SheetTable | null>(null);
  const [arcosSheet, setArcosSheet] = useState<SheetTable | null>(null);
  const [disciplinasSheet, setDisciplinasSheet] = useState<SheetTable | null>(
    null,
  );
  const [workbookOptions, setWorkbookOptions] = useState(emptyWorkbookOptions);
  const [hasActiveWorkbook, setHasActiveWorkbook] = useState(false);
  const [hasCheckedWorkbook, setHasCheckedWorkbook] = useState(false);
  const [draftAula, setDraftAula] = useState<AulaItem | null>(null);
  const [draftCoverageAulaId, setDraftCoverageAulaId] = useState('');
  const [editingCoverageId, setEditingCoverageId] = useState('');
  const [aulaDeleteConfirmation, setAulaDeleteConfirmation] = useState<{
    aula: AulaItem;
  } | null>(null);
  const latestAulasSheetRef = useRef<SheetTable | null>(null);
  const latestCoverageSheetRef = useRef<SheetTable | null>(null);
  const latestArcosSheetRef = useRef<SheetTable | null>(null);
  const latestDisciplinasSheetRef = useRef<SheetTable | null>(null);

  useEffect(() => {
    latestAulasSheetRef.current = aulasSheet;
  }, [aulasSheet]);

  useEffect(() => {
    latestCoverageSheetRef.current = coverageSheet;
  }, [coverageSheet]);

  useEffect(() => {
    latestArcosSheetRef.current = arcosSheet;
  }, [arcosSheet]);

  useEffect(() => {
    latestDisciplinasSheetRef.current = disciplinasSheet;
  }, [disciplinasSheet]);

  const aulas = useMemo<AulaItem[]>(() => {
    if (!aulasSheet) {
      return [];
    }

    const sheetAulas = aulasSheet.rows
      .map((row, rowIndex) => ({
        color:
          getCellValue(aulasSheet, row, AULA_COLOR_COLUMN) ||
          DEFAULT_AULA_COLOR,
        defaultInstructor: getCellValue(
          aulasSheet,
          row,
          AULA_DEFAULT_INSTRUCTOR_COLUMN,
        ),
        defaultRoom: getCellValue(aulasSheet, row, AULA_DEFAULT_ROOM_COLUMN),
        id: getCellValue(aulasSheet, row, 'ID') || `aula#${rowIndex + 1}`,
        name: getCellValue(aulasSheet, row, AULA_NAME_COLUMN),
        rowIndex,
      }))
      .filter(({ name }) => name !== '');

    return sheetAulas;
  }, [aulasSheet]);

  const coverageOptions = useMemo(
    () => buildAulaCoverageOptions(disciplinasSheet, arcosSheet),
    [arcosSheet, disciplinasSheet],
  );

  const coverageItems = useMemo<AulaCoverageItem[]>(() => {
    if (!coverageSheet) {
      return [];
    }

    return coverageSheet.rows
      .map((row, rowIndex) => {
        const discipline = getCellValue(
          coverageSheet,
          row,
          AULA_COVERAGE_DISCIPLINE_COLUMN,
        );

        if (!discipline) {
          return null;
        }

        const disciplineId = getCellValue(
          coverageSheet,
          row,
          AULA_COVERAGE_DISCIPLINE_ID_COLUMN,
        );
        const matchingOption = coverageOptions.find((option) => {
          const optionIdKey = normalizeWorkbookOptionKey(option.disciplineId);
          const rowIdKey = normalizeWorkbookOptionKey(disciplineId);

          if (optionIdKey && rowIdKey && optionIdKey === rowIdKey) {
            return true;
          }

          return (
            normalizeWorkbookOptionKey(option.discipline) ===
            normalizeWorkbookOptionKey(discipline)
          );
        });

        return {
          id:
            getCellValue(coverageSheet, row, AULA_COVERAGE_ID_COLUMN) ||
            `aula-disciplina#${rowIndex + 1}`,
          aulaId: getCellValue(
            coverageSheet,
            row,
            AULA_COVERAGE_LESSON_ID_COLUMN,
          ),
          aulaName: getCellValue(
            coverageSheet,
            row,
            AULA_COVERAGE_LESSON_COLUMN,
          ),
          discipline,
          disciplineId: disciplineId || matchingOption?.disciplineId || '',
          module:
            getCellValue(coverageSheet, row, AULA_COVERAGE_MODULE_COLUMN) ||
            matchingOption?.module ||
            '',
          arco:
            getCellValue(coverageSheet, row, AULA_COVERAGE_ARC_COLUMN) ||
            matchingOption?.arco ||
            '',
          row,
          rowIndex,
        };
      })
      .filter((item): item is AulaCoverageItem => Boolean(item));
  }, [coverageOptions, coverageSheet]);

  const instructorOptions = useMemo(
    () =>
      mergeWorkbookOptionValues(
        workbookOptions.instrutor,
        aulas.map((aula) => aula.defaultInstructor),
      ),
    [aulas, workbookOptions.instrutor],
  );
  const roomOptions = useMemo(
    () =>
      mergeWorkbookOptionValues(
        workbookOptions.sala,
        aulas.map((aula) => aula.defaultRoom),
      ),
    [aulas, workbookOptions.sala],
  );
  const getCoverageContextLabel = (coverage: {
    arco: string;
    module: string;
  }) => {
    if (isSpecificDisciplineModule(coverage.module)) {
      return coverage.arco.trim().split(/\s+/).filter(Boolean)[0] || 'Arco';
    }

    const moduleKey = normalizeFieldLabel(coverage.module);

    if (moduleKey === 'basico') {
      return 'Básico';
    }

    if (moduleKey === 'inicial') {
      return 'Inicial';
    }

    return coverage.module || '-';
  };
  const getCoverageContextOrder = (coverage: { arco: string; module: string }) => {
    const moduleKey = normalizeFieldLabel(coverage.module);

    if (moduleKey === 'inicial') {
      return 0;
    }

    if (moduleKey === 'basico') {
      return 1;
    }

    return 2;
  };
  const sortCoverageOptions = (options: AulaCoverageOption[]) =>
    [...options].sort((left, right) => {
      const orderDifference =
        getCoverageContextOrder(left) - getCoverageContextOrder(right);

      if (orderDifference !== 0) {
        return orderDifference;
      }

      const contextComparison = getCoverageContextLabel(left).localeCompare(
        getCoverageContextLabel(right),
        'pt-BR',
        { sensitivity: 'base' },
      );

      if (contextComparison !== 0) {
        return contextComparison;
      }

      return left.discipline.localeCompare(right.discipline, 'pt-BR', {
        sensitivity: 'base',
      });
    });
  const getAulaCoverageItems = (aula: AulaItem) =>
    [...coverageItems]
      .filter((coverage) => {
        if (coverage.aulaId && aula.id) {
          return coverage.aulaId === aula.id;
        }

        return (
          !coverage.aulaId &&
          normalizeWorkbookOptionKey(coverage.aulaName) ===
            normalizeWorkbookOptionKey(aula.name)
        );
      })
      .sort((left, right) => {
        const orderDifference =
          getCoverageContextOrder(left) - getCoverageContextOrder(right);

        if (orderDifference !== 0) {
          return orderDifference;
        }

        const contextComparison = getCoverageContextLabel(left).localeCompare(
          getCoverageContextLabel(right),
          'pt-BR',
          { sensitivity: 'base' },
        );

        if (contextComparison !== 0) {
          return contextComparison;
        }

        return left.discipline.localeCompare(right.discipline, 'pt-BR', {
          sensitivity: 'base',
        });
      });
  const getAvailableCoverageOptions = (
    aula: AulaItem,
    ignoredCoverageId = '',
  ) => {
    const selectedCoverage = getAulaCoverageItems(aula).filter(
      (coverage) => coverage.id !== ignoredCoverageId,
    );
    const selectedDisciplineKeys = new Set(
      selectedCoverage.map((coverage) =>
        normalizeWorkbookOptionKey(
          coverage.disciplineId || coverage.discipline,
        ),
      ),
    );
    const selectedSpecificArcos = new Set(
      selectedCoverage
        .filter((coverage) => isSpecificDisciplineModule(coverage.module))
        .map((coverage) => normalizeFieldLabel(coverage.arco))
        .filter(Boolean),
    );

    return sortCoverageOptions(
      coverageOptions.filter((option) => {
        const optionKey = normalizeWorkbookOptionKey(
          option.disciplineId || option.discipline,
        );

        if (selectedDisciplineKeys.has(optionKey)) {
          return false;
        }

        return !(
          isSpecificDisciplineModule(option.module) &&
          selectedSpecificArcos.has(normalizeFieldLabel(option.arco))
        );
      }),
    );
  };
  const isDuplicateAulaName = (name: string, ignoredRowIndex = -1) => {
    const nameKey = normalizeWorkbookOptionKey(name);

    if (!nameKey) {
      return false;
    }

    const currentSheet = latestAulasSheetRef.current ?? aulasSheet;

    return Boolean(
      currentSheet?.rows.some((row, rowIndex) => {
        if (rowIndex === ignoredRowIndex) {
          return false;
        }

        return (
          normalizeWorkbookOptionKey(getCellValue(currentSheet, row, AULA_NAME_COLUMN)) ===
          nameKey
        );
      }),
    );
  };

  const rememberWorkbookOption = async (
    type: WorkbookOptionType,
    value: string,
  ) => {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      return;
    }

    setWorkbookOptions((currentOptions) => ({
      ...currentOptions,
      [type]: mergeWorkbookOptionValues(
        currentOptions[type],
        [normalizedValue],
      ),
    }));

    const didPersist = await persistWorkbookOption(type, normalizedValue).catch(
      () => false,
    );

    if (didPersist) {
      const refreshedFile = await fetchBaseWorkbookFile().catch(() => null);

      window.dispatchEvent(
        new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
          detail: refreshedFile ? { file: refreshedFile } : undefined,
        }),
      );
    }
  };

  const saveWorkbookSheetSet = async (sheets: SheetTable[]) => {
    const sourceResponse = await fetch('/api/base-workbook/file', {
      cache: 'no-store',
    });

    if (!sourceResponse.ok) {
      throw new Error('read-failed');
    }

    const sourceFile = await responseToWorkbookFile(
      sourceResponse,
      'DadosElevar.xlsx',
    );
    const { read, utils, write } = await loadXlsx();
    const workbook = read(await sourceFile.arrayBuffer(), {
      cellDates: true,
    });

    sheets.forEach((sheet) => {
      const sheetName =
        workbook.SheetNames.find(
          (name) =>
            normalizeFieldLabel(name) === normalizeFieldLabel(sheet.sheetName),
        ) ?? sheet.sheetName;

      workbook.Sheets[sheetName] = utils.aoa_to_sheet([
        sheet.columns,
        ...sheet.rows,
      ]);

      if (!workbook.SheetNames.includes(sheetName)) {
        workbook.SheetNames.push(sheetName);
      }
    });

    const output = write(workbook, {
      bookType: 'xlsx',
      type: 'array',
    }) as ArrayBuffer;
    const saveResponse = await fetch('/api/base-workbook/file', {
      method: 'PUT',
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: output,
    });

    if (!saveResponse.ok) {
      throw new Error('save-failed');
    }

    const savedFile = await fetchBaseWorkbookFile();

    await persistManagedWorkbookDataIndexes(savedFile);
    window.dispatchEvent(
      new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
        detail: savedFile ? { file: savedFile } : undefined,
      }),
    );

    return savedFile;
  };

  const saveAulasSheet = async (nextSheet: SheetTable) => {
    setAulasSheet(nextSheet);

    const savedFile = await saveWorkbookSheetSet([nextSheet]);
    const savedSheet = savedFile
      ? await readAulasFromFile(savedFile)
      : nextSheet;

    latestAulasSheetRef.current = savedSheet;
    setAulasSheet(savedSheet);

    return savedSheet;
  };

  const saveCoverageSheet = async (nextSheet: SheetTable) => {
    latestCoverageSheetRef.current = nextSheet;
    setCoverageSheet(nextSheet);

    const savedFile = await saveWorkbookSheetSet([nextSheet]);
    const savedSheet = savedFile
      ? await readWorkbookSheetWithFallback(
          savedFile,
          AULAS_DISCIPLINAS_ENTITY_ID,
          AULAS_DISCIPLINAS_WORKBOOK_SHEET,
          AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
        )
      : nextSheet;

    latestCoverageSheetRef.current = savedSheet;
    setCoverageSheet(savedSheet);

    return savedSheet;
  };

  const buildCoverageRow = (
    sheet: SheetTable,
    aula: AulaItem,
    option: AulaCoverageOption,
    id = generateStableRecordId(AULAS_DISCIPLINAS_ENTITY_ID),
  ) =>
    sheet.columns.map((column) => {
      const columnKey = normalizeFieldLabel(column);

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_LESSON_ID_COLUMN)) {
        return aula.id;
      }

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_LESSON_COLUMN)) {
        return aula.name;
      }

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_ARC_COLUMN)) {
        return option.arco;
      }

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_MODULE_COLUMN)) {
        return option.module;
      }

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_DISCIPLINE_COLUMN)) {
        return option.discipline;
      }

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_DISCIPLINE_ID_COLUMN)) {
        return option.disciplineId;
      }

      if (columnKey === normalizeFieldLabel(AULA_COVERAGE_ID_COLUMN)) {
        return id;
      }

      return '';
    });

  const addAulaCoverage = async (aula: AulaItem, option: AulaCoverageOption) => {
    const currentSheet =
      latestCoverageSheetRef.current ??
      coverageSheet ??
      createEmptyWorkbookSheet(
        aulasSheet?.fileName ?? 'DadosElevar.xlsx',
        AULAS_DISCIPLINAS_WORKBOOK_SHEET,
        AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
      );

    if (!aula.name || aula.isDraft) {
      return false;
    }

    const nextRow = buildCoverageRow(currentSheet, aula, option);
    const nextRowIndex = currentSheet.rows.length;
    setDraftCoverageAulaId('');
    const savedSheet = await saveCoverageSheet({
      ...currentSheet,
      rows: [...currentSheet.rows.map((row) => [...row]), nextRow],
    });

    pushGlobalUndoEntry({
      originTab: 'aulas',
      kind: 'aula-coverage-insert',
      itemLabel: aula.name,
      rowIndex: nextRowIndex,
      rowData: nextRow,
      recordId: getCellValue(savedSheet, nextRow, AULA_COVERAGE_ID_COLUMN),
      nextValue: option.discipline,
    });

    return true;
  };

  const updateAulaCoverage = async (
    aula: AulaItem,
    coverage: AulaCoverageItem,
    option: AulaCoverageOption,
  ) => {
    const currentSheet = latestCoverageSheetRef.current ?? coverageSheet;

    if (!currentSheet || !aula.name || aula.isDraft) {
      setEditingCoverageId('');
      return false;
    }

    const optionKey = normalizeWorkbookOptionKey(
      option.disciplineId || option.discipline,
    );
    const currentKey = normalizeWorkbookOptionKey(
      coverage.disciplineId || coverage.discipline,
    );

    if (optionKey && optionKey === currentKey) {
      setEditingCoverageId('');
      return true;
    }

    const idColumnIndex = getColumnIndex(currentSheet, AULA_COVERAGE_ID_COLUMN);
    const currentRowIndex =
      coverage.id && idColumnIndex >= 0
        ? currentSheet.rows.findIndex(
            (row) => String(row[idColumnIndex] ?? '').trim() === coverage.id,
          )
        : coverage.rowIndex;
    const previousRow = currentSheet.rows[currentRowIndex];

    if (currentRowIndex < 0 || !previousRow) {
      setEditingCoverageId('');
      return false;
    }

    const nextRow = buildCoverageRow(currentSheet, aula, option, coverage.id);
    const nextRows = currentSheet.rows.map((row) => [...row]);

    nextRows[currentRowIndex] = nextRow;

    await saveCoverageSheet({
      ...currentSheet,
      rows: nextRows,
    });

    setEditingCoverageId('');

    pushGlobalUndoEntry({
      originTab: 'aulas',
      kind: 'aula-coverage-update',
      itemLabel: aula.name,
      rowIndex: currentRowIndex,
      recordId: coverage.id,
      previousRowData: previousRow,
      nextRowData: nextRow,
      previousValue: coverage.discipline,
      nextValue: option.discipline,
    });

    return true;
  };

  const removeAulaCoverage = async (
    coverage: AulaCoverageItem,
    options: { registerUndo?: boolean } = {},
  ) => {
    const currentSheet = latestCoverageSheetRef.current ?? coverageSheet;

    if (!currentSheet) {
      return false;
    }

    const idColumnIndex = getColumnIndex(currentSheet, AULA_COVERAGE_ID_COLUMN);
    const currentRowIndex =
      coverage.id && idColumnIndex >= 0
        ? currentSheet.rows.findIndex(
            (row) => String(row[idColumnIndex] ?? '').trim() === coverage.id,
          )
        : coverage.rowIndex;
    const deletedRow = currentSheet.rows[currentRowIndex];

    if (currentRowIndex < 0 || !deletedRow) {
      return false;
    }

    await saveCoverageSheet({
      ...currentSheet,
      rows: currentSheet.rows
        .filter((_, rowIndex) => rowIndex !== currentRowIndex)
        .map((row) => [...row]),
    });

    if (options.registerUndo !== false) {
      pushGlobalUndoEntry({
        originTab: 'aulas',
        kind: 'aula-coverage-delete',
        itemLabel: coverage.aulaName || coverage.aulaId,
        rowIndex: currentRowIndex,
        rowData: deletedRow,
        recordId: coverage.id,
        previousValue: coverage.discipline,
      });
    }

    return true;
  };

  const buildAulaRow = (
    sheet: SheetTable,
    seed: Partial<AulaItem> = {},
  ) => {
    const row = Array.from({ length: sheet.columns.length }, () => '');
    const valuesByColumn = new Map([
      [normalizeFieldLabel(AULA_NAME_COLUMN), seed.name ?? 'Nova aula'],
      [
        normalizeFieldLabel(AULA_COLOR_COLUMN),
        normalizeHexColor(seed.color ?? DEFAULT_AULA_COLOR),
      ],
      [
        normalizeFieldLabel(AULA_DEFAULT_INSTRUCTOR_COLUMN),
        seed.defaultInstructor ?? '',
      ],
      [normalizeFieldLabel(AULA_DEFAULT_ROOM_COLUMN), seed.defaultRoom ?? ''],
      [
        normalizeFieldLabel('ID'),
        seed.id ?? generateStableRecordId(AULAS_ENTITY_ID),
      ],
    ]);

    sheet.columns.forEach((column, columnIndex) => {
      row[columnIndex] = valuesByColumn.get(normalizeFieldLabel(column)) ?? '';
    });

    return row;
  };

  const createAulaRow = async (
    seed: Partial<AulaItem> = {},
    options: { registerUndo?: boolean } = {},
  ) => {
    const currentSheet = latestAulasSheetRef.current ?? aulasSheet;

    if (!currentSheet) {
      return null;
    }

    const nextRow = buildAulaRow(currentSheet, seed);
    const nextRowIndex = currentSheet.rows.length;
    const savedSheet = await saveAulasSheet({
      ...currentSheet,
      rows: [...currentSheet.rows.map((row) => [...row]), nextRow],
    });

    if (options.registerUndo !== false) {
      pushGlobalUndoEntry({
        originTab: 'aulas',
        kind: 'row-create',
        rowIndex: nextRowIndex,
        itemLabel:
          seed.name ||
          getCellValue(savedSheet, savedSheet.rows[nextRowIndex] ?? [], AULA_NAME_COLUMN) ||
          `aula#${nextRowIndex + 1}`,
        recordId: getCellValue(savedSheet, savedSheet.rows[nextRowIndex] ?? [], 'ID'),
        rowData: nextRow,
      });
    }

    return {
      rowIndex: nextRowIndex,
      sheet: savedSheet,
    };
  };

  const ensureAulaRow = async (aula: AulaItem) => {
    if (aula.rowIndex >= 0) {
      return aula.rowIndex;
    }

    const createdRow = await createAulaRow(aula, { registerUndo: false });

    return createdRow?.rowIndex ?? -1;
  };

  const updateAulaItemField = async (
    aula: AulaItem,
    columnName: string,
    value: string,
  ) => {
    const rowIndex = await ensureAulaRow(aula);

    return updateAulaField(rowIndex, columnName, value);
  };

  const updateAulaField = async (
    rowIndex: number,
    columnName: string,
    value: string,
    options: { registerUndo?: boolean } = {},
  ) => {
    const currentSheet = latestAulasSheetRef.current ?? aulasSheet;

    if (!currentSheet || rowIndex < 0) {
      return false;
    }

    const columnIndex = getColumnIndex(currentSheet, columnName);

    if (columnIndex < 0) {
      return false;
    }

    const nextValue = value.trim();
    const currentValue = String(currentSheet.rows[rowIndex]?.[columnIndex] ?? '').trim();

    if (currentValue === nextValue) {
      return false;
    }

    const previousRow = currentSheet.rows[rowIndex] ?? [];
    const itemLabel =
      getCellValue(currentSheet, previousRow, AULA_NAME_COLUMN) ||
      getCellValue(currentSheet, previousRow, 'ID') ||
      `aula#${rowIndex + 1}`;
    const recordId = getCellValue(currentSheet, previousRow, 'ID');
    const nextRows = currentSheet.rows.map((row, nextRowIndex) => {
      if (nextRowIndex !== rowIndex) {
        return [...row];
      }

      const nextRow = [...row];

      while (nextRow.length < currentSheet.columns.length) {
        nextRow.push('');
      }

      nextRow[columnIndex] = nextValue;

      return nextRow;
    });

    const savedSheet = await saveAulasSheet({
      ...currentSheet,
      rows: nextRows,
    });

    if (options.registerUndo !== false) {
      pushGlobalUndoEntry({
        originTab: 'aulas',
        kind: 'cell-edit',
        rowIndex,
        columnName,
        previousValue: currentValue,
        nextValue,
        itemLabel,
        recordId,
      });
    }

    return Boolean(savedSheet);
  };

  const updateAulaName = (aula: AulaItem, value: string) =>
    isDuplicateAulaName(value, aula.rowIndex)
      ? Promise.resolve(false)
      : updateAulaItemField(aula, AULA_NAME_COLUMN, value);

  const updateAulaOption = async (
    aula: AulaItem,
    columnName: string,
    optionType: WorkbookOptionType,
    value: string,
  ) => {
    await updateAulaItemField(aula, columnName, value);
    await rememberWorkbookOption(optionType, value);
  };

  const createDraftAula = () => {
    setDraftAula((currentDraft) =>
      currentDraft
        ? currentDraft
        : {
            ...DRAFT_AULA,
            id: `aula-draft-${Date.now()}`,
          },
    );
  };

  const commitDraftAulaName = async (value: string) => {
    const name = value.trim();

    if (!name) {
      setDraftAula(null);
      return;
    }

    if (isDuplicateAulaName(name)) {
      return;
    }

    setDraftAula(null);
    await createAulaRow({
      color: DEFAULT_AULA_COLOR,
      name,
    });
  };

  const deleteAulaAndSave = async (
    aula: AulaItem,
    options: { registerUndo?: boolean } = {},
  ) => {
    if (aula.isDraft) {
      setDraftAula(null);
      return true;
    }

    const currentSheet = latestAulasSheetRef.current ?? aulasSheet;

    if (!currentSheet) {
      return false;
    }

    const idColumnIndex = getColumnIndex(currentSheet, 'ID');
    const currentRowIndex =
      aula.id && idColumnIndex >= 0
        ? currentSheet.rows.findIndex(
            (row) => String(row[idColumnIndex] ?? '').trim() === aula.id,
          )
        : aula.rowIndex;
    const deletedRow = currentSheet.rows[currentRowIndex];

    if (currentRowIndex < 0 || !deletedRow) {
      return false;
    }

    const deletedAulaId = getCellValue(currentSheet, deletedRow, 'ID') || aula.id;
    const deletedAulaName =
      getCellValue(currentSheet, deletedRow, AULA_NAME_COLUMN) || aula.name;
    const sourceFile = await fetchBaseWorkbookFile();

    if (!sourceFile) {
      return false;
    }

    const coverageSheet = await readWorkbookSheetWithFallback(
      sourceFile,
      AULAS_DISCIPLINAS_ENTITY_ID,
      AULAS_DISCIPLINAS_WORKBOOK_SHEET,
      AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
    );
    const cronogramaSheet = await readWorkbookSheetWithFallback(
      sourceFile,
      CRONOGRAMA_ENTITY_ID,
      CRONOGRAMA_WORKBOOK_SHEET,
      CRONOGRAMA_REQUIRED_COLUMNS,
    );
    const matchesReference = (
      sheet: SheetTable,
      row: string[],
      idColumn: string,
      nameColumn: string,
    ) => {
      const rowAulaId = getCellValue(sheet, row, idColumn);
      const rowAulaName = getCellValue(sheet, row, nameColumn);

      return (
        (!!deletedAulaId && rowAulaId === deletedAulaId) ||
        (!rowAulaId &&
          !!deletedAulaName &&
          normalizeWorkbookOptionKey(rowAulaName) ===
            normalizeWorkbookOptionKey(deletedAulaName))
      );
    };
    const deletedCoverageRows = coverageSheet.rows
      .map((row, rowIndex) => ({ rowIndex, row }))
      .filter(({ row }) =>
        matchesReference(
          coverageSheet,
          row,
          AULA_COVERAGE_LESSON_ID_COLUMN,
          AULA_COVERAGE_LESSON_COLUMN,
        ),
      );
    const deletedCronogramaRows = cronogramaSheet.rows
      .map((row, rowIndex) => ({ rowIndex, row }))
      .filter(({ row }) =>
        matchesReference(
          cronogramaSheet,
          row,
          CRONOGRAMA_LESSON_ID_COLUMN,
          CRONOGRAMA_LESSON_COLUMN,
        ),
      );
    const nextAulasSheet = {
      ...currentSheet,
      rows: currentSheet.rows
        .filter((_, rowIndex) => rowIndex !== currentRowIndex)
        .map((row) => [...row]),
    };
    const nextCoverageSheet = {
      ...coverageSheet,
      rows: coverageSheet.rows.filter(
        (_row, rowIndex) =>
          !deletedCoverageRows.some((deleted) => deleted.rowIndex === rowIndex),
      ),
    };
    const nextCronogramaSheet = {
      ...cronogramaSheet,
      rows: cronogramaSheet.rows.filter(
        (_row, rowIndex) =>
          !deletedCronogramaRows.some((deleted) => deleted.rowIndex === rowIndex),
      ),
    };

    latestAulasSheetRef.current = nextAulasSheet;
    setAulasSheet(nextAulasSheet);
    setAulaDeleteConfirmation(null);

    const savedFile = await saveWorkbookSheetSet([
      nextAulasSheet,
      nextCoverageSheet,
      nextCronogramaSheet,
    ]);
    const savedAulasSheet = savedFile
      ? await readAulasFromFile(savedFile)
      : nextAulasSheet;

    latestAulasSheetRef.current = savedAulasSheet;
    setAulasSheet(savedAulasSheet);

    if (options.registerUndo !== false) {
      pushGlobalUndoEntry({
        originTab: 'aulas',
        kind: 'row-delete',
        rowIndex: currentRowIndex,
        rowData: deletedRow,
        itemLabel: deletedAulaName || deletedAulaId || `aula#${currentRowIndex + 1}`,
        recordId: deletedAulaId,
        coverageRows: deletedCoverageRows,
        cronogramaRows: deletedCronogramaRows,
      });
    }

    return true;
  };

  const applyAulaUndoEntry = async (
    entry: GlobalUndoEntry,
    valueKey: 'previousValue' | 'nextValue',
  ) => {
    if (entry.originTab !== 'aulas') {
      return false;
    }

    const normalizeStoredRows = (value: unknown) =>
      Array.isArray(value)
        ? value
            .map((item) => {
              if (
                typeof item !== 'object' ||
                item === null ||
                typeof (item as { rowIndex?: unknown }).rowIndex !== 'number' ||
                !Array.isArray((item as { row?: unknown }).row)
              ) {
                return null;
              }

              return {
                rowIndex: (item as { rowIndex: number }).rowIndex,
                row: (item as { row: unknown[] }).row.map((cell) =>
                  String(cell ?? ''),
                ),
              };
            })
            .filter(
              (
                item,
              ): item is {
                rowIndex: number;
                row: string[];
              } => Boolean(item),
            )
        : [];
    const normalizeStoredRow = (value: unknown) =>
      Array.isArray(value) ? value.map((cell) => String(cell ?? '')) : null;
    const insertStoredRows = (
      rows: string[][],
      storedRows: { rowIndex: number; row: string[] }[],
    ) => {
      const nextRows = rows.map((row) => [...row]);

      storedRows
        .slice()
        .sort((left, right) => left.rowIndex - right.rowIndex)
        .forEach(({ rowIndex, row }) => {
          nextRows.splice(clampNumber(rowIndex, 0, nextRows.length), 0, [...row]);
        });

      return nextRows;
    };
    const removeStoredRows = (
      sheet: SheetTable,
      storedRows: { rowIndex: number; row: string[] }[],
    ) => {
      const idColumnIndex = getColumnIndex(sheet, 'ID');
      const storedIds = new Set(
        storedRows
          .map(({ row }) =>
            idColumnIndex >= 0 ? String(row[idColumnIndex] ?? '').trim() : '',
          )
          .filter(Boolean),
      );
      const storedKeys = new Set(
        storedRows.map(({ row }) => row.map((cell) => cell.trim()).join('\u001f')),
      );

      return sheet.rows.filter((row) => {
        const rowId =
          idColumnIndex >= 0 ? String(row[idColumnIndex] ?? '').trim() : '';

        if (rowId && storedIds.has(rowId)) {
          return false;
        }

        return !storedKeys.has(row.map((cell) => cell.trim()).join('\u001f'));
      });
    };

    if (
      entry.kind === 'aula-coverage-insert' ||
      entry.kind === 'aula-coverage-delete'
    ) {
      const rowData = normalizeStoredRow(entry.rowData);
      const sourceFile = await fetchBaseWorkbookFile();

      if (!rowData || !sourceFile) {
        return false;
      }

      const currentCoverageSheet =
        latestCoverageSheetRef.current ??
        (await readWorkbookSheetWithFallback(
          sourceFile,
          AULAS_DISCIPLINAS_ENTITY_ID,
          AULAS_DISCIPLINAS_WORKBOOK_SHEET,
          AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
        ));
      const rowIndex = typeof entry.rowIndex === 'number' ? entry.rowIndex : -1;
      const storedRows = [{ rowIndex, row: rowData }];
      const shouldInsert =
        (entry.kind === 'aula-coverage-insert' && valueKey === 'nextValue') ||
        (entry.kind === 'aula-coverage-delete' && valueKey === 'previousValue');
      const nextCoverageSheet = {
        ...currentCoverageSheet,
        rows: shouldInsert
          ? insertStoredRows(currentCoverageSheet.rows, storedRows)
          : removeStoredRows(currentCoverageSheet, storedRows),
      };

      await saveCoverageSheet(nextCoverageSheet);

      return true;
    }

    if (entry.kind === 'aula-coverage-update') {
      const previousRowData = normalizeStoredRow(entry.previousRowData);
      const nextRowData = normalizeStoredRow(entry.nextRowData);
      const rowData = valueKey === 'previousValue' ? previousRowData : nextRowData;
      const sourceFile = await fetchBaseWorkbookFile();

      if (!rowData || !sourceFile) {
        return false;
      }

      const currentCoverageSheet =
        latestCoverageSheetRef.current ??
        (await readWorkbookSheetWithFallback(
          sourceFile,
          AULAS_DISCIPLINAS_ENTITY_ID,
          AULAS_DISCIPLINAS_WORKBOOK_SHEET,
          AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
        ));
      const recordId = typeof entry.recordId === 'string' ? entry.recordId : '';
      const rowIndex = typeof entry.rowIndex === 'number' ? entry.rowIndex : -1;
      const idColumnIndex = getColumnIndex(
        currentCoverageSheet,
        AULA_COVERAGE_ID_COLUMN,
      );
      const currentRowIndex =
        recordId && idColumnIndex >= 0
          ? currentCoverageSheet.rows.findIndex(
              (row) => String(row[idColumnIndex] ?? '').trim() === recordId,
            )
          : rowIndex;

      if (currentRowIndex < 0) {
        return false;
      }

      const nextRows = currentCoverageSheet.rows.map((row) => [...row]);

      nextRows[currentRowIndex] = rowData.slice(
        0,
        currentCoverageSheet.columns.length,
      );

      await saveCoverageSheet({
        ...currentCoverageSheet,
        rows: nextRows,
      });

      return true;
    }

    if (entry.kind === 'row-create') {
      const currentSheet = latestAulasSheetRef.current ?? aulasSheet;

      if (!currentSheet) {
        return false;
      }

      const recordId = typeof entry.recordId === 'string' ? entry.recordId : '';
      const rowIndex = typeof entry.rowIndex === 'number' ? entry.rowIndex : -1;
      const idColumnIndex = getColumnIndex(currentSheet, 'ID');
      const currentRowIndex =
        recordId && idColumnIndex >= 0
          ? currentSheet.rows.findIndex(
              (row) => String(row[idColumnIndex] ?? '').trim() === recordId,
            )
          : rowIndex;

      if (valueKey === 'previousValue') {
        if (currentRowIndex < 0) {
          return false;
        }

        await saveAulasSheet({
          ...currentSheet,
          rows: currentSheet.rows
            .filter((_, nextRowIndex) => nextRowIndex !== currentRowIndex)
            .map((row) => [...row]),
        });

        return true;
      }

      if (currentRowIndex >= 0) {
        return false;
      }

      const rowData = Array.isArray(entry.rowData)
        ? entry.rowData.map((cell) => String(cell ?? ''))
        : null;

      if (!rowData) {
        return false;
      }

      const nextRows = currentSheet.rows.map((row) => [...row]);
      nextRows.splice(
        clampNumber(rowIndex, 0, nextRows.length),
        0,
        rowData.slice(0, currentSheet.columns.length),
      );

      await saveAulasSheet({
        ...currentSheet,
        rows: nextRows,
      });

      return true;
    }

    if (entry.kind === 'row-delete') {
      const rowData = normalizeStoredRow(entry.rowData);
      const sourceFile = await fetchBaseWorkbookFile();

      if (!rowData || !sourceFile) {
        return false;
      }

      const currentAulasSheet =
        latestAulasSheetRef.current ?? (await readAulasFromFile(sourceFile));
      const coverageSheet = await readWorkbookSheetWithFallback(
        sourceFile,
        AULAS_DISCIPLINAS_ENTITY_ID,
        AULAS_DISCIPLINAS_WORKBOOK_SHEET,
        AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
      );
      const cronogramaSheet = await readWorkbookSheetWithFallback(
        sourceFile,
        CRONOGRAMA_ENTITY_ID,
        CRONOGRAMA_WORKBOOK_SHEET,
        CRONOGRAMA_REQUIRED_COLUMNS,
      );
      const coverageRows = normalizeStoredRows(entry.coverageRows);
      const cronogramaRows = normalizeStoredRows(entry.cronogramaRows);
      const rowIndex = typeof entry.rowIndex === 'number' ? entry.rowIndex : -1;
      const deletedAulaRows = [{ rowIndex, row: rowData }];
      const nextAulasSheet = {
        ...currentAulasSheet,
        rows:
          valueKey === 'previousValue'
            ? insertStoredRows(currentAulasSheet.rows, deletedAulaRows)
            : removeStoredRows(currentAulasSheet, deletedAulaRows),
      };
      const nextCoverageSheet = {
        ...coverageSheet,
        rows:
          valueKey === 'previousValue'
            ? insertStoredRows(coverageSheet.rows, coverageRows)
            : removeStoredRows(coverageSheet, coverageRows),
      };
      const nextCronogramaSheet = {
        ...cronogramaSheet,
        rows:
          valueKey === 'previousValue'
            ? insertStoredRows(cronogramaSheet.rows, cronogramaRows)
            : removeStoredRows(cronogramaSheet, cronogramaRows),
      };

      latestAulasSheetRef.current = nextAulasSheet;
      setAulasSheet(nextAulasSheet);
      const savedFile = await saveWorkbookSheetSet([
        nextAulasSheet,
        nextCoverageSheet,
        nextCronogramaSheet,
      ]);
      const savedAulasSheet = savedFile
        ? await readAulasFromFile(savedFile)
        : nextAulasSheet;

      latestAulasSheetRef.current = savedAulasSheet;
      setAulasSheet(savedAulasSheet);

      return true;
    }

    if (entry.kind !== 'cell-edit') {
      return false;
    }

    const rowIndex = typeof entry.rowIndex === 'number' ? entry.rowIndex : -1;
    const columnName = typeof entry.columnName === 'string' ? entry.columnName : '';
    const value = typeof entry[valueKey] === 'string' ? entry[valueKey] : '';

    return updateAulaField(rowIndex, columnName, value, {
      registerUndo: false,
    });
  };

  useEffect(
    () =>
      registerGlobalUndoController('aulas', {
        undo: (entry) => applyAulaUndoEntry(entry, 'previousValue'),
        redo: (entry) => applyAulaUndoEntry(entry, 'nextValue'),
      }),
    [],
  );

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

        const file = changedFile ?? (await fetchAulasWorkbookFile());

        if (!isMounted) {
          return;
        }

        if (!file) {
          setAulasSheet(null);
          setCoverageSheet(null);
          setArcosSheet(null);
          setDisciplinasSheet(null);
          setHasActiveWorkbook(false);
          setHasCheckedWorkbook(true);
          return;
        }

        const {
          arcosSheet: nextArcosSheet,
          aulasSheet: nextAulasSheet,
          coverageSheet: nextCoverageSheet,
          disciplinasSheet: nextDisciplinasSheet,
          workbookOptions: nextWorkbookOptions,
        } = await readAulasWorkbookBundle(file);

        if (!isMounted) {
          return;
        }

        setAulasSheet(nextAulasSheet);
        setCoverageSheet(nextCoverageSheet);
        setArcosSheet(nextArcosSheet);
        setDisciplinasSheet(nextDisciplinasSheet);
        setWorkbookOptions(nextWorkbookOptions);
        setHasActiveWorkbook(true);
        setHasCheckedWorkbook(true);
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
              aulasSheet: nextAulasSheet,
              coverageSheet: nextCoverageSheet,
              disciplinasSheet: nextDisciplinasSheet,
              workbookOptions: nextWorkbookOptions,
            } = await readAulasWorkbookBundle(retryFile);

            if (!isMounted) {
              return;
            }

            setAulasSheet(nextAulasSheet);
            setCoverageSheet(nextCoverageSheet);
            setArcosSheet(nextArcosSheet);
            setDisciplinasSheet(nextDisciplinasSheet);
            setWorkbookOptions(nextWorkbookOptions);
            setHasActiveWorkbook(true);
            setHasCheckedWorkbook(true);
            return;
          } catch {
            // Keep the current visible workbook state below if one already exists.
          }
        }

        if (
          latestAulasSheetRef.current ||
          latestCoverageSheetRef.current ||
          latestArcosSheetRef.current ||
          latestDisciplinasSheetRef.current
        ) {
          setHasActiveWorkbook(true);
          setHasCheckedWorkbook(true);
          return;
        }

        const fallbackSheet = createEmptyAulasSheet();
        setAulasSheet(fallbackSheet);
        setCoverageSheet(
          createEmptyWorkbookSheet(
            fallbackSheet.fileName,
            AULAS_DISCIPLINAS_WORKBOOK_SHEET,
            AULAS_DISCIPLINAS_REQUIRED_COLUMNS,
          ),
        );
        setArcosSheet(
          createEmptyWorkbookSheet(
            fallbackSheet.fileName,
            'Arcos',
            ARCOS_REQUIRED_COLUMNS,
          ),
        );
        setDisciplinasSheet(
          createEmptyWorkbookSheet(
            fallbackSheet.fileName,
            'Disciplinas',
            DISCIPLINAS_REQUIRED_COLUMNS,
          ),
        );
        setWorkbookOptions(emptyWorkbookOptions());
        setHasActiveWorkbook(true);
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

  const shouldShowImportState = hasCheckedWorkbook && !hasActiveWorkbook;
  const shouldShowAulasBoard = hasCheckedWorkbook && hasActiveWorkbook;
  const titleId = 'aulas-title';
  const listedAulas = draftAula ? [...aulas, draftAula] : aulas;
  const shouldShowCreateLabel = aulas.length === 0 && !draftAula;

  return (
    <section
      className="feature-page aulas-page"
      aria-labelledby={titleId}
      data-active={isActive ? 'true' : 'false'}
    >
      <h1 className="visually-hidden" id={titleId}>
        Aulas
      </h1>

      {shouldShowImportState && <EmptyWorkbookImportState />}

      {shouldShowAulasBoard && (
        <div className="data-table-panel aulas-data-panel">
          <div className="data-table-frame aulas-board-frame">
            <div className="aulas-board" role="region" tabIndex={0}>
              <div className="aulas-list-column" role="list">
                {listedAulas.map((aula) => {
                  const aulaCoverageItems = getAulaCoverageItems(aula);
                  const availableCoverageOptions =
                    getAvailableCoverageOptions(aula);
                  const shouldShowCoverageStrip =
                    aulaCoverageItems.length > 0 ||
                    draftCoverageAulaId === aula.id;

                  return (
                    <div className="aula-list-row" key={aula.id}>
                      <AulaCard
                        aula={aula}
                        autoEditName={Boolean(aula.isDraft)}
                        instructorOptions={instructorOptions}
                        onChangeColor={async (value) => {
                          if (!aula.isDraft) {
                            await updateAulaItemField(aula, AULA_COLOR_COLUMN, value);
                          }
                        }}
                        onChangeInstructor={(value) =>
                          aula.isDraft
                            ? undefined
                            : updateAulaOption(
                                aula,
                                AULA_DEFAULT_INSTRUCTOR_COLUMN,
                                'instrutor',
                                value,
                              )
                        }
                        onChangeName={async (value) => {
                          if (aula.isDraft) {
                            await commitDraftAulaName(value);
                            return;
                          }

                          await updateAulaName(aula, value);
                        }}
                        onRequestDelete={() => {
                          if (aula.isDraft) {
                            setDraftAula(null);
                            return;
                          }

                          setAulaDeleteConfirmation({ aula });
                        }}
                        onChangeRoom={(value) =>
                          aula.isDraft
                            ? undefined
                            : updateAulaOption(
                                aula,
                                AULA_DEFAULT_ROOM_COLUMN,
                                'sala',
                                value,
                              )
                        }
                        roomOptions={roomOptions}
                      />
                      {!aula.isDraft && (
                        <button
                          className="aula-coverage-add-button"
                          type="button"
                          aria-label="Adicionar disciplina"
                          title="Adicionar Disciplina"
                          onClick={() => {
                            setEditingCoverageId('');
                            setDraftCoverageAulaId(aula.id);
                          }}
                        >
                          <NewSectionIcon />
                        </button>
                      )}
                      {!aula.isDraft && shouldShowCoverageStrip && (
                        <AulaCoverageStrip
                          availableOptions={availableCoverageOptions}
                          coverageItems={aulaCoverageItems}
                          editingCoverageId={editingCoverageId}
                          getContextLabel={getCoverageContextLabel}
                          getEditOptions={(coverage) =>
                            getAvailableCoverageOptions(aula, coverage.id)
                          }
                          isDraftActive={draftCoverageAulaId === aula.id}
                          onAddCoverage={(option) => addAulaCoverage(aula, option)}
                          onCancelDraft={() => setDraftCoverageAulaId('')}
                          onCancelEdit={() => setEditingCoverageId('')}
                          onRemoveCoverage={(coverage) =>
                            removeAulaCoverage(coverage)
                          }
                          onStartEdit={(coverage) => {
                            setDraftCoverageAulaId('');
                            setEditingCoverageId(coverage.id);
                          }}
                          onUpdateCoverage={(coverage, option) =>
                            updateAulaCoverage(aula, coverage, option)
                          }
                        />
                      )}
                    </div>
                  );
                })}
                <div className="aula-create-row">
                  <button
                    className={
                      shouldShowCreateLabel
                        ? 'aula-create-button with-label'
                        : 'aula-create-button'
                    }
                    type="button"
                    aria-label="Criar aula"
                    title="Criar Aula"
                    onClick={() => {
                      createDraftAula();
                    }}
                  >
                    <SquarePlusIcon />
                    {shouldShowCreateLabel && (
                      <span className="aula-create-label">Criar Aula</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {aulaDeleteConfirmation && (
        <div
          className="page-modal-backdrop"
          role="presentation"
          onMouseDown={() => setAulaDeleteConfirmation(null)}
        >
          <div
            className="recovery-dialog aula-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aula-delete-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="recovery-dialog-header">
              <h2 id="aula-delete-dialog-title">Confirmar ação</h2>
              <button
                className="dialog-close-button"
                type="button"
                aria-label="Fechar"
                onClick={() => setAulaDeleteConfirmation(null)}
              >
                <DeleteIcon />
              </button>
            </div>
            <p>
              Você está prestes a deletar a aula{' '}
              {aulaDeleteConfirmation.aula.name || 'sem nome'}.
            </p>
            <button
              className="primary-action recovery-confirm-action aula-delete-confirm-action"
              type="button"
              onClick={() =>
                void deleteAulaAndSave(aulaDeleteConfirmation.aula)
              }
            >
              <DeleteIcon />
              Deletar aula
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

type AulaCardProps = {
  aula: AulaItem;
  autoEditName?: boolean;
  instructorOptions: string[];
  onChangeColor: (value: string) => void | Promise<void>;
  onChangeInstructor: (value: string) => void | Promise<void>;
  onChangeName: (value: string) => void | Promise<void>;
  onRequestDelete: () => void;
  onChangeRoom: (value: string) => void | Promise<void>;
  roomOptions: string[];
};

type AulaCoverageStripProps = {
  availableOptions: AulaCoverageOption[];
  coverageItems: AulaCoverageItem[];
  editingCoverageId: string;
  getContextLabel: (coverage: { arco: string; module: string }) => string;
  getEditOptions: (coverage: AulaCoverageItem) => AulaCoverageOption[];
  isDraftActive: boolean;
  onAddCoverage: (option: AulaCoverageOption) => void | Promise<boolean>;
  onCancelDraft: () => void;
  onCancelEdit: () => void;
  onRemoveCoverage: (coverage: AulaCoverageItem) => void | Promise<boolean>;
  onStartEdit: (coverage: AulaCoverageItem) => void;
  onUpdateCoverage: (
    coverage: AulaCoverageItem,
    option: AulaCoverageOption,
  ) => void | Promise<boolean>;
};

function AulaCoverageStrip({
  availableOptions,
  coverageItems,
  editingCoverageId,
  getContextLabel,
  getEditOptions,
  isDraftActive,
  onAddCoverage,
  onCancelDraft,
  onCancelEdit,
  onRemoveCoverage,
  onStartEdit,
  onUpdateCoverage,
}: AulaCoverageStripProps) {
  return (
    <div className="aula-coverage-strip">
      {coverageItems.map((coverage) =>
        editingCoverageId === coverage.id ? (
          <AulaCoverageDraft
            getContextLabel={getContextLabel}
            key={coverage.id}
            options={getEditOptions(coverage)}
            onCancel={onCancelEdit}
            onRemove={() => onRemoveCoverage(coverage)}
            onSelect={(option) => onUpdateCoverage(coverage, option)}
          />
        ) : (
          <AulaCoverageChip
            coverage={coverage}
            contextLabel={getContextLabel(coverage)}
            key={coverage.id}
            onEdit={() => onStartEdit(coverage)}
          />
        ),
      )}
      {isDraftActive ? (
        <AulaCoverageDraft
          getContextLabel={getContextLabel}
          options={availableOptions}
          onCancel={onCancelDraft}
          onRemove={onCancelDraft}
          onSelect={onAddCoverage}
        />
      ) : null}
    </div>
  );
}

function AulaCoverageChip({
  contextLabel,
  coverage,
  onEdit,
}: {
  contextLabel: string;
  coverage: AulaCoverageItem;
  onEdit: () => void;
}) {
  const label = `${contextLabel}\u00a0\u00a0|\u00a0\u00a0${coverage.discipline}`;
  const fieldRef = useRef<HTMLSpanElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const [isExpandable, setIsExpandable] = useState(false);

  useLayoutEffect(() => {
    const fieldElement = fieldRef.current;
    const labelElement = labelRef.current;

    if (!fieldElement || !labelElement) {
      return;
    }

    const updateExpandableState = () => {
      const fieldStyle = window.getComputedStyle(fieldElement);
      const labelStyle = window.getComputedStyle(labelElement);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        setIsExpandable(labelElement.scrollWidth > labelElement.clientWidth + 1);
        return;
      }

      const horizontalPadding =
        Number.parseFloat(fieldStyle.paddingLeft) +
        Number.parseFloat(fieldStyle.paddingRight) +
        Number.parseFloat(fieldStyle.borderLeftWidth) +
        Number.parseFloat(fieldStyle.borderRightWidth);
      const availableWidth = Math.max(0, fieldElement.clientWidth - horizontalPadding);

      context.font = labelStyle.font;
      setIsExpandable(context.measureText(label).width > availableWidth + 1);
    };

    updateExpandableState();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateExpandableState);

      return () => {
        window.removeEventListener('resize', updateExpandableState);
      };
    }

    const resizeObserver = new ResizeObserver(updateExpandableState);
    resizeObserver.observe(fieldElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [label]);

  return (
    <span className="aula-coverage-chip">
      <span
        className={
          isExpandable
            ? 'aula-coverage-name expandable'
            : 'aula-coverage-name'
        }
        ref={fieldRef}
        role="button"
        tabIndex={0}
        onClick={onEdit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onEdit();
          }
        }}
      >
        <span className="aula-coverage-label-text" ref={labelRef}>
          {label}
        </span>
      </span>
    </span>
  );
}

function AulaCoverageDraft({
  getContextLabel,
  options,
  onCancel,
  onRemove,
  onSelect,
}: {
  getContextLabel: (coverage: { arco: string; module: string }) => string;
  options: AulaCoverageOption[];
  onCancel: () => void;
  onRemove: () => void | Promise<boolean>;
  onSelect: (option: AulaCoverageOption) => void | Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chipRef = useRef<HTMLSpanElement | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const normalizedSearch = normalizeWorkbookOptionKey(searchValue);
  const visibleOptions = normalizedSearch
    ? options.filter((option) =>
        normalizeWorkbookOptionKey(option.discipline).includes(normalizedSearch),
      )
    : options;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const chipElement = chipRef.current;
    const inputElement = inputRef.current;

    if (!chipElement || !inputElement) {
      return;
    }

    const computedStyle = window.getComputedStyle(inputElement);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      setEditWidth(chipElement.clientWidth);
      return;
    }

    context.font = computedStyle.font;

    const horizontalPadding =
      Number.parseFloat(computedStyle.paddingLeft) +
      Number.parseFloat(computedStyle.paddingRight) +
      Number.parseFloat(computedStyle.borderLeftWidth) +
      Number.parseFloat(computedStyle.borderRightWidth) +
      18;
    const measuredTextWidth = context.measureText(searchValue || ' ').width;

    setEditWidth(
      Math.max(chipElement.clientWidth, Math.ceil(measuredTextWidth + horizontalPadding)),
    );
  }, [searchValue]);

  return (
    <span
      className="aula-coverage-chip aula-coverage-chip-draft"
      ref={chipRef}
      style={
        editWidth
          ? ({ '--aula-coverage-edit-width': `${editWidth}px` } as CSSProperties)
          : undefined
      }
    >
      <span className="aula-coverage-name editing">
        <input
          ref={inputRef}
          aria-label="Selecionar disciplina"
          value={searchValue}
          onBlur={onCancel}
          onChange={(event) => setSearchValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }

            if (event.key === 'Enter' && visibleOptions.length === 1) {
              event.preventDefault();
              void onSelect(visibleOptions[0]);
            }
          }}
        />
        <button
          className="aula-coverage-edit-remove"
          type="button"
          aria-label="Remover disciplina"
          title="Remover Disciplina"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void onRemove()}
        >
          <DeleteIcon />
        </button>
        <span className="aula-coverage-dropdown" role="listbox">
          {visibleOptions.length > 0 ? (
            visibleOptions.map((option) => (
              <button
                className="aula-coverage-option"
                key={`${option.disciplineId}-${option.arco}`}
                type="button"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void onSelect(option)}
              >
                <span className="aula-coverage-name">
                  <span className="aula-coverage-label-text">
                    {getContextLabel(option)}
                    {'\u00a0\u00a0|\u00a0\u00a0'}
                    {option.discipline}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <span className="aula-coverage-empty-option">
              Nenhuma disciplina encontrada
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

function AulaCard({
  aula,
  autoEditName = false,
  instructorOptions,
  onChangeColor,
  onChangeInstructor,
  onChangeName,
  onRequestDelete,
  onChangeRoom,
  roomOptions,
}: AulaCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const pendingNativeColorRef = useRef<string | null>(null);
  const [isColorPopupOpen, setIsColorPopupOpen] = useState(false);
  const [colorPopupStyle, setColorPopupStyle] = useState<CSSProperties>({});
  const [baseColor, setBaseColor] = useState(() =>
    normalizeHexColor(aula.color || DEFAULT_AULA_COLOR),
  );
  const [colorHistory, setColorHistory] = useState(readAulaColorHistory);
  const style = {
    '--aula-color': baseColor,
  } as CSSProperties;

  useEffect(() => {
    setBaseColor(normalizeHexColor(aula.color || DEFAULT_AULA_COLOR));
  }, [aula.color]);

  const commitColorToHistory = (color: string) => {
    const normalizedColor = normalizeHexColor(color);
    setBaseColor(normalizedColor);
    setColorHistory((currentHistory) =>
      addAulaColorHistoryEntry(normalizedColor, currentHistory),
    );
    void onChangeColor(normalizedColor);
  };

  const commitPendingNativeColor = () => {
    const pendingColor = pendingNativeColorRef.current;

    if (!pendingColor) {
      return;
    }

    pendingNativeColorRef.current = null;
    commitColorToHistory(pendingColor);
  };

  const closeColorPopup = () => {
    commitPendingNativeColor();
    setIsColorPopupOpen(false);
  };

  const getColorPopupPosition = () => {
    const cardElement = cardRef.current;

    if (!cardElement || typeof window === 'undefined') {
      return {
        left: AULA_COLOR_POPUP_EDGE_GAP,
        top: AULA_COLOR_POPUP_EDGE_GAP,
        width: AULA_COLOR_POPUP_WIDTH,
      } satisfies CSSProperties;
    }

    const cardRect = cardElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rightSideLeft = cardRect.right + AULA_COLOR_POPUP_GAP;
    const leftSideLeft =
      cardRect.left - AULA_COLOR_POPUP_WIDTH - AULA_COLOR_POPUP_GAP;
    const hasRightSpace =
      rightSideLeft + AULA_COLOR_POPUP_WIDTH <=
      viewportWidth - AULA_COLOR_POPUP_EDGE_GAP;
    const hasLeftSpace = leftSideLeft >= AULA_COLOR_POPUP_EDGE_GAP;
    const left = hasRightSpace
      ? rightSideLeft
      : hasLeftSpace
        ? leftSideLeft
        : clampNumber(
            rightSideLeft,
            AULA_COLOR_POPUP_EDGE_GAP,
            viewportWidth - AULA_COLOR_POPUP_WIDTH - AULA_COLOR_POPUP_EDGE_GAP,
          );
    const top = clampNumber(
      cardRect.top,
      AULA_COLOR_POPUP_EDGE_GAP,
      viewportHeight - AULA_COLOR_POPUP_HEIGHT - AULA_COLOR_POPUP_EDGE_GAP,
    );

    return {
      left,
      top,
      width: AULA_COLOR_POPUP_WIDTH,
    } satisfies CSSProperties;
  };

  const updateColorPopupPosition = () => {
    setColorPopupStyle(getColorPopupPosition());
  };

  useEffect(() => {
    if (!isColorPopupOpen) {
      return;
    }

    updateColorPopupPosition();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) {
        closeColorPopup();
      }
    };

    const updatePosition = () => updateColorPopupPosition();

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isColorPopupOpen]);

  return (
    <article
      className="aula-list-card"
      ref={cardRef}
      role="listitem"
      style={style}
    >
      <button
        className="aula-color-button"
        type="button"
        aria-label={`Editar cor de ${aula.name}`}
        title="Cor"
        aria-expanded={isColorPopupOpen}
        onClick={() => {
          if (isColorPopupOpen) {
            closeColorPopup();
            return;
          }

          setColorPopupStyle(getColorPopupPosition());
          setIsColorPopupOpen(true);
        }}
      >
        <ColorPickerIcon />
      </button>
      {isColorPopupOpen && (
        <div
          className="aula-color-popup"
          role="dialog"
          aria-label={`Cor de ${aula.name}`}
          style={colorPopupStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="aula-color-history" aria-label="Cores recentes">
            {Array.from({ length: AULA_COLOR_HISTORY_LIMIT + 1 }, (_, index) => {
              if (index === AULA_COLOR_HISTORY_LIMIT) {
                return (
                  <label
                    className="aula-color-history-swatch add-color"
                    key="add-color"
                    aria-label="Adicionar cor"
                    title="Adicionar cor"
                  >
                    <input
                      className="aula-native-color-input"
                      aria-label="Adicionar cor"
                      type="color"
                      value={baseColor}
                      onChange={(event) => {
                        const nextColor = normalizeHexColor(event.target.value);
                        pendingNativeColorRef.current = nextColor;
                        setBaseColor(nextColor);
                      }}
                      onBlur={commitPendingNativeColor}
                    />
                    <PlusIcon />
                  </label>
                );
              }

              const color = colorHistory[index];

              return (
                <button
                  className="aula-color-history-swatch"
                  key={`${color ?? 'empty'}-${index}`}
                  type="button"
                  aria-label={color ? `Usar cor ${color}` : 'Cor vazia'}
                  disabled={!color}
                  style={
                    {
                      '--aula-history-color': color ?? 'transparent',
                    } as CSSProperties
                  }
                  onClick={() => {
                    if (color) {
                      pendingNativeColorRef.current = null;
                      commitColorToHistory(color);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
      <button
        className="aula-delete-button"
        type="button"
        aria-label={`Excluir ${aula.name}`}
        title="Excluir"
        onClick={onRequestDelete}
      >
        <DeleteIcon />
      </button>
      <EditableOptionField
        className="aula-room-field"
        ariaLabel={`Sala padrão de ${aula.name}`}
        fallback="-"
        options={roomOptions}
        title="Sala padrão"
        value={aula.defaultRoom}
        onCommit={onChangeRoom}
      />
      <EditableAulaName
        autoEdit={autoEditName}
        name={aula.name}
        onCommit={onChangeName}
      />
      <EditableOptionField
        className="aula-instructor-field"
        displayValue={formatCompactPersonName(aula.defaultInstructor)}
        ariaLabel={`Instrutor padrão de ${aula.name}`}
        fallback="-"
        options={instructorOptions}
        title="Instrutor padrão"
        value={aula.defaultInstructor}
        onCommit={onChangeInstructor}
      />
    </article>
  );
}

function EditableAulaName({
  autoEdit = false,
  name,
  onCommit,
}: {
  autoEdit?: boolean;
  name: string;
  onCommit: (value: string) => void | Promise<void>;
}) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(name);
  const [editWidth, setEditWidth] = useState<number | null>(null);

  useEffect(() => {
    if (autoEdit) {
      setIsEditing(true);
    }
  }, [autoEdit]);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(name);
      setEditWidth(null);
    }
  }, [isEditing, name]);

  useLayoutEffect(() => {
    if (!isEditing) {
      return;
    }

    const wrapElement = wrapRef.current;
    const inputElement = inputRef.current;

    if (!wrapElement || !inputElement) {
      return;
    }

    const computedStyle = window.getComputedStyle(inputElement);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      setEditWidth(wrapElement.clientWidth);
      return;
    }

    context.font = computedStyle.font;

    const horizontalPadding =
      Number.parseFloat(computedStyle.paddingLeft) +
      Number.parseFloat(computedStyle.paddingRight) +
      Number.parseFloat(computedStyle.borderLeftWidth) +
      Number.parseFloat(computedStyle.borderRightWidth) +
      10;
    const measuredTextWidth = context.measureText(draftValue || ' ').width;
    const neededWidth = Math.ceil(measuredTextWidth + horizontalPadding);

    setEditWidth(Math.max(wrapElement.clientWidth, neededWidth));
  }, [draftValue, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const inputElement = inputRef.current;

    if (!inputElement) {
      return;
    }

    inputElement.focus();
    inputElement.setSelectionRange(
      inputElement.value.length,
      inputElement.value.length,
    );
  }, [isEditing]);

  const commit = () => {
    setIsEditing(false);
    void onCommit(draftValue.trim());
  };

  if (isEditing) {
    return (
      <span
        className="aula-name-wrap editing"
        ref={wrapRef}
        style={
          editWidth
            ? ({ '--aula-name-edit-width': `${editWidth}px` } as CSSProperties)
            : undefined
        }
      >
        <input
          className="aula-name-input"
          ref={inputRef}
          aria-label="Nome da aula"
          value={draftValue}
          onBlur={commit}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              setDraftValue(name);
              setIsEditing(false);
            }
          }}
        />
      </span>
    );
  }

  return (
    <AulaName
      name={name || 'Selecionar aula'}
      onClick={() => setIsEditing(true)}
    />
  );
}

function AulaName({
  name,
  onClick,
}: {
  name: string;
  onClick?: () => void;
}) {
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

  const className = [
    'aula-name-wrap',
    isExpandable ? 'expandable' : '',
    onClick ? 'editable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={className}
      ref={wrapRef}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }

        event.preventDefault();
        onClick();
      }}
    >
      <span className="aula-name" ref={textRef}>
        {name}
      </span>
    </span>
  );
}

function EditableOptionField({
  ariaLabel,
  className,
  displayValue,
  fallback,
  options,
  title,
  value,
  onCommit,
}: {
  ariaLabel: string;
  className: string;
  displayValue?: string;
  fallback: string;
  options: string[];
  title: string;
  value: string;
  onCommit: (value: string) => void | Promise<void>;
}) {
  const fieldRef = useRef<HTMLSpanElement | HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [expandedWidth, setExpandedWidth] = useState<number | null>(null);
  const fieldValue = value || fallback;
  const compactValue = displayValue || fieldValue;
  const hasCompactDisplay =
    normalizeWorkbookOptionKey(compactValue) !== normalizeWorkbookOptionKey(fieldValue);

  const measureFieldWidth = (text: string) => {
    const fieldElement = fieldRef.current;

    if (!fieldElement) {
      return null;
    }

    const computedStyle = window.getComputedStyle(fieldElement);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      return fieldElement.clientWidth;
    }

    context.font = computedStyle.font;

    const horizontalPadding =
      Number.parseFloat(computedStyle.paddingLeft) +
      Number.parseFloat(computedStyle.paddingRight) +
      Number.parseFloat(computedStyle.borderLeftWidth) +
      Number.parseFloat(computedStyle.borderRightWidth) +
      10;

    return Math.max(
      fieldElement.clientWidth,
      Math.ceil(context.measureText(text || ' ').width + horizontalPadding),
    );
  };

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(value);
    }
  }, [isEditing, value]);

  useLayoutEffect(() => {
    const nextWidth = measureFieldWidth(isEditing ? draftValue : fieldValue);

    setExpandedWidth(nextWidth);
  }, [draftValue, fieldValue, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const inputElement = inputRef.current;

    if (!inputElement) {
      return;
    }

    inputElement.focus();
    inputElement.setSelectionRange(
      inputElement.value.length,
      inputElement.value.length,
    );
  }, [isEditing]);

  const normalizedDraft = normalizeWorkbookOptionKey(draftValue);
  const visibleOptions = normalizedDraft
    ? options.filter((option) =>
        normalizeWorkbookOptionKey(option).includes(normalizedDraft),
      )
    : options;

  const commit = (nextValue = draftValue) => {
    setIsEditing(false);
    const normalizedNextValue = nextValue.trim();

    if (!normalizedNextValue) {
      setDraftValue(value);
      return;
    }

    void onCommit(normalizedNextValue);
  };

  if (isEditing) {
    return (
      <span
        className={`${className} editing`}
        ref={(node) => {
          fieldRef.current = node;
        }}
        style={
          expandedWidth
            ? ({ '--aula-field-expanded-width': `${expandedWidth}px` } as CSSProperties)
            : undefined
        }
      >
        <input
          className="aula-field-input"
          ref={inputRef}
          aria-label={ariaLabel}
          value={draftValue}
          onBlur={() => commit()}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              setDraftValue(value);
              setIsEditing(false);
            }
          }}
        />
        {visibleOptions.length > 0 && (
          <span className="aula-field-dropdown" role="listbox">
            {visibleOptions.map((option) => (
              <button
                className="aula-field-option"
                key={option}
                type="button"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(option)}
              >
                {option}
              </button>
            ))}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      className={[
        className,
        hasCompactDisplay ? 'has-compact-display' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={(node) => {
        fieldRef.current = node;
      }}
      type="button"
      aria-label={ariaLabel}
      title={title}
      style={
        expandedWidth
          ? ({ '--aula-field-expanded-width': `${expandedWidth}px` } as CSSProperties)
          : undefined
      }
      onClick={() => {
        setDraftValue('');
        setIsEditing(true);
      }}
    >
      <span className="aula-field-layer aula-field-compact">{compactValue}</span>
      <span className="aula-field-layer aula-field-full">{fieldValue}</span>
    </button>
  );
}

function formatCompactPersonName(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 1) {
    return value;
  }

  return [
    words[0],
    ...words.slice(1).map((word) => word.charAt(0).toUpperCase()),
  ].join(' ');
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function NewSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M4 6v-1a1 1 0 0 1 1 -1h1" />
      <path d="M10 4h4" />
      <path d="M18 4h1a1 1 0 0 1 1 1v1" />
      <path d="M20 10v4" />
      <path d="M20 18v1a1 1 0 0 1 -1 1h-1" />
      <path d="M14 20h-4" />
      <path d="M6 20h-1a1 1 0 0 1 -1 -1v-1" />
      <path d="M4 14v-4" />
    </svg>
  );
}

function ColorPickerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 7l6 6" />
      <path d="M4 16l10 -10a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3l-10 10h-4v-4z" />
      <path d="M13.5 6.5l4 4" />
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
