import {
  useEffect,
  type FormEvent,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  APRENDIZES_ENTITY_ID,
  buildAprendizesDataIndexEntity,
  buildEmptyDataIndexEntity,
} from '../../shared/data/dataIndex';
import {
  APRENDIZES_REQUIRED_COLUMNS,
  normalizeFieldLabel,
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
const SEX_COLUMN = 'Sexo';
const CONTACT_COLUMN = 'Contato';
const EMAIL_COLUMN = 'E-mail';
const RG_COLUMN = 'RG';
const CPF_COLUMN = 'CPF';
const ADDRESS_COLUMN = 'Endereço';
const RESPONSIBLE_COLUMN = 'Responsável';
const RESPONSIBLE_CONTACT_COLUMN = 'Contato do Responsável';
const RESPONSIBLE_EMAIL_COLUMN = 'E-mail do Responsável';
const INSTITUTION_COLUMN = 'Instituição de Ensino';
const COMPANY_COLUMN = 'Empresa';
const LEARNING_ARC_COLUMN = 'Arco de Aprendizagem';
const ROLE_COLUMN = 'Função';
const ADMISSION_DATE_COLUMN = 'Data de Admissão';
const END_DATE_COLUMN = 'Data do Término';
const CLASS_COLUMN = 'Turma';
const REMOVED_APRENDIZES_COLUMNS = new Set([normalizeFieldLabel('Período')]);
const ROW_DETAILS_PANEL_MARGIN = 20;
const ROW_DETAILS_PANEL_HEIGHT = 360;
const ROW_DETAILS_PANEL_WIDTH = ROW_DETAILS_PANEL_HEIGHT * 1.4;
const TABLE_FONT = '12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TABLE_HEADER_FONT =
  '800 12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';

type XlsxModule = typeof import('xlsx');
type XlsxWorksheet = ReturnType<XlsxModule['utils']['aoa_to_sheet']>;

let xlsxModulePromise: Promise<XlsxModule> | null = null;

const loadXlsx = () => {
  xlsxModulePromise ??= import('xlsx');
  return xlsxModulePromise;
};

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

type RegistrationDraftEditUndoEntry = {
  kind: 'registration-draft-edit';
  columnName: string;
  previousValue: string;
  nextValue: string;
};

type TableUndoEntry =
  | CellEditUndoEntry
  | RowInsertUndoEntry
  | RowDeleteUndoEntry
  | RegistrationDraftEditUndoEntry;

type ActiveCellEdit = {
  rowIndex: number;
  columnName: string;
  initialValue: string;
};

type ActiveRegistrationEdit = {
  columnName: string;
  initialValue: string;
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

type AprendizesPageProps = {
  onInitialReady?: () => void;
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

const invalidImportedFileMessage =
  'Arquivo escolhido não possui os valores necessários';

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

export function AprendizesPage({ onInitialReady }: AprendizesPageProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowDetailsInputRefs = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );
  const cellUndoStackRef = useRef<TableUndoEntry[]>([]);
  const activeCellEditRef = useRef<ActiveCellEdit | null>(null);
  const activeRegistrationEditRef = useRef<ActiveRegistrationEdit | null>(null);
  const isApplyingUndoRef = useRef(false);
  const undoGuardTimerRef = useRef<number | null>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement>(null);
  const tableBodyScrollRef = useRef<HTMLDivElement>(null);
  const tableFrameRef = useRef<HTMLDivElement>(null);
  const registerHighlightTimerRef = useRef<number | null>(null);
  const invalidImportToastTimerRef = useRef<number | null>(null);
  const wasRegistrationModeRef = useRef(false);
  const didSignalInitialReadyRef = useRef(false);
  const registrationDraftRef = useRef<Record<string, string>>({});
  const [importedSheet, setImportedSheet] = useState<ImportedSheet | null>(null);
  const latestSheetRef = useRef<ImportedSheet | null>(importedSheet);
  const isLocalProviderActiveRef = useRef(false);
  const [viewSettings, setViewSettings] = useState<TableViewSettings>(
    readSavedViewSettings,
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [isRegistrationMode, setIsRegistrationMode] = useState(false);
  const [areBodyEditInputsReady, setAreBodyEditInputsReady] = useState(false);
  const sortState = viewSettings.sortState;
  const [draggedColumn, setDraggedColumn] = useState('');
  const [importError, setImportError] = useState('');
  const [invalidImportToast, setInvalidImportToast] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [hasCheckedWorkspace, setHasCheckedWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [isRecoveringBackup, setIsRecoveringBackup] = useState(false);
  const [hasRegistrationDraftValue, setHasRegistrationDraftValue] =
    useState(false);
  const [registrationDraftVersion, setRegistrationDraftVersion] = useState(0);
  const [registrationDraftResetKey, setRegistrationDraftResetKey] = useState(0);
  const [sessionRegisteredRowIndexes, setSessionRegisteredRowIndexes] =
    useState<number[]>([]);
  const [highlightedRegisteredRowIndex, setHighlightedRegisteredRowIndex] =
    useState<number | null>(null);
  const [selectedDetailsRow, setSelectedDetailsRow] = useState<{
    rowIndex: number;
    visualIndex: number;
  } | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<{
    left: number;
    top: number;
    value: string;
  } | null>(null);
  const rowDetailsPanelStyleRef = useRef<CSSProperties>({});
  const [rowDetailsPanelStyle, setRowDetailsPanelStyle] =
    useState<CSSProperties>({});
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
  const showInvalidImportToast = () => {
    setInvalidImportToast(invalidImportedFileMessage);

    if (invalidImportToastTimerRef.current !== null) {
      window.clearTimeout(invalidImportToastTimerRef.current);
    }

    invalidImportToastTimerRef.current = window.setTimeout(() => {
      setInvalidImportToast('');
      invalidImportToastTimerRef.current = null;
    }, 3000);
  };

  const clearWorkingSheet = () => {
    cellUndoStackRef.current = [];
    activeCellEditRef.current = null;
    activeRegistrationEditRef.current = null;
    latestSheetRef.current = null;
    setImportedSheet(null);
    setRecoveryInfo(null);
    registrationDraftRef.current = {};
    setHasRegistrationDraftValue(false);
    setRegistrationDraftVersion((currentVersion) => currentVersion + 1);
    setRegistrationDraftResetKey((currentKey) => currentKey + 1);
    setIsEditMode(false);
    setIsRegistrationMode(false);
    setSelectedDetailsRow(null);
    applyRowDetailsPanelStyle({});
    setSessionRegisteredRowIndexes([]);
    setHighlightedRegisteredRowIndex(null);
  };

  const saveImportedSheet = (
    sheet: ImportedSheet,
    options: { resetColumnWidths?: boolean } = {},
  ) => {
    cellUndoStackRef.current = [];
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
    setRegistrationDraftVersion((currentVersion) => currentVersion + 1);
    setRegistrationDraftResetKey((currentKey) => currentKey + 1);
    setIsEditMode(false);
    setIsRegistrationMode(false);
    setSelectedDetailsRow(null);
    applyRowDetailsPanelStyle({});
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
        showInvalidImportToast();
        setImportError('');
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
        showInvalidImportToast();
        setImportError('');
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

    const { read, utils } = await loadXlsx();
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
    const { missingColumns, normalizedColumns } =
      normalizeColumnsForSchema(rawColumns, APRENDIZES_REQUIRED_COLUMNS);

    if (missingColumns.length > 0) {
      throw new MissingRequiredColumnsError(missingColumns);
    }

    const keptColumnIndexes = normalizedColumns
      .map((column, columnIndex) => ({ column, columnIndex }))
      .filter(
        ({ column }) => !REMOVED_APRENDIZES_COLUMNS.has(normalizeFieldLabel(column)),
      );
    const columns = keptColumnIndexes.map(({ column }) => column);
    const rows = sheetRows
      .slice(headerIndex + 1)
      .map((row) =>
        keptColumnIndexes.map(({ columnIndex }) => normalizeCell(row[columnIndex])),
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
    if (!hasCheckedWorkspace || didSignalInitialReadyRef.current) {
      return;
    }

    didSignalInitialReadyRef.current = true;
    onInitialReady?.();
  }, [hasCheckedWorkspace, onInitialReady]);

  useEffect(
    () => () => {
      if (invalidImportToastTimerRef.current !== null) {
        window.clearTimeout(invalidImportToastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isEditMode) {
      setAreBodyEditInputsReady(false);
      activeCellEditRef.current = null;
    }
  }, [isEditMode]);

  useEffect(() => {
    if (!isRegistrationMode) {
      registrationDraftRef.current = {};
      activeRegistrationEditRef.current = null;
      cellUndoStackRef.current = cellUndoStackRef.current.filter(
        (entry) => entry.kind !== 'registration-draft-edit',
      );
      setHasRegistrationDraftValue(false);
      setRegistrationDraftVersion((currentVersion) => currentVersion + 1);
      setRegistrationDraftResetKey((currentKey) => currentKey + 1);
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
    if (!importedSheet) {
      return;
    }

    const handleUndoShortcut = (event: globalThis.KeyboardEvent) => {
      runUndoShortcut(event);
    };

    window.addEventListener('keydown', handleUndoShortcut, {
      capture: true,
    });

    return () =>
      window.removeEventListener('keydown', handleUndoShortcut, {
        capture: true,
      });
  }, [importedSheet, isEditMode, isRegistrationMode, selectedDetailsRow]);

  useEffect(() => {
    if (isEditMode) {
      setSelectedDetailsRow(null);
      setIsRegistrationMode(false);
      applyRowDetailsPanelStyle({});
    }
  }, [isEditMode]);

  useEffect(() => {
    if (!cellContextMenu) {
      return;
    }

    const closeContextMenu = () => setCellContextMenu(null);
    const closeContextMenuOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('keydown', closeContextMenuOnEscape);
    window.addEventListener('scroll', closeContextMenu, true);

    return () => {
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('keydown', closeContextMenuOnEscape);
      window.removeEventListener('scroll', closeContextMenu, true);
    };
  }, [cellContextMenu]);

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
  const shouldShowRowDetailsPanel = Boolean(
    importedSheet && (selectedDetailsRow || isRegistrationMode),
  );

  useEffect(() => {
    if (!shouldShowRowDetailsPanel || !importedSheet) {
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
    shouldShowRowDetailsPanel,
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
    utils: XlsxModule['utils'],
    previousWorksheet: XlsxWorksheet | undefined,
    nextWorksheet: XlsxWorksheet,
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
      const { read, utils, write } = await loadXlsx();
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
      preserveAgeFormulas(utils, previousWorksheet, nextWorksheet, sheet);
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
      if (initialValue !== value) {
        pushCellUndoEntry({
          rowIndex,
          columnName,
          previousValue: initialValue,
          nextValue: value,
        });
        return currentSheet;
      }

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
    setSelectedDetailsRow(null);
    applyRowDetailsPanelStyle({});
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

    const detailsInput = rowDetailsInputRefs.current[`register-${columnName}`];

    if (detailsInput && detailsInput.value !== value) {
      detailsInput.value = value;
    }

    const nextHasValue = hasAnyRegistrationDraftValue(
      registrationDraftRef.current,
    );

    setHasRegistrationDraftValue((currentHasValue) =>
      currentHasValue === nextHasValue ? currentHasValue : nextHasValue,
    );
    setRegistrationDraftVersion((currentVersion) => currentVersion + 1);
  };

  const getRegistrationDraftInput = (columnName: string) => {
    const detailsInput = rowDetailsInputRefs.current[`register-${columnName}`];

    if (detailsInput) {
      return detailsInput;
    }

    return null;
  };

  const getRegistrationDraftCurrentValue = (columnName: string) =>
    getRegistrationDraftInput(columnName)?.value ??
    registrationDraftRef.current[columnName] ??
    '';

  const pushRegistrationDraftUndoEntry = (
    entry: Omit<RegistrationDraftEditUndoEntry, 'kind'>,
  ) => {
    if (entry.previousValue === entry.nextValue) {
      return;
    }

    pushTableUndoEntry({
      kind: 'registration-draft-edit',
      ...entry,
    });
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
    cellUndoStackRef.current = cellUndoStackRef.current.filter(
      (entry) => entry.kind !== 'registration-draft-edit',
    );
    setHasRegistrationDraftValue(false);
    setRegistrationDraftVersion((currentVersion) => currentVersion + 1);
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
      focusFirstRegistrationDetailsField();
    });
    await writeSheetToSourceFile(nextSheet);
  };

  const commitActiveCellEditForUndo = () => {
    const activeEdit = activeCellEditRef.current;
    const currentSheet = latestSheetRef.current;

    if (!activeEdit || !currentSheet) {
      return;
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

    if (savedValue !== null) {
      commitCellValue(activeEdit.rowIndex, activeEdit.columnName, currentValue);
    }
  };

  const finalizeActiveEditsForUndo = () => {
    if (activeRegistrationEditRef.current) {
      finalizeActiveRegistrationDraftEdit();
    }

    commitActiveCellEditForUndo();
  };

  const undoRegistrationDraftEdit = (
    undoEntry: RegistrationDraftEditUndoEntry,
  ) => {
    const activeInput = getRegistrationDraftInput(undoEntry.columnName);

    if (activeInput) {
      activeInput.value = undoEntry.previousValue;
      activeInput.focus();
      activeInput.select();
    }

    setRegistrationDraftColumnValue(
      undoEntry.columnName,
      undoEntry.previousValue,
    );
    activeRegistrationEditRef.current = {
      columnName: undoEntry.columnName,
      initialValue: undoEntry.previousValue,
    };
  };

  const undoLastCellEdit = () => {
    finalizeActiveEditsForUndo();
    protectUndoCommit();
    activeCellEditRef.current = null;

    const currentSheet = latestSheetRef.current;
    const undoEntry = cellUndoStackRef.current.at(-1);

    if (!undoEntry) {
      return false;
    }

    if (undoEntry.kind === 'registration-draft-edit') {
      cellUndoStackRef.current = cellUndoStackRef.current.slice(0, -1);
      undoRegistrationDraftEdit(undoEntry);
      return true;
    }

    activeRegistrationEditRef.current = null;

    if (!currentSheet) {
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
        focusFirstRegistrationDetailsField();
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
      window.requestAnimationFrame(() => {
        scrollToRegisteredRow(
          nextSheet,
          undoEntry.rowIndex,
          sessionRegisteredRowIndexes,
        );
        const visualIndex = getVisualRowIndex(
          nextSheet,
          undoEntry.rowIndex,
          sessionRegisteredRowIndexes,
        );

        setSelectedDetailsRow({
          rowIndex: undoEntry.rowIndex,
          visualIndex: Math.max(visualIndex, 0),
        });
      });
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

  const isUndoShortcut = ({
    ctrlKey,
    key,
    metaKey,
    shiftKey,
  }: Pick<KeyboardEvent<HTMLInputElement>, 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>) =>
    (ctrlKey || metaKey) && !shiftKey && key.toLowerCase() === 'z';

  const runUndoShortcut = (
    event:
      | globalThis.KeyboardEvent
      | KeyboardEvent<HTMLInputElement>
      | KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!isUndoShortcut(event)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    undoLastCellEditAndSave();
    return true;
  };

  const handleInputHistoryUndo = (event: FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;

    if (nativeEvent.inputType !== 'historyUndo') {
      return;
    }

    event.preventDefault();
    undoLastCellEditAndSave();
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

  const getFirstRegistrationDetailsColumn = () =>
    orderedColumns.find(
      (column) =>
        column !== AGE_COLUMN && column.trim().toLowerCase() === 'nome',
    ) ?? orderedColumns.find((column) => column !== AGE_COLUMN);

  const focusRegistrationDetailsField = (columnName: string) => {
    const input = rowDetailsInputRefs.current[`register-${columnName}`];

    input?.focus();
    input?.select();
  };

  const focusFirstRegistrationDetailsField = () => {
    const firstEditableColumn = getFirstRegistrationDetailsColumn();

    if (!firstEditableColumn) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() =>
        focusRegistrationDetailsField(firstEditableColumn),
      );
    });
  };

  const selectVisualRow = (visualIndex: number) => {
    const nextRow = displayedRows[visualIndex];

    if (!nextRow) {
      return;
    }

    setSelectedDetailsRow({
      rowIndex: nextRow.rowIndex,
      visualIndex,
    });
    setIsRegistrationMode(false);

    const tableBody = tableBodyScrollRef.current;

    if (!tableBody) {
      return;
    }

    const rowHeight = getCurrentTableRowHeight();
    const rowTop = visualIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;

    if (rowTop < tableBody.scrollTop) {
      tableBody.scrollTop = rowTop;
      return;
    }

    if (rowBottom > tableBody.scrollTop + tableBody.clientHeight) {
      tableBody.scrollTop = rowBottom - tableBody.clientHeight;
    }
  };

  const handleTableBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      isEditMode ||
      !['ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;

    if (
      target?.closest(
        'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]',
      )
    ) {
      return;
    }

    event.preventDefault();

    const currentVisualIndex =
      selectedDetailsRow?.visualIndex ??
      (event.key === 'ArrowDown' ? -1 : displayedRows.length);
    const nextVisualIndex =
      event.key === 'ArrowDown'
        ? Math.min(displayedRows.length - 1, currentVisualIndex + 1)
        : Math.max(0, currentVisualIndex - 1);

    selectVisualRow(nextVisualIndex);
  };

  useEffect(() => {
    if (!isRegistrationMode || !importedSheet) {
      return;
    }

    if (wasRegistrationModeRef.current) {
      return;
    }

    wasRegistrationModeRef.current = true;
    focusFirstRegistrationDetailsField();
  }, [isRegistrationMode, Boolean(importedSheet)]);

  const copyTextToClipboard = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Some local browser contexts expose Clipboard API but still deny writes.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.append(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  };

  const copyContextCellValue = async () => {
    if (!cellContextMenu) {
      return;
    }

    try {
      await copyTextToClipboard(cellContextMenu.value);
    } finally {
      setCellContextMenu(null);
    }
  };

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
  ]
    .filter(Boolean)
    .join(' ');
  const hasWorkingSheet = Boolean(importedSheet);
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);
  const toggleRegistrationMode = () => {
    const shouldSwapSelectedDetails = Boolean(selectedDetailsRow);

    setIsRegistrationMode((current) => {
      const nextMode = shouldSwapSelectedDetails ? true : !current;

      if (nextMode) {
        setIsEditMode(false);
        setSelectedDetailsRow(null);
        if (!shouldSwapSelectedDetails) {
          applyRowDetailsPanelStyle({});
        }
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
  const selectedDetailsSex =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, SEX_COLUMN)
      : '';
  const selectedDetailsBirthdate =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          BIRTHDATE_COLUMN,
        )
      : '';
  const selectedDetailsAge =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, AGE_COLUMN)
      : '';
  const selectedDetailsEmail =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, EMAIL_COLUMN)
      : '';
  const selectedDetailsContact =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          CONTACT_COLUMN,
        )
      : '';
  const selectedDetailsRg =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, RG_COLUMN)
      : '';
  const selectedDetailsCpf =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, CPF_COLUMN)
      : '';
  const selectedDetailsResponsible =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          RESPONSIBLE_COLUMN,
        )
      : '';
  const selectedDetailsResponsibleEmail =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          RESPONSIBLE_EMAIL_COLUMN,
        )
      : '';
  const selectedDetailsResponsibleContact =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          RESPONSIBLE_CONTACT_COLUMN,
        )
      : '';
  const selectedDetailsAddress =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          ADDRESS_COLUMN,
        )
      : '';
  const selectedDetailsCompany =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          COMPANY_COLUMN,
        )
      : '';
  const selectedDetailsInstitution =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          INSTITUTION_COLUMN,
        )
      : '';
  const selectedDetailsLearningArc =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          LEARNING_ARC_COLUMN,
        )
      : '';
  const selectedDetailsRole =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, ROLE_COLUMN)
      : '';
  const selectedDetailsAdmissionDate =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          ADMISSION_DATE_COLUMN,
        )
      : '';
  const selectedDetailsEndDate =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(
          importedSheet,
          selectedDetailsRowValues,
          END_DATE_COLUMN,
        )
      : '';
  const selectedDetailsClass =
    importedSheet && selectedDetailsRowValues
      ? getDisplayCellValue(importedSheet, selectedDetailsRowValues, CLASS_COLUMN)
      : '';
  const isRowDetailsPanelPositioned =
    rowDetailsPanelStyle.display !== 'none' &&
    rowDetailsPanelStyle.left !== undefined &&
    rowDetailsPanelStyle.top !== undefined &&
    rowDetailsPanelStyle.width !== undefined &&
    rowDetailsPanelStyle.height !== undefined;
  const isRegistrationDetailsMode = Boolean(
    isRegistrationMode && importedSheet,
  );
  const rowDetailsName = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(selectedDetailsNameColumn)
    : selectedDetailsName;
  const rowDetailsSex = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(SEX_COLUMN)
    : selectedDetailsSex;
  const rowDetailsBirthdate = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(BIRTHDATE_COLUMN)
    : selectedDetailsBirthdate;
  const rowDetailsAge = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(AGE_COLUMN)
    : selectedDetailsAge;
  const rowDetailsEmail = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(EMAIL_COLUMN)
    : selectedDetailsEmail;
  const rowDetailsContact = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(CONTACT_COLUMN)
    : selectedDetailsContact;
  const rowDetailsRg = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(RG_COLUMN)
    : selectedDetailsRg;
  const rowDetailsCpf = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(CPF_COLUMN)
    : selectedDetailsCpf;
  const rowDetailsResponsible = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(RESPONSIBLE_COLUMN)
    : selectedDetailsResponsible;
  const rowDetailsResponsibleEmail = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(RESPONSIBLE_EMAIL_COLUMN)
    : selectedDetailsResponsibleEmail;
  const rowDetailsResponsibleContact = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(RESPONSIBLE_CONTACT_COLUMN)
    : selectedDetailsResponsibleContact;
  const rowDetailsAddress = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(ADDRESS_COLUMN)
    : selectedDetailsAddress;
  const rowDetailsCompany = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(COMPANY_COLUMN)
    : selectedDetailsCompany;
  const rowDetailsInstitution = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(INSTITUTION_COLUMN)
    : selectedDetailsInstitution;
  const rowDetailsLearningArc = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(LEARNING_ARC_COLUMN)
    : selectedDetailsLearningArc;
  const rowDetailsRole = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(ROLE_COLUMN)
    : selectedDetailsRole;
  const rowDetailsAdmissionDate = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(ADMISSION_DATE_COLUMN)
    : selectedDetailsAdmissionDate;
  const rowDetailsEndDate = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(END_DATE_COLUMN)
    : selectedDetailsEndDate;
  const rowDetailsClass = isRegistrationDetailsMode
    ? getRegistrationDraftDisplayValue(CLASS_COLUMN)
    : selectedDetailsClass;
  const renderRowDetailsField = ({
    className = '',
    columnName,
    label,
    readOnly = false,
    value,
  }: {
    className?: string;
    columnName: string;
    label: string;
    readOnly?: boolean;
    value: string;
  }) => {
    if (!selectedDetailsRow && !isRegistrationDetailsMode) {
      return null;
    }

    const fieldClassName = ['row-details-field', className]
      .filter(Boolean)
      .join(' ');
    const inputKey = isRegistrationDetailsMode
      ? `register-details-${registrationDraftResetKey}-${columnName}`
      : `${selectedDetailsRow?.rowIndex}-${columnName}`;

    return (
      <div className={fieldClassName}>
        <span className="row-details-field-label">{label}</span>
        <span
          className={[
            'row-details-field-value',
            readOnly ? 'row-details-field-value-readonly' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {readOnly ? (
            value
          ) : isRegistrationDetailsMode ? (
            <input
              key={inputKey}
              ref={(element) => {
                rowDetailsInputRefs.current[`register-${columnName}`] = element;
              }}
              className="row-details-field-value-input"
              aria-label={`${label} cadastrar aprendiz`}
              data-registration-input="true"
              spellCheck={false}
              value={value}
              onFocus={(event) => {
                beginRegistrationDraftEdit(columnName, event.currentTarget.value);
              }}
              onChange={(event) =>
                updateRegistrationDraft(columnName, event.target.value)
              }
              onBeforeInput={handleInputHistoryUndo}
              onKeyDown={(event) => {
                if (runUndoShortcut(event)) {
                  return;
                }

                if (event.key !== 'Enter') {
                  return;
                }

                event.preventDefault();
                finalizeActiveRegistrationDraftEdit();
                void commitRegistrationDraft();
              }}
              onBlur={() => {
                window.requestAnimationFrame(() => {
                  const activeElement = document.activeElement;
                  const isStillInRegistrationInput =
                    activeElement instanceof HTMLElement &&
                    activeElement.dataset.registrationInput === 'true';

                  if (!isStillInRegistrationInput) {
                    finalizeActiveRegistrationDraftEdit();
                  }
                });
              }}
            />
          ) : (
            <input
              key={inputKey}
              ref={(element) => {
                if (selectedDetailsRow) {
                  rowDetailsInputRefs.current[
                    `${selectedDetailsRow.rowIndex}-${columnName}`
                  ] = element;
                }
              }}
              className="row-details-field-value-input"
              aria-label={`${label} do aprendiz`}
              spellCheck={false}
              value={value}
              onFocus={() =>
                selectedDetailsRow &&
                beginCellEdit(selectedDetailsRow.rowIndex, columnName, value)
              }
              onChange={(event) => {
                if (!selectedDetailsRow) {
                  return;
                }

                beginCellEdit(selectedDetailsRow.rowIndex, columnName, value);
                updateCell(
                  selectedDetailsRow.rowIndex,
                  columnName,
                  event.currentTarget.value,
                );
              }}
              onBeforeInput={handleInputHistoryUndo}
              onKeyDown={(event) => {
                if (runUndoShortcut(event)) {
                  return;
                }

                if (event.key !== 'Enter' || !selectedDetailsRow) {
                  return;
                }

                event.preventDefault();
                const sheet = commitCellValue(
                  selectedDetailsRow.rowIndex,
                  columnName,
                  event.currentTarget.value,
                );

                if (sheet) {
                  void writeSheetToSourceFile(sheet);
                }
              }}
              onBlur={(event) => {
                if (isApplyingUndoRef.current || !selectedDetailsRow) {
                  return;
                }

                const sheet = commitCellValue(
                  selectedDetailsRow.rowIndex,
                  columnName,
                  event.currentTarget.value,
                );

                if (sheet) {
                  void writeSheetToSourceFile(sheet);
                }
              }}
            />
          )}
        </span>
      </div>
    );
  };
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
              <SquarePlusIcon />
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
            </div>
            <div
              className="data-table-body-scroll"
              ref={tableBodyScrollRef}
              role="region"
              tabIndex={0}
              onKeyDown={handleTableBodyKeyDown}
              onScroll={() => {
                syncHeaderScroll();
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
                        selectedDetailsRow?.rowIndex === rowIndex
                          ? 'row-details-selected'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                    onClick={() => {
                      if (!isEditMode) {
                        setIsRegistrationMode(false);
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
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setCellContextMenu({
                              left: Math.max(
                                8,
                                Math.min(event.clientX, window.innerWidth - 156),
                              ),
                              top: Math.max(
                                8,
                                Math.min(event.clientY, window.innerHeight - 44),
                              ),
                              value: displayValue,
                            });
                          }}
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
                              onBeforeInput={handleInputHistoryUndo}
                              onKeyDown={(event) => {
                                if (runUndoShortcut(event)) {
                                  return;
                                }

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
            {shouldShowRowDetailsPanel && !isEditMode && (
              <aside
                className="row-details-panel"
                style={{
                  visibility: isRowDetailsPanelPositioned
                    ? 'visible'
                    : 'hidden',
                  ...rowDetailsPanelStyle,
                }}
                aria-label={
                  isRegistrationDetailsMode
                    ? 'Cadastrar aprendiz'
                    : 'Detalhes do aprendiz'
                }
              >
                <div className="row-details-content">
                    <section
                      className="row-details-info-section"
                      aria-label="Informações do aprendiz"
                    >
                      <div className="row-details-field-layer row-details-primary-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-name',
                          columnName: selectedDetailsNameColumn,
                          label: 'Nome',
                          value: rowDetailsName,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-sex',
                          columnName: SEX_COLUMN,
                          label: 'Sexo',
                          value: rowDetailsSex,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-birthdate',
                          columnName: BIRTHDATE_COLUMN,
                          label: 'Data Nascimento',
                          value: rowDetailsBirthdate,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-age',
                          columnName: AGE_COLUMN,
                          label: 'Idade',
                          readOnly: true,
                          value: rowDetailsAge,
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-secondary-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-email',
                          columnName: EMAIL_COLUMN,
                          label: 'E-mail',
                          value: rowDetailsEmail,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-contact',
                          columnName: CONTACT_COLUMN,
                          label: 'Contato',
                          value: rowDetailsContact,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-cpf',
                          columnName: CPF_COLUMN,
                          label: 'CPF',
                          value: rowDetailsCpf,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-rg',
                          columnName: RG_COLUMN,
                          label: 'RG',
                          value: rowDetailsRg,
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-tertiary-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-responsible-name',
                          columnName: RESPONSIBLE_COLUMN,
                          label: 'Nome Responsável',
                          value: rowDetailsResponsible,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-responsible-email',
                          columnName: RESPONSIBLE_EMAIL_COLUMN,
                          label: 'Email Responsável',
                          value: rowDetailsResponsibleEmail,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-responsible-contact',
                          columnName: RESPONSIBLE_CONTACT_COLUMN,
                          label: 'Contato Responsável',
                          value: rowDetailsResponsibleContact,
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-address-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-address',
                          columnName: ADDRESS_COLUMN,
                          label: 'Endereço',
                          value: rowDetailsAddress,
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-company-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-company',
                          columnName: COMPANY_COLUMN,
                          label: 'Empresa',
                          value: rowDetailsCompany,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-institution',
                          columnName: INSTITUTION_COLUMN,
                          label: 'Instituição Ensino',
                          value: rowDetailsInstitution,
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-learning-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-learning-arc',
                          columnName: LEARNING_ARC_COLUMN,
                          label: 'Arco Aprendizagem',
                          value: rowDetailsLearningArc,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-role',
                          columnName: ROLE_COLUMN,
                          label: 'Função',
                          value: rowDetailsRole,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-admission-date',
                          columnName: ADMISSION_DATE_COLUMN,
                          label: 'Data Admissão',
                          value: rowDetailsAdmissionDate,
                        })}
                        {renderRowDetailsField({
                          className: 'row-details-field-end-date',
                          columnName: END_DATE_COLUMN,
                          label: 'Data Término',
                          value: rowDetailsEndDate,
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-class-layer">
                        {renderRowDetailsField({
                          className: 'row-details-field-class',
                          columnName: CLASS_COLUMN,
                          label: 'Turma',
                          value: rowDetailsClass,
                        })}
                      </div>
                    </section>
                    <footer
                      className="row-details-actions"
                      aria-label="Ações do aprendiz"
                    >
                      {isRegistrationDetailsMode ? (
                        <button
                          className="row-details-action-button row-details-delete-button"
                          type="button"
                          aria-label="Cadastrar aluno"
                          title="Cadastrar Aluno"
                          disabled={!hasRegistrationDraftValue}
                          onClick={() => {
                            finalizeActiveRegistrationDraftEdit();
                            void commitRegistrationDraft();
                          }}
                        >
                          <UserPlusIcon />
                        </button>
                      ) : selectedDetailsRow ? (
                        <button
                          className="row-details-action-button row-details-delete-button"
                          type="button"
                          aria-label="Descadastrar aprendiz"
                          title="Descadastrar"
                          onClick={() => deleteRowAndSave(selectedDetailsRow.rowIndex)}
                        >
                          <UserXIcon />
                        </button>
                      ) : null}
                    </footer>
                </div>
                <button
                  className="row-details-close-button"
                  type="button"
                  aria-label="Fechar detalhes"
                  onClick={() => {
                    if (isRegistrationDetailsMode) {
                      setIsRegistrationMode(false);
                    } else {
                      setSelectedDetailsRow(null);
                    }
                    applyRowDetailsPanelStyle({});
                  }}
                >
                  <CloseIcon />
                </button>
              </aside>
            )}
            {cellContextMenu && (
              <div
                className="cell-context-menu"
                style={{
                  left: cellContextMenu.left,
                  top: cellContextMenu.top,
                }}
                role="menu"
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void copyContextCellValue()}
                >
                  Copiar valor
                </button>
              </div>
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
      {invalidImportToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {invalidImportToast}
        </div>
      )}
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

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h4" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
