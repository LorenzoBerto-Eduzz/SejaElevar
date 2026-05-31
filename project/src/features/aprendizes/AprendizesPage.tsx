import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { read, utils, write } from 'xlsx';
import {
  APRENDIZES_ENTITY_ID,
  buildAprendizesDataIndexEntity,
  buildEmptyDataIndexEntity,
} from '../../shared/data/dataIndex';
import {
  APRENDIZES_REQUIRED_COLUMNS,
  normalizeColumnsForSchema,
} from '../../shared/data/schemas';
import { ThemeToggleButton } from '../../shared/ui/ThemeToggleButton';

const APRENDIZES_VIEW_STORAGE_KEY = 'sejaelevar.aprendizes.view.v1';
const LEGACY_APRENDIZES_STORAGE_KEY = 'sejaelevar.aprendizes.sheet.v1';
const DEFAULT_COLUMN_WIDTH = 96;
const MIN_COLUMN_WIDTH = 34;
const TABLE_HORIZONTAL_PADDING = 10;
const TABLE_WIDTH_BUFFER = 6;
const CELL_UNDO_LIMIT = 1000;
const BIRTHDATE_COLUMN = 'Data de Nascimento';
const AGE_COLUMN = 'Idade';
const ROW_DETAILS_PANEL_MARGIN = 20;
const ROW_DETAILS_PANEL_HEIGHT = 360;
const ROW_DETAILS_PANEL_WIDTH = ROW_DETAILS_PANEL_HEIGHT * 1.4;
const TABLE_FONT = '12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TABLE_HEADER_FONT =
  '800 12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';

const readPixelCustomProperty = (
  element: Element,
  name: string,
  fallback: number,
) => {
  const value = Number.parseFloat(
    window.getComputedStyle(element).getPropertyValue(name),
  );

  return Number.isFinite(value) ? value : fallback;
};

const getRowDetailsPanelSize = (frame: HTMLElement) => {
  const settingsSource = frame.closest('.app-shell') ?? document.documentElement;

  return {
    width: readPixelCustomProperty(
      settingsSource,
      '--row-details-panel-width',
      ROW_DETAILS_PANEL_WIDTH,
    ),
    height: readPixelCustomProperty(
      settingsSource,
      '--row-details-panel-height',
      ROW_DETAILS_PANEL_HEIGHT,
    ),
  };
};

type ImportedSheet = {
  fileName: string;
  sheetName: string;
  importedAt: string;
  columns: string[];
  rows: string[][];
};

type TableViewSettings = {
  columnOrder: string[];
  columnWidths: Record<string, number>;
  sortState: TableSortState | null;
};

type SortDirection = 'asc' | 'desc';

type TableSortState = {
  columnName: string;
  direction: SortDirection;
};

type CellEditUndoEntry = {
  kind: 'cell-edit';
  rowIndex: number;
  columnName: string;
  previousValue: string;
  nextValue: string;
};

type RowInsertUndoEntry = {
  kind: 'row-insert';
  rowIndex: number;
};

type RowDeleteUndoEntry = {
  kind: 'row-delete';
  rowIndex: number;
  rowValues: string[];
};

type TableUndoEntry =
  | CellEditUndoEntry
  | RowInsertUndoEntry
  | RowDeleteUndoEntry;

type ActiveCellEdit = {
  rowIndex: number;
  columnName: string;
  initialValue: string;
};

type ActiveRegistrationEdit = {
  columnName: string;
  initialValue: string;
};

type RegistrationDraftUndoEntry = {
  columnName: string;
  previousValue: string;
  nextValue: string;
};

type RecoveryReason =
  | 'before_import'
  | 'before_edit'
  | 'before_session_edit'
  | 'import_original'
  | 'before_recovery'
  | 'after_recovery'
  | 'restored';

type RecoveryInfo = {
  available: boolean;
  canRecover: boolean;
  fileName?: string | null;
  label?: string | null;
  formattedUpdatedAt?: string | null;
  reason?: RecoveryReason | null;
};

class MissingRequiredColumnsError extends Error {
  missingColumns: string[];

  constructor(missingColumns: string[]) {
    super('missing-required-columns');
    this.missingColumns = missingColumns;
  }
}

const defaultViewSettings: TableViewSettings = {
  columnOrder: [],
  columnWidths: {},
  sortState: null,
};

const normalizeCell = (value: unknown) => String(value ?? '').trim();

const calculateAgeFromBirthdate = (birthdate: string, today = new Date()) => {
  const match = birthdate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

  if (!match) {
    return '';
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }

  let age = today.getFullYear() - year;
  const hasBirthdayThisYear =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);

  if (!hasBirthdayThisYear) {
    age -= 1;
  }

  return age >= 0 ? String(age) : '';
};

const getDerivedAgeForRow = (sheet: ImportedSheet, row: string[]) => {
  const birthdateColumnIndex = sheet.columns.indexOf(BIRTHDATE_COLUMN);

  if (birthdateColumnIndex < 0) {
    return '';
  }

  return calculateAgeFromBirthdate(row[birthdateColumnIndex] || '');
};

const getDisplayCellValue = (
  sheet: ImportedSheet,
  row: string[],
  columnName: string,
) => {
  if (columnName === AGE_COLUMN) {
    return getDerivedAgeForRow(sheet, row);
  }

  const columnIndex = sheet.columns.indexOf(columnName);
  return columnIndex >= 0 ? row[columnIndex] || '' : '';
};

const withDerivedAprendizValues = (sheet: ImportedSheet) => {
  const ageColumnIndex = sheet.columns.indexOf(AGE_COLUMN);

  if (ageColumnIndex < 0) {
    return sheet;
  }

  return {
    ...sheet,
    rows: sheet.rows.map((row) => {
      const nextRow = [...row];
      nextRow[ageColumnIndex] = getDerivedAgeForRow(sheet, row);
      return nextRow;
    }),
  };
};

let textMeasureContext: CanvasRenderingContext2D | null = null;

const formatMissingColumnsMessage = (missingColumns: string[]) =>
  `A planilha não possui as colunas necessárias: ${missingColumns.join(', ')}.`;

const measureTextWidth = (text: string, font: string) => {
  if (typeof document === 'undefined') {
    return text.length * 7;
  }

  if (!textMeasureContext) {
    textMeasureContext = document.createElement('canvas').getContext('2d');
  }

  if (!textMeasureContext) {
    return text.length * 7;
  }

  textMeasureContext.font = font;
  return textMeasureContext.measureText(text).width;
};

const getWrappedHeaderWidth = (text: string) => {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length <= 1) {
    return measureTextWidth(text, TABLE_HEADER_FONT);
  }

  const fullTextWidth = measureTextWidth(text, TABLE_HEADER_FONT);
  let bestWidth = fullTextWidth;

  for (let splitIndex = 1; splitIndex < words.length; splitIndex += 1) {
    const firstLine = words.slice(0, splitIndex).join(' ');
    const secondLine = words.slice(splitIndex).join(' ');
    const candidateWidth = Math.max(
      measureTextWidth(firstLine, TABLE_HEADER_FONT),
      measureTextWidth(secondLine, TABLE_HEADER_FONT),
    );

    if (candidateWidth < bestWidth) {
      bestWidth = candidateWidth;
    }
  }

  return bestWidth;
};

const readSavedViewSettings = () => {
  if (typeof window === 'undefined') {
    return defaultViewSettings;
  }

  try {
    const savedView = window.localStorage.getItem(APRENDIZES_VIEW_STORAGE_KEY);
    return savedView
      ? { ...defaultViewSettings, ...(JSON.parse(savedView) as TableViewSettings) }
      : defaultViewSettings;
  } catch {
    window.localStorage.removeItem(APRENDIZES_VIEW_STORAGE_KEY);
    return defaultViewSettings;
  }
};

export function AprendizesPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowDetailsInputRefs = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );
  const cellUndoStackRef = useRef<TableUndoEntry[]>([]);
  const registrationDraftUndoStackRef = useRef<RegistrationDraftUndoEntry[]>([]);
  const activeCellEditRef = useRef<ActiveCellEdit | null>(null);
  const activeRegistrationEditRef = useRef<ActiveRegistrationEdit | null>(null);
  const isApplyingUndoRef = useRef(false);
  const undoGuardTimerRef = useRef<number | null>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement>(null);
  const tableBodyScrollRef = useRef<HTMLDivElement>(null);
  const tableFrameRef = useRef<HTMLDivElement>(null);
  const registerHighlightTimerRef = useRef<number | null>(null);
  const wasRegistrationModeRef = useRef(false);
  const registrationDraftRef = useRef<Record<string, string>>({});
  const [importedSheet, setImportedSheet] = useState<ImportedSheet | null>(null);
  const latestSheetRef = useRef<ImportedSheet | null>(importedSheet);
  const isLocalProviderActiveRef = useRef(false);
  const [viewSettings, setViewSettings] = useState<TableViewSettings>(
    readSavedViewSettings,
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [isRegistrationMode, setIsRegistrationMode] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [areBodyEditInputsReady, setAreBodyEditInputsReady] = useState(false);
  const sortState = viewSettings.sortState;
  const [draggedColumn, setDraggedColumn] = useState('');
  const [importError, setImportError] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [hasCheckedWorkspace, setHasCheckedWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [isRecoveringBackup, setIsRecoveringBackup] = useState(false);
  const [hasRegistrationDraftValue, setHasRegistrationDraftValue] =
    useState(false);
  const [registrationDraftResetKey, setRegistrationDraftResetKey] = useState(0);
  const [isRegistrationFocused, setIsRegistrationFocused] = useState(false);
  const [sessionRegisteredRowIndexes, setSessionRegisteredRowIndexes] =
    useState<number[]>([]);
  const [highlightedRegisteredRowIndex, setHighlightedRegisteredRowIndex] =
    useState<number | null>(null);
  const [selectedDeleteRow, setSelectedDeleteRow] = useState<{
    rowIndex: number;
    visualIndex: number;
  } | null>(null);
  const [selectedDetailsRow, setSelectedDetailsRow] = useState<{
    rowIndex: number;
    visualIndex: number;
  } | null>(null);
  const rowDetailsPanelStyleRef = useRef<CSSProperties>({});
  const [rowDetailsPanelStyle, setRowDetailsPanelStyle] =
    useState<CSSProperties>({});
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const applyRowDetailsPanelStyle = (nextStyle: CSSProperties) => {
    const currentStyle = rowDetailsPanelStyleRef.current;
    const isSameStyle =
      currentStyle.display === nextStyle.display &&
      currentStyle.left === nextStyle.left &&
      currentStyle.top === nextStyle.top &&
      currentStyle.width === nextStyle.width &&
      currentStyle.height === nextStyle.height;

    if (isSameStyle) {
      return;
    }

    rowDetailsPanelStyleRef.current = nextStyle;
    setRowDetailsPanelStyle(nextStyle);
  };
  const saveViewSettings = (settings: TableViewSettings) => {
    setViewSettings(settings);
    window.localStorage.setItem(
      APRENDIZES_VIEW_STORAGE_KEY,
      JSON.stringify(settings),
    );
  };
  const storeImportedSheet = (sheet: ImportedSheet) => {
    latestSheetRef.current = sheet;
    setImportedSheet(sheet);
  };

  const clearWorkingSheet = () => {
    cellUndoStackRef.current = [];
    registrationDraftUndoStackRef.current = [];
    activeCellEditRef.current = null;
    activeRegistrationEditRef.current = null;
    latestSheetRef.current = null;
    setImportedSheet(null);
    setRecoveryInfo(null);
    registrationDraftRef.current = {};
    setHasRegistrationDraftValue(false);
    setRegistrationDraftResetKey((currentKey) => currentKey + 1);
    setIsRegistrationFocused(false);
    setIsEditMode(false);
    setIsRegistrationMode(false);
    setIsDeleteMode(false);
    setSelectedDeleteRow(null);
    setSelectedDetailsRow(null);
    applyRowDetailsPanelStyle({});
    setTableScrollTop(0);
    setSessionRegisteredRowIndexes([]);
    setHighlightedRegisteredRowIndex(null);
  };

  const saveImportedSheet = (
    sheet: ImportedSheet,
    options: { resetColumnWidths?: boolean } = {},
  ) => {
    cellUndoStackRef.current = [];
    registrationDraftUndoStackRef.current = [];
    activeCellEditRef.current = null;
    activeRegistrationEditRef.current = null;
    storeImportedSheet(sheet);

    const knownColumns = new Set(sheet.columns);
    const nextColumnOrder = [
      ...viewSettings.columnOrder.filter((column) => knownColumns.has(column)),
      ...sheet.columns.filter(
        (column) => !viewSettings.columnOrder.includes(column),
      ),
    ];
    const nextColumnWidths = options.resetColumnWidths
      ? {}
      : Object.fromEntries(
          Object.entries(viewSettings.columnWidths).filter(([column]) =>
            knownColumns.has(column),
          ),
        );
    const nextSortState =
      viewSettings.sortState && knownColumns.has(viewSettings.sortState.columnName)
        ? viewSettings.sortState
        : null;

    registrationDraftRef.current = {};
    setHasRegistrationDraftValue(false);
    setRegistrationDraftResetKey((currentKey) => currentKey + 1);
    setIsRegistrationFocused(false);
    setIsEditMode(false);
    setIsRegistrationMode(false);
    setIsDeleteMode(false);
    setSelectedDeleteRow(null);
    setSelectedDetailsRow(null);
    applyRowDetailsPanelStyle({});
    setTableScrollTop(0);
    setSessionRegisteredRowIndexes([]);
    setHighlightedRegisteredRowIndex(null);
    saveViewSettings({
      ...viewSettings,
      columnOrder: nextColumnOrder,
      columnWidths: nextColumnWidths,
      sortState: nextSortState,
    });
    void persistAprendizesDataIndex(sheet);
  };

  const persistAprendizesDataIndex = async (sheet: ImportedSheet | null) => {
    if (!isLocalProviderActiveRef.current) {
      return;
    }

    const entityIndex = sheet
      ? buildAprendizesDataIndexEntity(withDerivedAprendizValues(sheet))
      : buildEmptyDataIndexEntity(APRENDIZES_ENTITY_ID, 'Aprendizes');

    try {
      await fetch(`/api/data-index/entities/${APRENDIZES_ENTITY_ID}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(entityIndex),
      });
    } catch {
      // The table remains the source of truth; the generated index can be rebuilt.
    }
  };

  const fetchRecoveryInfo = async () => {
    if (!isLocalProviderActiveRef.current) {
      setRecoveryInfo(null);
      return null;
    }

    try {
      const response = await fetch('/api/aprendizes/backup', {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('backup-info-failed');
      }

      const info = (await response.json()) as RecoveryInfo;
      setRecoveryInfo(info);
      return info;
    } catch {
      setRecoveryInfo(null);
      return null;
    }
  };

  const fetchProviderFile = async (
    options: { resetColumnWidths?: boolean } = {},
  ) => {
    const response = await fetch('/api/aprendizes/file', {
      cache: 'no-store',
    });

    if (response.status === 404) {
      clearWorkingSheet();
      void persistAprendizesDataIndex(null);
      setWorkspaceStatus(
        'Nenhuma planilha encontrada em dados. Importe um .xlsx.',
      );
      return false;
    }

    if (!response.ok) {
      throw new Error('read-failed');
    }

    const rawFileName = response.headers.get('x-file-name') || 'aprendizes.xlsx';
    const fileName = decodeURIComponent(rawFileName);
    const blob = await response.blob();
    const file = new File([blob], fileName, {
      type:
        blob.type ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const didLoadFile = await selectFile(file, options);

    if (!didLoadFile) {
      return false;
    }

    await fetchRecoveryInfo();
    return true;
  };

  const importWorkingFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    if (!isLocalProviderActiveRef.current) {
      clearWorkingSheet();
      setImportError('');
      return;
    }

    try {
      const parsedSheet = await readSheetFile(file);
      const response = await fetch('/api/aprendizes/import', {
        method: 'POST',
        headers: {
          'content-type':
            file.type ||
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });

      if (!response.ok) {
        throw new Error('import-failed');
      }
      const result = (await response.json()) as { fileName?: string };
      const storedFileName = result.fileName || file.name;

      saveImportedSheet({
        ...parsedSheet,
        fileName: storedFileName,
      }, {
        resetColumnWidths: true,
      });
      await fetchRecoveryInfo();
      setWorkspaceStatus(`Planilha copiada para dados/${storedFileName}.`);
      setImportError('');
    } catch (error) {
      if (error instanceof MissingRequiredColumnsError) {
        setImportError(formatMissingColumnsMessage(error.missingColumns));
        return;
      }

      if ((error as Error).message === 'invalid-file-type') {
        setImportError('Selecione um arquivo .xlsx.');
        return;
      }

      if (
        (error as Error).message === 'missing-sheet' ||
        (error as Error).message === 'empty-sheet'
      ) {
        setImportError('Não foi possível ler este arquivo .xlsx.');
        return;
      }

      if ((error as DOMException).name === 'AbortError') {
        setWorkspaceStatus('Importação cancelada.');
        return;
      }

      setImportError(
        'Não foi possível copiar a planilha para dados.',
      );
    }
  };

  const importFromPicker = async () => {
    fileInputRef.current?.click();
  };

  const exportWorkingFile = async () => {
    if (!hasWorkingSheet || !isLocalProviderActiveRef.current) {
      return;
    }

    try {
      const response = await fetch('/api/aprendizes/export', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('export-failed');
      }

      const result = (await response.json()) as {
        canceled?: boolean;
        fileName?: string;
      };

      if (result.canceled) {
        setWorkspaceStatus('Exporta\u00e7\u00e3o cancelada.');
        return;
      }

      setWorkspaceStatus(
        `Planilha exportada como ${result.fileName || 'Aprendizes.xlsx'}.`,
      );
      setImportError('');
    } catch {
      setImportError('N\u00e3o foi poss\u00edvel exportar a planilha.');
    }
  };

  const recoverBackup = async () => {
    if (!recoveryInfo?.canRecover || isRecoveringBackup) {
      return;
    }

    setIsRecoveringBackup(true);

    try {
      const response = await fetch('/api/aprendizes/recover', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('recover-failed');
      }

      const result = (await response.json()) as { fileName?: string };
      await fetchProviderFile({
        resetColumnWidths: false,
      });
      await fetchRecoveryInfo();
      setIsRecoveryDialogOpen(false);
      setWorkspaceStatus(
        `Dados recuperados em dados/${result.fileName || 'Aprendizes.xlsx'}.`,
      );
      setImportError('');
    } catch {
      setImportError('N\u00e3o foi poss\u00edvel recuperar os dados do backup.');
    } finally {
      setIsRecoveringBackup(false);
    }
  };

  const selectFile = async (
    file: File | undefined,
    options: {
      resetColumnWidths?: boolean;
    } = {},
  ) => {
    if (!file) {
      return false;
    }

    try {
      const nextSheet = await readSheetFile(file);

      saveImportedSheet(nextSheet, {
        resetColumnWidths: options.resetColumnWidths,
      });

      setWorkspaceStatus('Planilha carregada.');
      setImportError('');
      return true;
    } catch (error) {
      clearWorkingSheet();
      void persistAprendizesDataIndex(null);

      if (error instanceof MissingRequiredColumnsError) {
        setImportError(formatMissingColumnsMessage(error.missingColumns));
        return false;
      }

      if ((error as Error).message === 'invalid-file-type') {
        setImportError('Selecione um arquivo .xlsx.');
        return false;
      }

      setImportError('Não foi possível ler este arquivo .xlsx.');
      return false;
    }
  };

  const readSheetFile = async (file: File): Promise<ImportedSheet> => {
    const isXlsx =
      file.name.toLowerCase().endsWith('.xlsx') ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!isXlsx) {
      throw new Error('invalid-file-type');
    }

    const workbook = read(await file.arrayBuffer(), {
      cellDates: true,
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    if (!sheetName || !worksheet) {
      throw new Error('missing-sheet');
    }

    const sheetRows = utils.sheet_to_json<unknown[]>(worksheet, {
      blankrows: false,
      defval: '',
      header: 1,
      raw: false,
    });
    const headerIndex = sheetRows.findIndex((row) =>
      row.some((cell) => normalizeCell(cell) !== ''),
    );

    if (headerIndex < 0) {
      throw new Error('empty-sheet');
    }

    const headerRow = sheetRows[headerIndex];
    let lastColumnIndex = -1;
    sheetRows.slice(headerIndex).forEach((row) => {
      row.forEach((cell, index) => {
        if (normalizeCell(cell) !== '') {
          lastColumnIndex = Math.max(lastColumnIndex, index);
        }
      });
    });

    const rawColumns = headerRow
      .slice(0, lastColumnIndex + 1)
      .map((cell, index) => normalizeCell(cell) || `Coluna ${index + 1}`);
    const { missingColumns, normalizedColumns: columns } =
      normalizeColumnsForSchema(rawColumns, APRENDIZES_REQUIRED_COLUMNS);

    if (missingColumns.length > 0) {
      throw new MissingRequiredColumnsError(missingColumns);
    }

    const rows = sheetRows
      .slice(headerIndex + 1)
      .map((row) =>
        columns.map((_, columnIndex) => normalizeCell(row[columnIndex])),
      )
      .filter((row) => row.some((cell) => cell !== ''));

    return {
      fileName: file.name,
      sheetName,
      importedAt: new Date().toISOString(),
      columns,
      rows,
    };
  };

  useEffect(() => {
    let isMounted = true;
    window.localStorage.removeItem(LEGACY_APRENDIZES_STORAGE_KEY);

    const loadSavedWorkbook = async () => {
      try {
        const statusResponse = await fetch('/api/app/status', {
          cache: 'no-store',
        });

        if (!isMounted) {
          return;
        }

        const status = statusResponse.ok ? await statusResponse.json() : null;

        if (!status?.localProvider) {
          isLocalProviderActiveRef.current = false;
          clearWorkingSheet();
          setWorkspaceStatus('');
          setHasCheckedWorkspace(true);
          return;
        }

        isLocalProviderActiveRef.current = true;
        const hasWorkbook = await fetchProviderFile({
          resetColumnWidths: false,
        });

        if (!isMounted) {
          return;
        }

        setHasCheckedWorkspace(true);

        if (hasWorkbook) {
          setWorkspaceStatus('Dados vinculados à planilha em dados.');
        }
      } catch {
        isLocalProviderActiveRef.current = false;
        clearWorkingSheet();

        if (isMounted) {
          setWorkspaceStatus('');
          setHasCheckedWorkspace(true);
        }
      }
    };

    void loadSavedWorkbook();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isEditMode) {
      setAreBodyEditInputsReady(false);
      activeCellEditRef.current = null;
    }
  }, [isEditMode]);

  useEffect(() => {
    if (!isRegistrationMode) {
      registrationDraftRef.current = {};
      registrationDraftUndoStackRef.current = [];
      activeRegistrationEditRef.current = null;
      setHasRegistrationDraftValue(false);
      setRegistrationDraftResetKey((currentKey) => currentKey + 1);
      setIsRegistrationFocused(false);
      wasRegistrationModeRef.current = false;
    }
  }, [isRegistrationMode]);

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setAreBodyEditInputsReady(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isEditMode]);

  useEffect(() => {
    if (
      !isEditMode &&
      !isRegistrationMode &&
      !isDeleteMode &&
      !selectedDetailsRow
    ) {
      return;
    }

    const handleUndoShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'z'
      ) {
        return;
      }

      event.preventDefault();
      undoLastCellEditAndSave();
    };

    window.addEventListener('keydown', handleUndoShortcut, {
      capture: true,
    });

    return () =>
      window.removeEventListener('keydown', handleUndoShortcut, {
        capture: true,
      });
  }, [isEditMode, isRegistrationMode, isDeleteMode, selectedDetailsRow]);

  useEffect(() => {
    if (!isDeleteMode || selectedDeleteRow === null) {
      return;
    }

    const handleDeleteShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Del') {
        return;
      }

      const target =
        event.target instanceof HTMLElement ? event.target : null;

      if (
        target?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]',
        )
      ) {
        return;
      }

      event.preventDefault();
      deleteRowAndSave(selectedDeleteRow.rowIndex);
    };

    window.addEventListener('keydown', handleDeleteShortcut, {
      capture: true,
    });

    return () =>
      window.removeEventListener('keydown', handleDeleteShortcut, {
        capture: true,
      });
  }, [isDeleteMode, selectedDeleteRow]);

  useEffect(() => {
    if (!isDeleteMode || selectedDeleteRow === null) {
      return;
    }

    const clearDeleteSelection = (event: globalThis.PointerEvent) => {
      const target =
        event.target instanceof HTMLElement ? event.target : null;

      if (target?.closest('.data-table-body tbody tr')) {
        return;
      }

      setSelectedDeleteRow(null);
    };

    window.addEventListener('pointerdown', clearDeleteSelection);

    return () =>
      window.removeEventListener('pointerdown', clearDeleteSelection);
  }, [isDeleteMode, selectedDeleteRow]);

  useEffect(() => {
    if (isEditMode || isRegistrationMode || isDeleteMode) {
      setSelectedDetailsRow(null);
      applyRowDetailsPanelStyle({});
    }
  }, [isEditMode, isRegistrationMode, isDeleteMode]);

  useEffect(
    () => () => {
      if (registerHighlightTimerRef.current !== null) {
        window.clearTimeout(registerHighlightTimerRef.current);
      }

      if (undoGuardTimerRef.current !== null) {
        window.clearTimeout(undoGuardTimerRef.current);
      }
    },
    [],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void importWorkingFile(event.dataTransfer.files[0]);
  };

  const orderedColumns = importedSheet
    ? [
        ...viewSettings.columnOrder.filter((column) =>
          importedSheet.columns.includes(column),
        ),
        ...importedSheet.columns.filter(
          (column) => !viewSettings.columnOrder.includes(column),
        ),
      ]
    : [];

  const cycleColumnSort = (columnName: string) => {
    if (isEditMode) {
      return;
    }

    const nextSortState =
      sortState?.columnName !== columnName
        ? { columnName, direction: 'asc' as const }
        : sortState.direction === 'asc'
          ? { columnName, direction: 'desc' as const }
          : null;

    saveViewSettings({
      ...viewSettings,
      sortState: nextSortState,
    });
  };

  const displayedRows =
    importedSheet?.rows.map((row, rowIndex) => ({ row, rowIndex })) ?? [];

  if (
    importedSheet &&
    sortState &&
    importedSheet.columns.includes(sortState.columnName)
  ) {
    const sortDirection = sortState.direction === 'asc' ? 1 : -1;

    displayedRows.sort((left, right) => {
      const valueComparison = getDisplayCellValue(
        importedSheet,
        left.row,
        sortState.columnName,
      ).localeCompare(
        getDisplayCellValue(importedSheet, right.row, sortState.columnName),
        'pt-BR',
        {
          numeric: true,
          sensitivity: 'base',
        },
      );

      if (valueComparison !== 0) {
        return valueComparison * sortDirection;
      }

      return left.rowIndex - right.rowIndex;
    });
  } else if (sessionRegisteredRowIndexes.length > 0) {
    const registeredOrder = new Map(
      sessionRegisteredRowIndexes.map((rowIndex, orderIndex) => [
        rowIndex,
        orderIndex,
      ]),
    );

    displayedRows.sort((left, right) => {
      const leftOrder = registeredOrder.get(left.rowIndex);
      const rightOrder = registeredOrder.get(right.rowIndex);

      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) -
          (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }

      return left.rowIndex - right.rowIndex;
    });
  }

  const showRegistrationHint = Boolean(
    hasRegistrationDraftValue && isRegistrationFocused,
  );

  const getRegistrationDraftDisplayValue = (column: string) => {
    if (!importedSheet) {
      return '';
    }

    if (column !== AGE_COLUMN) {
      return registrationDraftRef.current[column] || '';
    }

    const birthdateValue = registrationDraftRef.current[BIRTHDATE_COLUMN] || '';
    return calculateAgeFromBirthdate(birthdateValue);
  };

  const getVisualRowIndex = (
    sheet: ImportedSheet,
    targetRowIndex: number,
    registeredRowIndexes: number[],
  ) => {
    const visualRows = sheet.rows.map((row, rowIndex) => ({ row, rowIndex }));

    if (sortState && sheet.columns.includes(sortState.columnName)) {
      const sortDirection = sortState.direction === 'asc' ? 1 : -1;

      visualRows.sort((left, right) => {
        const valueComparison = getDisplayCellValue(
          sheet,
          left.row,
          sortState.columnName,
        ).localeCompare(
          getDisplayCellValue(sheet, right.row, sortState.columnName),
          'pt-BR',
          {
            numeric: true,
            sensitivity: 'base',
          },
        );

        if (valueComparison !== 0) {
          return valueComparison * sortDirection;
        }

        return left.rowIndex - right.rowIndex;
      });
    } else if (registeredRowIndexes.length > 0) {
      const registeredOrder = new Map(
        registeredRowIndexes.map((rowIndex, orderIndex) => [
          rowIndex,
          orderIndex,
        ]),
      );

      visualRows.sort((left, right) => {
        const leftOrder = registeredOrder.get(left.rowIndex);
        const rightOrder = registeredOrder.get(right.rowIndex);

        if (leftOrder !== undefined || rightOrder !== undefined) {
          return (leftOrder ?? Number.MAX_SAFE_INTEGER) -
            (rightOrder ?? Number.MAX_SAFE_INTEGER);
        }

        return left.rowIndex - right.rowIndex;
      });
    }

    return visualRows.findIndex(({ rowIndex }) => rowIndex === targetRowIndex);
  };

  const getNumericAppCssValue = (propertyName: string, fallback: number) => {
    if (typeof document === 'undefined') {
      return fallback;
    }

    const appShell = document.querySelector('.app-shell');
    const value = Number.parseFloat(
      getComputedStyle(appShell ?? document.documentElement)
        .getPropertyValue(propertyName)
        .trim(),
    );

    return Number.isFinite(value) ? value : fallback;
  };

  const getCurrentTableRowHeight = () =>
    getNumericAppCssValue('--table-row-height', 32);

  const getCurrentTableHeaderHeight = () =>
    getNumericAppCssValue('--table-header-height', 48);

  const scrollToRegisteredRow = (
    sheet: ImportedSheet,
    targetRowIndex: number,
    registeredRowIndexes: number[],
  ) => {
    const tableBody = tableBodyScrollRef.current;

    if (!tableBody) {
      return;
    }

    const visualRowIndex = getVisualRowIndex(
      sheet,
      targetRowIndex,
      registeredRowIndexes,
    );

    if (visualRowIndex < 0) {
      return;
    }

    const effectiveRowHeight = getCurrentTableRowHeight();
    const rowTop = visualRowIndex * effectiveRowHeight;
    const targetScrollTop = Math.max(
      0,
      rowTop - tableBody.clientHeight / 2 + effectiveRowHeight / 2,
    );

    tableBody.scrollTop = targetScrollTop;
  };

  const moveColumn = (sourceColumn: string, targetColumn: string) => {
    const currentSheet = latestSheetRef.current;

    if (!currentSheet || !sourceColumn || sourceColumn === targetColumn) {
      return;
    }

    const columnsWithoutSource = orderedColumns.filter(
      (column) => column !== sourceColumn,
    );
    const targetIndex = columnsWithoutSource.indexOf(targetColumn);

    if (targetIndex < 0) {
      return;
    }

    const nextColumnOrder = [...columnsWithoutSource];
    nextColumnOrder.splice(targetIndex, 0, sourceColumn);
    const nextRows = currentSheet.rows.map((row) =>
      nextColumnOrder.map((column) => {
        const columnIndex = currentSheet.columns.indexOf(column);
        return columnIndex >= 0 ? row[columnIndex] || '' : '';
      }),
    );
    const nextSheet = {
      ...currentSheet,
      columns: nextColumnOrder,
      rows: nextRows,
    };

    storeImportedSheet(nextSheet);
    saveViewSettings({
      ...viewSettings,
      columnOrder: nextColumnOrder,
    });
    void writeSheetToSourceFile(nextSheet);
  };

  const getAutoColumnWidth = (column: string) => {
    if (!importedSheet) {
      return DEFAULT_COLUMN_WIDTH;
    }

    const columnIndex = importedSheet.columns.indexOf(column);

    if (columnIndex < 0) {
      return DEFAULT_COLUMN_WIDTH;
    }

    const headerWidth = getWrappedHeaderWidth(column);
    const longestCellWidth = importedSheet.rows.reduce((longestWidth, row) => {
      const cellWidth = measureTextWidth(
        column === AGE_COLUMN
          ? getDisplayCellValue(importedSheet, row, column)
          : row[columnIndex] || '',
        TABLE_FONT,
      );
      return Math.max(longestWidth, cellWidth);
    }, 0);
    const textWidth = Math.ceil(Math.max(headerWidth, longestCellWidth));

    return Math.max(
      MIN_COLUMN_WIDTH,
      textWidth + TABLE_HORIZONTAL_PADDING * 2 + TABLE_WIDTH_BUFFER,
    );
  };

  const getColumnWidth = (column: string) =>
    viewSettings.columnWidths[column] ?? getAutoColumnWidth(column);

  const getColumnWidthStyle = (column: string) => {
    const width = getColumnWidth(column);

    return {
      width,
      minWidth: width,
      maxWidth: width,
    };
  };
  const orderedColumnsKey = orderedColumns.join('\u001f');

  useEffect(() => {
    if (!selectedDetailsRow || !importedSheet) {
      applyRowDetailsPanelStyle({});
      return;
    }

    const updatePanelMetrics = () => {
      const frame = tableFrameRef.current;

      if (!frame || orderedColumns.length === 0) {
        applyRowDetailsPanelStyle({});
        return;
      }

      const frameWidth = frame.clientWidth;
      const frameHeight = frame.clientHeight;
      const preferredPanelSize = getRowDetailsPanelSize(frame);
      const firstHeaderCell =
        tableHeaderScrollRef.current?.querySelector<HTMLTableCellElement>(
          'th:not(.table-scrollbar-spacer)',
        );
      const firstColumnWidth =
        firstHeaderCell?.offsetWidth ?? getColumnWidth(orderedColumns[0]);
      const headerHeight =
        tableHeaderScrollRef.current?.offsetHeight ??
        readPixelCustomProperty(
          frame,
          '--table-header-height',
          getCurrentTableHeaderHeight(),
        );
      const minimumLeft = firstColumnWidth + ROW_DETAILS_PANEL_MARGIN;
      const maximumRight = frameWidth - ROW_DETAILS_PANEL_MARGIN;
      const availableWidth = Math.max(0, maximumRight - minimumLeft);
      const width = Math.min(preferredPanelSize.width, availableWidth);
      const left = maximumRight - width;
      const minimumTop = headerHeight + ROW_DETAILS_PANEL_MARGIN;
      const maximumBottom = frameHeight - ROW_DETAILS_PANEL_MARGIN;
      const availableHeight = Math.max(0, maximumBottom - minimumTop);
      const height = Math.min(preferredPanelSize.height, availableHeight);
      const top = maximumBottom - height;

      if (width <= 0 || height <= 0) {
        applyRowDetailsPanelStyle({
          display: 'none',
        });
        return;
      }

      applyRowDetailsPanelStyle({
        left: Math.round(Math.max(left, minimumLeft)),
        top: Math.round(Math.max(top, minimumTop)),
        width: Math.round(width),
        height: Math.round(height),
      });
    };

    updatePanelMetrics();

    let resizeUpdateTimer: number | null = null;
    let animationFrameId: number | null = null;

    const schedulePanelMetricsUpdate = (delay = 0) => {
      if (resizeUpdateTimer !== null) {
        window.clearTimeout(resizeUpdateTimer);
        resizeUpdateTimer = null;
      }

      if (delay > 0) {
        resizeUpdateTimer = window.setTimeout(() => {
          resizeUpdateTimer = null;
          schedulePanelMetricsUpdate();
        }, delay);
        return;
      }

      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updatePanelMetrics();
      });
    };

    const frame = tableFrameRef.current;

    if (!frame || typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => schedulePanelMetricsUpdate(140);
      window.addEventListener('resize', handleWindowResize);

      return () => {
        if (resizeUpdateTimer !== null) {
          window.clearTimeout(resizeUpdateTimer);
        }

        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
        }

        window.removeEventListener('resize', handleWindowResize);
      };
    }

    const observer = new ResizeObserver(() => schedulePanelMetricsUpdate(180));
    const shell = frame.closest('.app-shell');
    let settingsObserver: MutationObserver | null = null;
    const handleWindowResize = () => schedulePanelMetricsUpdate(140);

    observer.observe(frame);
    if (shell && typeof MutationObserver !== 'undefined') {
      settingsObserver = new MutationObserver(() => schedulePanelMetricsUpdate());
      settingsObserver.observe(shell, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (resizeUpdateTimer !== null) {
        window.clearTimeout(resizeUpdateTimer);
      }

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      observer.disconnect();
      settingsObserver?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [
    selectedDetailsRow,
    importedSheet,
    orderedColumnsKey,
    viewSettings.columnWidths,
  ]);

  const resizeColumn = (column: string, width: number) => {
    saveViewSettings({
      ...viewSettings,
      columnWidths: {
        ...viewSettings.columnWidths,
        [column]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
      },
    });
  };

  const startColumnResize = (
    event: PointerEvent<HTMLSpanElement>,
    column: string,
  ) => {
    if (!isEditMode) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const headerCell = event.currentTarget.closest('th');
    const startX = event.clientX;
    const startWidth =
      headerCell?.getBoundingClientRect().width ?? getColumnWidth(column);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      resizeColumn(column, startWidth + moveEvent.clientX - startX);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const preserveAgeFormulas = (
    previousWorksheet: ReturnType<typeof utils.aoa_to_sheet> | undefined,
    nextWorksheet: ReturnType<typeof utils.aoa_to_sheet>,
    sheet: ImportedSheet,
  ) => {
    if (!previousWorksheet) {
      return;
    }

    const ageColumnIndex = sheet.columns.indexOf(AGE_COLUMN);

    if (ageColumnIndex < 0) {
      return;
    }

    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      const cellAddress = utils.encode_cell({
        c: ageColumnIndex,
        r: rowIndex + 1,
      });
      const previousCell = previousWorksheet[cellAddress];

      if (!previousCell?.f) {
        continue;
      }

      nextWorksheet[cellAddress] = {
        ...nextWorksheet[cellAddress],
        ...previousCell,
      };
    }
  };

  const writeSheetToSourceFile = async (sheet: ImportedSheet) => {
    if (!isLocalProviderActiveRef.current) {
      setImportError('');
      return;
    }

    try {
      const sourceResponse = await fetch('/api/aprendizes/file', {
        cache: 'no-store',
      });

      const workbook = sourceResponse.ok
        ? read(await sourceResponse.arrayBuffer(), {
            cellDates: true,
          })
        : utils.book_new();

      const sheetName =
        sheet.sheetName || workbook.SheetNames[0] || 'Aprendizes';
      const safeSheetName = sheetName.slice(0, 31);
      const previousWorksheet = workbook.Sheets[safeSheetName];
      const nextWorksheet = utils.aoa_to_sheet([
        sheet.columns,
        ...sheet.rows,
      ]);
      preserveAgeFormulas(previousWorksheet, nextWorksheet, sheet);
      workbook.Sheets[safeSheetName] = nextWorksheet;

      if (!workbook.SheetNames.includes(safeSheetName)) {
        workbook.SheetNames.push(safeSheetName);
      }

      const output = write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      }) as ArrayBuffer;

      const saveResponse = await fetch('/api/aprendizes/file', {
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
      const result = (await saveResponse.json()) as { fileName?: string };
      const savedFileName = result.fileName || sheet.fileName;

      const savedSheet = {
        ...sheet,
        fileName: savedFileName,
      };

      storeImportedSheet(savedSheet);
      void persistAprendizesDataIndex(savedSheet);
      await fetchRecoveryInfo();

      setWorkspaceStatus(`Alterações gravadas em dados/${savedFileName}.`);
      setImportError('');
    } catch {
      setImportError(
        'A alteração ficou na tela, mas não foi possível gravar em dados.',
      );
    }
  };

  const getCellValue = (
    sheet: ImportedSheet,
    rowIndex: number,
    columnName: string,
  ) => {
    const columnIndex = sheet.columns.indexOf(columnName);

    if (columnIndex < 0) {
      return null;
    }

    return sheet.rows[rowIndex]?.[columnIndex] ?? '';
  };

  const pushTableUndoEntry = (entry: TableUndoEntry) => {
    if (
      entry.kind === 'cell-edit' &&
      entry.previousValue === entry.nextValue
    ) {
      return;
    }

    cellUndoStackRef.current = [
      ...cellUndoStackRef.current,
      entry,
    ].slice(-CELL_UNDO_LIMIT);
  };

  const pushCellUndoEntry = (entry: Omit<CellEditUndoEntry, 'kind'>) => {
    if (entry.previousValue === entry.nextValue) {
      return;
    }

    pushTableUndoEntry({
      kind: 'cell-edit',
      ...entry,
    });
  };

  const getCellEditInput = (rowIndex: number, columnName: string) => {
    const rowDetailsInput =
      rowDetailsInputRefs.current[`${rowIndex}-${columnName}`];

    if (rowDetailsInput) {
      return rowDetailsInput;
    }

    const orderedColumnIndex = orderedColumns.indexOf(columnName);

    return orderedColumnIndex >= 0
      ? cellInputRefs.current[`${rowIndex}-${orderedColumnIndex}`]
      : null;
  };

  const commitCellValue = (
    rowIndex: number,
    columnName: string,
    value: string,
  ) => {
    const currentSheet = latestSheetRef.current;

    if (!currentSheet || columnName === AGE_COLUMN) {
      activeCellEditRef.current = null;
      return null;
    }

    const columnIndex = currentSheet.columns.indexOf(columnName);

    if (columnIndex < 0) {
      activeCellEditRef.current = null;
      return null;
    }

    const previousValue = currentSheet.rows[rowIndex]?.[columnIndex] || '';
    const activeEdit = activeCellEditRef.current;
    const initialValue =
      activeEdit?.rowIndex === rowIndex && activeEdit.columnName === columnName
        ? activeEdit.initialValue
        : previousValue;

    activeCellEditRef.current = null;

    if (previousValue === value) {
      return null;
    }

    const nextRows = currentSheet.rows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = value;
      return nextRow;
    });
    const nextSheet = {
      ...currentSheet,
      rows: nextRows,
    };

    pushCellUndoEntry({
      rowIndex,
      columnName,
      previousValue: initialValue,
      nextValue: value,
    });
    storeImportedSheet(nextSheet);

    return nextSheet;
  };

  const deleteRow = (rowIndex: number) => {
    const currentSheet = latestSheetRef.current;
    const deletedRow = currentSheet?.rows[rowIndex];

    if (!currentSheet || !deletedRow) {
      return null;
    }

    const nextSheet = {
      ...currentSheet,
      rows: currentSheet.rows.filter((_row, index) => index !== rowIndex),
    };

    pushTableUndoEntry({
      kind: 'row-delete',
      rowIndex,
      rowValues: deletedRow,
    });
    setSelectedDeleteRow(null);
    setSessionRegisteredRowIndexes((currentIndexes) =>
      currentIndexes
        .filter((currentRowIndex) => currentRowIndex !== rowIndex)
        .map((currentRowIndex) =>
          currentRowIndex > rowIndex ? currentRowIndex - 1 : currentRowIndex,
        ),
    );
    setHighlightedRegisteredRowIndex((currentRowIndex) => {
      if (currentRowIndex === null || currentRowIndex === rowIndex) {
        return null;
      }

      return currentRowIndex > rowIndex
        ? currentRowIndex - 1
        : currentRowIndex;
    });
    storeImportedSheet(nextSheet);

    return nextSheet;
  };

  const deleteRowAndSave = (rowIndex: number) => {
    const nextSheet = deleteRow(rowIndex);

    if (nextSheet) {
      void writeSheetToSourceFile(nextSheet);
    }
  };

  const beginCellEdit = (
    rowIndex: number,
    columnName: string,
    initialValue: string,
  ) => {
    const activeEdit = activeCellEditRef.current;

    if (
      activeEdit?.rowIndex === rowIndex &&
      activeEdit.columnName === columnName
    ) {
      return;
    }

    finalizeActiveRegistrationDraftEdit();
    activeCellEditRef.current = {
      rowIndex,
      columnName,
      initialValue,
    };
  };

  const hasAnyRegistrationDraftValue = (draft: Record<string, string>) =>
    Object.values(draft).some(
      (draftValue) => normalizeCell(draftValue) !== '',
    );

  const setRegistrationDraftColumnValue = (
    columnName: string,
    value: string,
  ) => {
    registrationDraftRef.current = {
      ...registrationDraftRef.current,
      [columnName]: value,
    };

    const nextHasValue = hasAnyRegistrationDraftValue(
      registrationDraftRef.current,
    );

    setHasRegistrationDraftValue((currentHasValue) =>
      currentHasValue === nextHasValue ? currentHasValue : nextHasValue,
    );
  };

  const getRegistrationDraftInput = (columnName: string) => {
    const orderedColumnIndex = orderedColumns.indexOf(columnName);

    return orderedColumnIndex >= 0
      ? cellInputRefs.current[`register-${orderedColumnIndex}`]
      : null;
  };

  const getRegistrationDraftCurrentValue = (columnName: string) =>
    getRegistrationDraftInput(columnName)?.value ??
    registrationDraftRef.current[columnName] ??
    '';

  const pushRegistrationDraftUndoEntry = (
    entry: RegistrationDraftUndoEntry,
  ) => {
    if (entry.previousValue === entry.nextValue) {
      return;
    }

    registrationDraftUndoStackRef.current = [
      ...registrationDraftUndoStackRef.current,
      entry,
    ].slice(-CELL_UNDO_LIMIT);
  };

  const finalizeActiveRegistrationDraftEdit = () => {
    const activeEdit = activeRegistrationEditRef.current;

    if (!activeEdit) {
      return;
    }

    const currentValue = getRegistrationDraftCurrentValue(
      activeEdit.columnName,
    );

    pushRegistrationDraftUndoEntry({
      columnName: activeEdit.columnName,
      previousValue: activeEdit.initialValue,
      nextValue: currentValue,
    });
    activeRegistrationEditRef.current = null;
  };

  const beginRegistrationDraftEdit = (
    columnName: string,
    initialValue: string,
  ) => {
    const activeEdit = activeRegistrationEditRef.current;

    if (activeEdit?.columnName === columnName) {
      return;
    }

    finalizeActiveRegistrationDraftEdit();
    activeCellEditRef.current = null;
    activeRegistrationEditRef.current = {
      columnName,
      initialValue,
    };
  };

  const updateCell = (rowIndex: number, columnName: string, value: string) => {
    const currentSheet = latestSheetRef.current;

    if (!currentSheet) {
      return;
    }

    if (columnName === AGE_COLUMN) {
      return;
    }

    const columnIndex = currentSheet.columns.indexOf(columnName);

    if (columnIndex < 0) {
      return;
    }

    const previousValue = currentSheet.rows[rowIndex]?.[columnIndex] || '';

    if (previousValue === value) {
      return;
    }
    const activeEdit = activeCellEditRef.current;

    if (
      activeEdit?.rowIndex !== rowIndex ||
      activeEdit.columnName !== columnName
    ) {
      activeCellEditRef.current = {
        rowIndex,
        columnName,
        initialValue: previousValue,
      };
    }

    const nextRows = currentSheet.rows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = value;
      return nextRow;
    });
    const nextSheet = {
      ...currentSheet,
      rows: nextRows,
    };

    storeImportedSheet(nextSheet);
  };

  const updateRegistrationDraft = (columnName: string, value: string) => {
    if (columnName === AGE_COLUMN) {
      return;
    }

    if (activeRegistrationEditRef.current?.columnName !== columnName) {
      finalizeActiveRegistrationDraftEdit();
      activeCellEditRef.current = null;
      activeRegistrationEditRef.current = {
        columnName,
        initialValue: registrationDraftRef.current[columnName] || '',
      };
    }

    setRegistrationDraftColumnValue(columnName, value);
  };

  const protectUndoCommit = () => {
    isApplyingUndoRef.current = true;

    if (undoGuardTimerRef.current !== null) {
      window.clearTimeout(undoGuardTimerRef.current);
    }

    undoGuardTimerRef.current = window.setTimeout(() => {
      isApplyingUndoRef.current = false;
      undoGuardTimerRef.current = null;
    }, 0);
  };

  const commitRegistrationDraft = async () => {
    const currentSheet = latestSheetRef.current;

    if (!currentSheet || !hasRegistrationDraftValue) {
      return;
    }

    const draftValues = registrationDraftRef.current;
    const nextRow = currentSheet.columns.map((column) =>
      column === AGE_COLUMN ? '' : draftValues[column] || '',
    );
    const nextRowIndex = currentSheet.rows.length;
    const nextSheet = {
      ...currentSheet,
      rows: [...currentSheet.rows, nextRow],
    };
    const nextRegisteredRowIndexes = [
      nextRowIndex,
      ...sessionRegisteredRowIndexes.filter(
        (rowIndex) => rowIndex !== nextRowIndex,
      ),
    ];

    activeCellEditRef.current = null;
    activeRegistrationEditRef.current = null;
    registrationDraftRef.current = {};
    registrationDraftUndoStackRef.current = [];
    setHasRegistrationDraftValue(false);
    setRegistrationDraftResetKey((currentKey) => currentKey + 1);
    setSessionRegisteredRowIndexes(nextRegisteredRowIndexes);
    setHighlightedRegisteredRowIndex(nextRowIndex);
    pushTableUndoEntry({
      kind: 'row-insert',
      rowIndex: nextRowIndex,
    });

    if (registerHighlightTimerRef.current !== null) {
      window.clearTimeout(registerHighlightTimerRef.current);
    }

    registerHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedRegisteredRowIndex(null);
      registerHighlightTimerRef.current = null;
    }, 1250);

    storeImportedSheet(nextSheet);
    window.requestAnimationFrame(() => {
      scrollToRegisteredRow(nextSheet, nextRowIndex, nextRegisteredRowIndexes);
      focusFirstRegistrationCell();
    });
    await writeSheetToSourceFile(nextSheet);
  };

  const undoActiveDraftEdit = () => {
    const activeRegistrationEdit = activeRegistrationEditRef.current;

    if (activeRegistrationEdit) {
      const orderedColumnIndex = orderedColumns.indexOf(
        activeRegistrationEdit.columnName,
      );
      const activeInput =
        orderedColumnIndex >= 0
          ? cellInputRefs.current[`register-${orderedColumnIndex}`]
          : null;
      const currentValue =
        activeInput?.value ??
        registrationDraftRef.current[activeRegistrationEdit.columnName] ??
        '';

      if (currentValue !== activeRegistrationEdit.initialValue) {
        if (activeInput) {
          activeInput.value = activeRegistrationEdit.initialValue;
          activeInput.focus();
          activeInput.select();
        }

        setRegistrationDraftColumnValue(
          activeRegistrationEdit.columnName,
          activeRegistrationEdit.initialValue,
        );

        return true;
      }
    }

    const registrationDraftUndoEntry =
      registrationDraftUndoStackRef.current.at(-1);

    if (registrationDraftUndoEntry) {
      registrationDraftUndoStackRef.current =
        registrationDraftUndoStackRef.current.slice(0, -1);

      const activeInput = getRegistrationDraftInput(
        registrationDraftUndoEntry.columnName,
      );

      if (activeInput) {
        activeInput.value = registrationDraftUndoEntry.previousValue;
        activeInput.focus();
        activeInput.select();
      }

      setRegistrationDraftColumnValue(
        registrationDraftUndoEntry.columnName,
        registrationDraftUndoEntry.previousValue,
      );
      activeRegistrationEditRef.current = {
        columnName: registrationDraftUndoEntry.columnName,
        initialValue: registrationDraftUndoEntry.previousValue,
      };

      return true;
    }

    const activeEdit = activeCellEditRef.current;
    const currentSheet = latestSheetRef.current;

    if (!activeEdit || !currentSheet) {
      return false;
    }

    const activeInput = getCellEditInput(
      activeEdit.rowIndex,
      activeEdit.columnName,
    );
    const savedValue = getCellValue(
      currentSheet,
      activeEdit.rowIndex,
      activeEdit.columnName,
    );
    const currentValue = activeInput?.value ?? savedValue ?? '';

    if (savedValue !== null && currentValue !== activeEdit.initialValue) {
      if (activeInput) {
        activeInput.value = activeEdit.initialValue;
        activeInput.focus();
        activeInput.select();
      }

      return true;
    }

    if (activeInput && savedValue !== null && activeInput.value !== savedValue) {
      activeInput.value = activeEdit.initialValue;
      activeInput.focus();
      activeInput.select();
      return true;
    }

    return false;
  };

  const undoLastCellEdit = () => {
    if (undoActiveDraftEdit()) {
      return true;
    }

    protectUndoCommit();
    activeCellEditRef.current = null;
    activeRegistrationEditRef.current = null;

    const currentSheet = latestSheetRef.current;
    const undoEntry = cellUndoStackRef.current.at(-1);

    if (!currentSheet || !undoEntry) {
      return false;
    }

    if (undoEntry.kind === 'row-insert') {
      if (!currentSheet.rows[undoEntry.rowIndex]) {
        cellUndoStackRef.current = cellUndoStackRef.current.slice(0, -1);
        return false;
      }

      cellUndoStackRef.current = cellUndoStackRef.current.slice(0, -1);

      const nextSheet = {
        ...currentSheet,
        rows: currentSheet.rows.filter(
          (_row, index) => index !== undoEntry.rowIndex,
        ),
      };

      setSessionRegisteredRowIndexes((currentIndexes) =>
        currentIndexes
          .filter((rowIndex) => rowIndex !== undoEntry.rowIndex)
          .map((rowIndex) =>
            rowIndex > undoEntry.rowIndex ? rowIndex - 1 : rowIndex,
          ),
      );
      setHighlightedRegisteredRowIndex((currentRowIndex) => {
        if (currentRowIndex === null) {
          return null;
        }

        if (currentRowIndex === undoEntry.rowIndex) {
          return null;
        }

        return currentRowIndex > undoEntry.rowIndex
          ? currentRowIndex - 1
          : currentRowIndex;
      });
      storeImportedSheet(nextSheet);
      window.requestAnimationFrame(() => {
        if (isRegistrationMode) {
          focusFirstRegistrationCell();
        }
      });
      return nextSheet;
    }

    if (undoEntry.kind === 'row-delete') {
      cellUndoStackRef.current = cellUndoStackRef.current.slice(0, -1);

      const nextRows = [...currentSheet.rows];
      nextRows.splice(undoEntry.rowIndex, 0, undoEntry.rowValues);

      const nextSheet = {
        ...currentSheet,
        rows: nextRows,
      };

      setSessionRegisteredRowIndexes((currentIndexes) =>
        currentIndexes.map((rowIndex) =>
          rowIndex >= undoEntry.rowIndex ? rowIndex + 1 : rowIndex,
        ),
      );
      setHighlightedRegisteredRowIndex((currentRowIndex) =>
        currentRowIndex !== null && currentRowIndex >= undoEntry.rowIndex
          ? currentRowIndex + 1
          : currentRowIndex,
      );
      storeImportedSheet(nextSheet);
      return nextSheet;
    }

    const columnIndex = currentSheet.columns.indexOf(undoEntry.columnName);

    if (columnIndex < 0 || !currentSheet.rows[undoEntry.rowIndex]) {
      cellUndoStackRef.current = cellUndoStackRef.current.slice(0, -1);
      return false;
    }

    cellUndoStackRef.current = cellUndoStackRef.current.slice(0, -1);

    const nextRows = currentSheet.rows.map((row, index) => {
      if (index !== undoEntry.rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = undoEntry.previousValue;
      return nextRow;
    });

    const nextSheet = {
      ...currentSheet,
      rows: nextRows,
    };

    storeImportedSheet(nextSheet);
    window.requestAnimationFrame(() => {
      const orderedColumnIndex = orderedColumns.indexOf(undoEntry.columnName);

      if (orderedColumnIndex < 0) {
        return;
      }

      scrollToRegisteredRow(
        nextSheet,
        undoEntry.rowIndex,
        sessionRegisteredRowIndexes,
      );
      focusCell(undoEntry.rowIndex, orderedColumnIndex);
    });
    return nextSheet;
  };

  const undoLastCellEditAndSave = () => {
    const nextSheet = undoLastCellEdit();

    if (nextSheet && nextSheet !== true) {
      void writeSheetToSourceFile(nextSheet);
    }

    return Boolean(nextSheet);
  };

  const focusCell = (rowIndex: number, columnIndex: number) => {
    const columnName = orderedColumns[columnIndex];
    const rowDetailsInput = columnName
      ? rowDetailsInputRefs.current[`${rowIndex}-${columnName}`]
      : null;

    if (rowDetailsInput) {
      rowDetailsInput.focus();
      rowDetailsInput.select();
      return;
    }

    const key = `${rowIndex}-${columnIndex}`;
    const input = cellInputRefs.current[key];

    input?.focus();
    input?.select();
  };

  const focusRegistrationCell = (columnIndex: number) => {
    const key = `register-${columnIndex}`;
    const input = cellInputRefs.current[key];

    input?.focus();
    input?.select();
  };

  const focusFirstRegistrationCell = () => {
    const firstEditableColumnIndex = orderedColumns.findIndex(
      (column) => column !== AGE_COLUMN,
    );

    if (firstEditableColumnIndex < 0) {
      return;
    }

    window.requestAnimationFrame(() =>
      focusRegistrationCell(firstEditableColumnIndex),
    );
  };

  useEffect(() => {
    if (!isRegistrationMode || !importedSheet) {
      return;
    }

    if (wasRegistrationModeRef.current) {
      return;
    }

    wasRegistrationModeRef.current = true;
    focusFirstRegistrationCell();
  }, [isRegistrationMode, Boolean(importedSheet)]);

  const handleCellNavigation = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return;
    }

    event.preventDefault();

    const nextRowIndex =
      event.key === 'ArrowUp'
        ? Math.max(0, rowIndex - 1)
        : event.key === 'ArrowDown'
          ? Math.min((importedSheet?.rows.length ?? 1) - 1, rowIndex + 1)
          : rowIndex;
    const nextColumnIndex =
      event.key === 'ArrowLeft'
        ? Math.max(0, columnIndex - 1)
        : event.key === 'ArrowRight'
          ? Math.min(orderedColumns.length - 1, columnIndex + 1)
          : columnIndex;

    window.requestAnimationFrame(() => focusCell(nextRowIndex, nextColumnIndex));
  };

  const syncHeaderScroll = () => {
    if (!tableHeaderScrollRef.current || !tableBodyScrollRef.current) {
      return;
    }

    tableHeaderScrollRef.current.scrollLeft = tableBodyScrollRef.current.scrollLeft;
  };

  useEffect(() => {
    syncHeaderScroll();
  }, [importedSheet, orderedColumns]);

  const tableClassName = [
    'data-table',
    isEditMode ? 'editing' : '',
    isDeleteMode ? 'delete-mode' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const hasWorkingSheet = Boolean(importedSheet);
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);
  const toggleEditMode = () => {
    setIsEditMode((current) => {
      const nextMode = !current;

      if (nextMode) {
        setIsRegistrationMode(false);
        setIsDeleteMode(false);
        setSelectedDeleteRow(null);
      }

      return nextMode;
    });
  };
  const toggleRegistrationMode = () => {
    setIsRegistrationMode((current) => {
      const nextMode = !current;

      if (nextMode) {
        setIsEditMode(false);
        setIsDeleteMode(false);
        setSelectedDeleteRow(null);
      }

      return nextMode;
    });
  };
  const toggleDeleteMode = () => {
    setIsDeleteMode((current) => {
      const nextMode = !current;

      if (nextMode) {
        setIsEditMode(false);
        setIsRegistrationMode(false);
        setSelectedDetailsRow(null);
      } else {
        setSelectedDeleteRow(null);
      }

      return nextMode;
    });
  };
  const recoveryButtonLabel =
    recoveryInfo?.formattedUpdatedAt
      ? `Recuperar ${recoveryInfo.label || 'Aprendizes'} - ${
          recoveryInfo.formattedUpdatedAt
        }`
      : `Recuperar ${recoveryInfo?.label || 'Aprendizes'}`;
  const recoveryDescription = getRecoveryDescription(recoveryInfo);
  const selectedDetailsRowValues =
    importedSheet && selectedDetailsRow
      ? importedSheet.rows[selectedDetailsRow.rowIndex] || null
      : null;
  const selectedDetailsNameColumn =
    importedSheet?.columns.find(
      (column) => column.trim().toLowerCase() === 'nome',
    ) ||
    importedSheet?.columns[0] ||
    'Nome';
  const selectedDetailsName =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          selectedDetailsNameColumn,
        )
      : '';
  const isRowDetailsPanelPositioned =
    rowDetailsPanelStyle.display !== 'none' &&
    rowDetailsPanelStyle.left !== undefined &&
    rowDetailsPanelStyle.top !== undefined &&
    rowDetailsPanelStyle.width !== undefined &&
    rowDetailsPanelStyle.height !== undefined;
  const renderColumnGroup = () => (
    <colgroup>
      {orderedColumns.map((column) => (
        <col key={column} style={getColumnWidthStyle(column)} />
      ))}
    </colgroup>
  );
  const renderHeaderColumnGroup = () => (
    <colgroup>
      {orderedColumns.map((column) => (
        <col key={column} style={getColumnWidthStyle(column)} />
      ))}
      <col className="table-scrollbar-spacer-column" />
    </colgroup>
  );
  const getDeleteHintPosition = () => {
    const tableBodyRect = tableBodyScrollRef.current?.getBoundingClientRect();

    if (!tableBodyRect || selectedDeleteRow === null) {
      return { left: 0, top: 0 };
    }

    const calculatedTop =
      tableBodyRect.top +
      selectedDeleteRow.visualIndex * getCurrentTableRowHeight() -
      tableScrollTop +
      getCurrentTableRowHeight() +
      6;
    const viewportBottom = window.innerHeight - 44;

    return {
      left: tableBodyRect.left + 10,
      top: Math.min(calculatedTop, viewportBottom),
    };
  };
  const deleteHintPosition = getDeleteHintPosition();
  const renderRegistrationRow = () => (
    <table className={`${tableClassName} data-table-register`}>
      {renderHeaderColumnGroup()}
      <tbody>
        <tr className="register-row">
          {orderedColumns.map((column, orderedColumnIndex) => {
            const value = getRegistrationDraftDisplayValue(column);

            return (
              <td
                key={`register-${column}`}
                className={[
                  'register-cell',
                  orderedColumnIndex === 0 ? 'pinned-column' : '',
                  column === AGE_COLUMN ? 'derived-cell' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={getColumnWidthStyle(column)}
              >
                {column !== AGE_COLUMN ? (
                  <input
                    key={`${registrationDraftResetKey}-${column}`}
                    ref={(element) => {
                      cellInputRefs.current[`register-${orderedColumnIndex}`] =
                        element;
                    }}
                    aria-label={`${column} cadastrar aprendiz`}
                    data-registration-input="true"
                    spellCheck={false}
                    size={Math.max(value.length, 1)}
                    style={
                      {
                        '--edit-input-width': `${Math.max(
                          value.length + 2,
                          1,
                        )}ch`,
                      } as CSSProperties
                    }
                    defaultValue={value}
                    onFocus={(event) => {
                      beginRegistrationDraftEdit(column, event.currentTarget.value);
                      setIsRegistrationFocused(true);
                    }}
                    onBlur={() => {
                      window.requestAnimationFrame(() => {
                        const activeElement = document.activeElement;
                        const nextIsRegistrationFocused =
                          activeElement instanceof HTMLElement &&
                          activeElement.dataset.registrationInput === 'true';

                        setIsRegistrationFocused(nextIsRegistrationFocused);

                        if (!nextIsRegistrationFocused) {
                          finalizeActiveRegistrationDraftEdit();
                        }
                      });
                    }}
                    onChange={(event) =>
                      updateRegistrationDraft(column, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void commitRegistrationDraft();
                        return;
                      }

                      if (
                        ![
                          'ArrowDown',
                          'ArrowLeft',
                          'ArrowRight',
                        ].includes(event.key)
                      ) {
                        return;
                      }

                      event.preventDefault();

                      if (event.key === 'ArrowDown') {
                        const nextRow = displayedRows[0];

                        if (nextRow) {
                          window.requestAnimationFrame(() =>
                            focusCell(nextRow.rowIndex, orderedColumnIndex),
                          );
                        }

                        return;
                      }

                      const nextColumnIndex =
                        event.key === 'ArrowLeft'
                          ? Math.max(0, orderedColumnIndex - 1)
                          : Math.min(
                              orderedColumns.length - 1,
                              orderedColumnIndex + 1,
                            );

                      window.requestAnimationFrame(() =>
                        focusRegistrationCell(nextColumnIndex),
                      );
                    }}
                  />
                ) : (
                  value
                )}
              </td>
            );
          })}
          <td className="table-scrollbar-spacer" aria-hidden="true" />
        </tr>
      </tbody>
    </table>
  );
  const getHeaderCellClassName = (
    column: string,
    orderedColumnIndex: number,
  ) =>
    [
      orderedColumnIndex === 0 ? 'pinned-column' : '',
      isEditMode ? '' : 'sortable-column',
      sortState?.columnName === column
        ? `sorted-${sortState.direction === 'asc' ? 'ascending' : 'descending'}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <section className="feature-page" aria-labelledby="aprendizes-title">
      <div
        className={
          isRecoveryDialogOpen
            ? 'feature-page-main page-modal-blurred'
            : 'feature-page-main'
        }
      >
        <div className="feature-heading">
          <div>
            <h1 id="aprendizes-title">Aprendizes</h1>
          </div>
          <div className="table-toolbar" aria-label="Ações da tabela">
            <div className="table-toolbar-track">
            <button
              className={
                hasWorkingSheet && isEditMode
                  ? 'square-action active'
                  : hasWorkingSheet
                    ? 'square-action'
                    : 'square-action disabled'
              }
              type="button"
              aria-label="Editar visualização da tabela"
              aria-pressed={hasWorkingSheet ? isEditMode : false}
              title="Editar tabela"
              disabled={!hasWorkingSheet}
              onClick={toggleEditMode}
            >
              <PencilIcon />
            </button>
            <button
              className={
                hasWorkingSheet && isRegistrationMode
                  ? 'square-action active'
                  : hasWorkingSheet
                    ? 'square-action'
                  : 'square-action disabled'
              }
              type="button"
              aria-label="Cadastrar aprendiz"
              aria-pressed={hasWorkingSheet ? isRegistrationMode : false}
              title="Cadastrar Aprendiz"
              disabled={!hasWorkingSheet}
              onClick={toggleRegistrationMode}
            >
              <UserStarIcon />
            </button>
            <button
              className={
                hasWorkingSheet && isDeleteMode
                  ? 'square-action active'
                  : hasWorkingSheet
                    ? 'square-action'
                  : 'square-action disabled'
              }
              type="button"
              aria-label="Deletar cadastro"
              aria-pressed={hasWorkingSheet ? isDeleteMode : false}
              title="Deletar Cadastro"
              disabled={!hasWorkingSheet}
              onClick={toggleDeleteMode}
            >
              <UserXIcon />
            </button>
            <button
              className={
                hasWorkingSheet && canRecoverBackup
                  ? 'square-action toolbar-section-start'
                  : 'square-action toolbar-section-start disabled'
              }
              type="button"
              aria-label="Recuperar dados"
              title="Recuperar Dados"
              disabled={!hasWorkingSheet || !canRecoverBackup}
              onClick={() => setIsRecoveryDialogOpen(true)}
            >
              <RotateClockwiseIcon />
            </button>
            <button
              className="square-action"
              type="button"
              aria-label="Substituir planilha .xlsx"
              title="Importar .xlsx"
              onClick={() => void importFromPicker()}
            >
              <ImportIcon />
            </button>
            <button
              className={
                hasWorkingSheet
                  ? 'square-action'
                  : 'square-action disabled'
              }
              type="button"
              aria-label="Exportar dados"
              title="Exportar Dados"
              disabled={!hasWorkingSheet}
              onClick={() => void exportWorkingFile()}
            >
              <ExportIcon />
            </button>
            <ThemeToggleButton className="toolbar-section-start" />
            </div>
          </div>
      </div>

      {hasCheckedWorkspace && !importedSheet && (
        <div
          className={
            isDragging
              ? 'empty-data-state empty-tool-state dragging'
              : 'empty-data-state empty-tool-state'
          }
          role="region"
          aria-label="Importar planilha de aprendizes"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <button
            className="primary-action import-empty-action"
            type="button"
            onClick={() => void importFromPicker()}
          >
            <ImportIcon />
            Importar .xlsx
          </button>
        </div>
      )}

      {importedSheet && (
        <div className="data-table-panel">
          <div className="data-table-frame" ref={tableFrameRef}>
            <div
              className="data-table-header-scroll"
              ref={tableHeaderScrollRef}
            >
              <table className={`${tableClassName} data-table-header`}>
                {renderHeaderColumnGroup()}
              <thead>
                <tr>
                  {orderedColumns.map((column, orderedColumnIndex) => (
                    <th
                      key={column}
                      className={getHeaderCellClassName(
                        column,
                        orderedColumnIndex,
                      )}
                      style={getColumnWidthStyle(column)}
                      draggable={isEditMode}
                      onClick={() => cycleColumnSort(column)}
                      onDragStart={() => setDraggedColumn(column)}
                      onDragOver={(event) => {
                        if (isEditMode) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        moveColumn(draggedColumn, column);
                        setDraggedColumn('');
                      }}
                      onDragEnd={() => setDraggedColumn('')}
                    >
                      <span className="column-heading-label">{column}</span>
                      {isEditMode && (
                        <span
                          className="column-resize-handle"
                          aria-hidden="true"
                          onPointerDown={(event) =>
                            startColumnResize(event, column)
                          }
                        />
                      )}
                    </th>
                  ))}
                  <th className="table-scrollbar-spacer" aria-hidden="true" />
                </tr>
              </thead>
              </table>
              {isRegistrationMode && renderRegistrationRow()}
            </div>
            {isRegistrationMode && showRegistrationHint && (
              <div className="register-row-hint" aria-live="polite">
                Aperte <kbd>Enter</kbd> para cadastrar
              </div>
            )}
            {isDeleteMode && selectedDeleteRow !== null && (
              <div
                className="register-row-hint delete-row-hint"
                style={{
                  left: `${deleteHintPosition.left}px`,
                  top: `${deleteHintPosition.top}px`,
                }}
                aria-live="polite"
              >
                Aperte <kbd>Delete</kbd> para descadastrar
              </div>
            )}
            <div
              className="data-table-body-scroll"
              ref={tableBodyScrollRef}
              role="region"
              tabIndex={0}
              onScroll={(event) => {
                syncHeaderScroll();
                setTableScrollTop(event.currentTarget.scrollTop);
              }}
            >
              <table className={`${tableClassName} data-table-body`}>
                {renderColumnGroup()}
              <tbody>
                {displayedRows.map(({ row, rowIndex }, visualIndex) => (
                  <tr
                    key={rowIndex}
                    className={
                      [
                        rowIndex === highlightedRegisteredRowIndex
                          ? 'registered-row-highlight'
                          : '',
                        selectedDeleteRow?.rowIndex === rowIndex
                          ? 'delete-row-selected'
                          : '',
                        selectedDetailsRow?.rowIndex === rowIndex
                          ? 'row-details-selected'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                    onClick={() => {
                      if (isDeleteMode) {
                        setTableScrollTop(
                          tableBodyScrollRef.current?.scrollTop ?? 0,
                        );
                        setSelectedDeleteRow({ rowIndex, visualIndex });
                        return;
                      }

                      if (!isEditMode && !isRegistrationMode) {
                        setSelectedDetailsRow({ rowIndex, visualIndex });
                      }
                    }}
                  >
                    {orderedColumns.map((column, orderedColumnIndex) => {
                      const columnIndex = importedSheet.columns.indexOf(column);
                      const value = row[columnIndex] || '';
                      const displayValue = getDisplayCellValue(
                        importedSheet,
                        row,
                        column,
                      );

                      return (
                        <td
                          key={`${column}-${columnIndex}`}
                          className={[
                            orderedColumnIndex === 0 ? 'pinned-column' : '',
                            column === AGE_COLUMN ? 'derived-cell' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={getColumnWidthStyle(column)}
                        >
                          {areBodyEditInputsReady && column !== AGE_COLUMN ? (
                            <input
                              key={`${rowIndex}-${column}-${value}`}
                              ref={(element) => {
                                cellInputRefs.current[
                                  `${rowIndex}-${orderedColumnIndex}`
                                ] = element;
                              }}
                              aria-label={`${column} linha ${rowIndex + 1}`}
                              spellCheck={false}
                              size={Math.max(value.length, 1)}
                              style={
                                {
                                  '--edit-input-width': `${Math.max(
                                    value.length + 2,
                                    1,
                                  )}ch`,
                                } as CSSProperties
                              }
                              defaultValue={value}
                              onFocus={() =>
                                beginCellEdit(rowIndex, column, value)
                              }
                              onChange={() =>
                                beginCellEdit(rowIndex, column, value)
                              }
                              onKeyDown={(event) => {
                                handleCellNavigation(
                                  event,
                                  rowIndex,
                                  orderedColumnIndex,
                                );

                                if (event.key !== 'Enter') {
                                  return;
                                }

                                event.preventDefault();
                                const sheet = commitCellValue(
                                  rowIndex,
                                  column,
                                  event.currentTarget.value,
                                );

                                if (sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                              onBlur={(event) => {
                                if (isApplyingUndoRef.current) {
                                  return;
                                }

                                const sheet = commitCellValue(
                                  rowIndex,
                                  column,
                                  event.currentTarget.value,
                                );

                                if (sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                            />
                          ) : (
                            displayValue
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
            {selectedDetailsRow && !isEditMode && !isRegistrationMode && !isDeleteMode && (
              <aside
                className="row-details-panel"
                style={{
                  visibility: isRowDetailsPanelPositioned
                    ? 'visible'
                    : 'hidden',
                  ...rowDetailsPanelStyle,
                }}
                aria-label="Detalhes do aprendiz"
              >
                <div className="row-details-content">
                    <section
                      className="row-details-info-section"
                      aria-label="Informações do aprendiz"
                    >
                      <div className="row-details-field-layer">
                        <div className="row-details-field row-details-field-name">
                          <span className="row-details-field-label">Nome</span>
                          <span className="row-details-field-value">
                            <input
                              key={`${selectedDetailsRow.rowIndex}-${selectedDetailsNameColumn}-${selectedDetailsName}`}
                              ref={(element) => {
                                rowDetailsInputRefs.current[
                                  `${selectedDetailsRow.rowIndex}-${selectedDetailsNameColumn}`
                                ] = element;
                              }}
                              className="row-details-field-value-input"
                              aria-label={`${selectedDetailsNameColumn} do aprendiz`}
                              spellCheck={false}
                              defaultValue={selectedDetailsName}
                              onFocus={() =>
                                beginCellEdit(
                                  selectedDetailsRow.rowIndex,
                                  selectedDetailsNameColumn,
                                  selectedDetailsName,
                                )
                              }
                              onChange={() =>
                                beginCellEdit(
                                  selectedDetailsRow.rowIndex,
                                  selectedDetailsNameColumn,
                                  selectedDetailsName,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter') {
                                  return;
                                }

                                event.preventDefault();
                                const sheet = commitCellValue(
                                  selectedDetailsRow.rowIndex,
                                  selectedDetailsNameColumn,
                                  event.currentTarget.value,
                                );

                                if (sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                              onBlur={(event) => {
                                if (isApplyingUndoRef.current) {
                                  return;
                                }

                                const sheet = commitCellValue(
                                  selectedDetailsRow.rowIndex,
                                  selectedDetailsNameColumn,
                                  event.currentTarget.value,
                                );

                                if (sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                            />
                          </span>
                        </div>
                      </div>
                      {Array.from({ length: 7 }, (_, layerIndex) => (
                        <div
                          className="row-details-field-layer row-details-template-layer"
                          key={`template-layer-${layerIndex}`}
                        >
                          <div className="row-details-field row-details-field-name">
                            <span className="row-details-field-label">Nome</span>
                            <span className="row-details-field-value">
                              <input
                                className="row-details-field-value-input"
                                aria-label={`Modelo ${layerIndex + 1}`}
                                readOnly
                                tabIndex={-1}
                                value=""
                              />
                            </span>
                          </div>
                        </div>
                      ))}
                    </section>
                    <footer
                      className="row-details-actions"
                      aria-label="Ações do aprendiz"
                    >
                      <button
                        className="row-details-action-button"
                        type="button"
                        aria-disabled="true"
                      >
                        Ação
                      </button>
                    </footer>
                </div>
                <button
                  className="row-details-close-button"
                  type="button"
                  aria-label="Fechar detalhes"
                  onClick={() => {
                    setSelectedDetailsRow(null);
                    applyRowDetailsPanelStyle({});
                  }}
                >
                  <CloseIcon />
                </button>
              </aside>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => {
          void importWorkingFile(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      </div>

      {isRecoveryDialogOpen && (
        <div
          className="page-modal-backdrop"
          role="presentation"
          onMouseDown={() => setIsRecoveryDialogOpen(false)}
        >
          <div
            className="recovery-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="recovery-dialog-header">
              <h2 id="recovery-dialog-title">Recuperar Dados</h2>
              <button
                className="dialog-close-button"
                type="button"
                aria-label="Fechar"
                onClick={() => setIsRecoveryDialogOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <p>{recoveryDescription}</p>
            <button
              className="primary-action recovery-confirm-action"
              type="button"
              disabled={!canRecoverBackup || isRecoveringBackup}
              onClick={() => void recoverBackup()}
            >
              <RotateClockwiseIcon />
              {isRecoveringBackup ? 'Recuperando...' : recoveryButtonLabel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function getRecoveryDescription(info: RecoveryInfo | null) {
  switch (info?.reason) {
    case 'before_import':
      return 'Recupere os dados anteriores \u00e0 \u00faltima importa\u00e7\u00e3o.';
    case 'before_edit':
      return 'Recupere os dados para como estavam antes de edi\u00e7\u00f5es nesta sess\u00e3o.';
    case 'before_session_edit':
      return 'Recupere os dados para como estavam antes da \u00faltima sess\u00e3o com edi\u00e7\u00f5es.';
    case 'import_original':
      return 'Recupere os dados originais da planilha importada.';
    case 'before_recovery':
      return 'Recupere os dados para como estavam antes da \u00faltima recupera\u00e7\u00e3o.';
    case 'after_recovery':
      return 'Recupere os dados para como estavam ap\u00f3s a \u00faltima recupera\u00e7\u00e3o.';
    default:
      return 'Nenhum backup dispon\u00edvel para recuperar.';
  }
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l10.5 -10.5a2.8 2.8 0 0 0 -4 -4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4 -4" />
      <path d="M5 21h14" />
      <path d="M5 17v4" />
      <path d="M19 17v4" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="m8 7 4 -4 4 4" />
      <path d="M5 21h14" />
      <path d="M5 17v4" />
      <path d="M19 17v4" />
    </svg>
  );
}

function RotateClockwiseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.95 11a8 8 0 1 0 -.5 4" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function UserXIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h3.5" />
      <path d="M15.7 15.9l5.1 5.1" />
      <path d="M20.8 15.9l-5.1 5.1" />
    </svg>
  );
}

function UserStarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h2.5" />
      <path d="M18 14l1.18 2.38l2.62 .38l-1.9 1.84l.45 2.6l-2.35 -1.23l-2.35 1.23l.45 -2.6l-1.9 -1.84l2.62 -.38l1.18 -2.38Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
