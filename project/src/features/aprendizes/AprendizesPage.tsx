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
import { ThemeToggleButton } from '../../shared/ui/ThemeToggleButton';

const APRENDIZES_VIEW_STORAGE_KEY = 'sejaelevar.aprendizes.view.v1';
const LEGACY_APRENDIZES_STORAGE_KEY = 'sejaelevar.aprendizes.sheet.v1';
const DEFAULT_COLUMN_WIDTH = 96;
const MIN_COLUMN_WIDTH = 34;
const TABLE_HORIZONTAL_PADDING = 10;
const TABLE_WIDTH_BUFFER = 6;
const CELL_UNDO_LIMIT = 1000;
const TABLE_FONT = '12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TABLE_HEADER_FONT =
  '800 12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';

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
};

type CellUndoEntry = {
  rowIndex: number;
  columnName: string;
  previousValue: string;
  nextValue: string;
};

type ActiveCellEdit = {
  rowIndex: number;
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

const defaultViewSettings: TableViewSettings = {
  columnOrder: [],
  columnWidths: {},
};

const normalizeCell = (value: unknown) => String(value ?? '').trim();

let textMeasureContext: CanvasRenderingContext2D | null = null;

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
  const cellUndoStackRef = useRef<CellUndoEntry[]>([]);
  const activeCellEditRef = useRef<ActiveCellEdit | null>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement>(null);
  const tableBodyScrollRef = useRef<HTMLDivElement>(null);
  const [importedSheet, setImportedSheet] = useState<ImportedSheet | null>(null);
  const latestSheetRef = useRef<ImportedSheet | null>(importedSheet);
  const isLocalProviderActiveRef = useRef(false);
  const [viewSettings, setViewSettings] = useState<TableViewSettings>(
    readSavedViewSettings,
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState('');
  const [importError, setImportError] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [hasCheckedWorkspace, setHasCheckedWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [isRecoveringBackup, setIsRecoveringBackup] = useState(false);
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
    activeCellEditRef.current = null;
    latestSheetRef.current = null;
    setImportedSheet(null);
    setRecoveryInfo(null);
  };

  const saveImportedSheet = (
    sheet: ImportedSheet,
    options: { resetColumnWidths?: boolean } = {},
  ) => {
    cellUndoStackRef.current = [];
    activeCellEditRef.current = null;
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

    saveViewSettings({
      ...viewSettings,
      columnOrder: nextColumnOrder,
      columnWidths: nextColumnWidths,
    });
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

    await selectFile(file, options);
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

      await fetchProviderFile({
        resetColumnWidths: true,
      });
      setWorkspaceStatus(`Planilha copiada para dados/${storedFileName}.`);
      setImportError('');
    } catch (error) {
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
      return;
    }


    const isXlsx =
      file.name.toLowerCase().endsWith('.xlsx') ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!isXlsx) {
      setImportError('Selecione um arquivo .xlsx.');
      return;
    }

    try {
      const workbook = read(await file.arrayBuffer(), {
        cellDates: true,
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      if (!sheetName || !worksheet) {
        setImportError('A planilha não possui abas para importar.');
        return;
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
        setImportError('A planilha está vazia.');
        return;
      }

      const headerRow = sheetRows[headerIndex];
      let lastColumnIndex = -1;
      headerRow.forEach((cell, index) => {
        if (normalizeCell(cell) !== '') {
          lastColumnIndex = index;
        }
      });

      if (lastColumnIndex < 0) {
        setImportError('A planilha não possui colunas identificáveis.');
        return;
      }

      const columns = headerRow
        .slice(0, lastColumnIndex + 1)
        .map((cell, index) => normalizeCell(cell) || `Coluna ${index + 1}`);
      const rows = sheetRows
        .slice(headerIndex + 1)
        .map((row) =>
          columns.map((_, columnIndex) => normalizeCell(row[columnIndex])),
        )
        .filter((row) => row.some((cell) => cell !== ''));

      const nextSheet = {
        fileName: file.name,
        sheetName,
        importedAt: new Date().toISOString(),
        columns,
        rows,
      };

      saveImportedSheet(nextSheet, {
        resetColumnWidths: options.resetColumnWidths,
      });

      setWorkspaceStatus('Planilha carregada.');
      setImportError('');
    } catch {
      clearWorkingSheet();
      setImportError('Não foi possível ler este arquivo .xlsx.');
    }
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
      const cellWidth = measureTextWidth(row[columnIndex] || '', TABLE_FONT);
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
      workbook.Sheets[safeSheetName] = utils.aoa_to_sheet([
        sheet.columns,
        ...sheet.rows,
      ]);

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

      storeImportedSheet({
        ...sheet,
        fileName: savedFileName,
      });
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

  const pushCellUndoEntry = (entry: CellUndoEntry) => {
    if (entry.previousValue === entry.nextValue) {
      return;
    }

    cellUndoStackRef.current = [
      ...cellUndoStackRef.current,
      entry,
    ].slice(-CELL_UNDO_LIMIT);
  };

  const commitActiveCellEdit = () => {
    const activeEdit = activeCellEditRef.current;
    const currentSheet = latestSheetRef.current;

    activeCellEditRef.current = null;

    if (!activeEdit || !currentSheet) {
      return false;
    }

    const currentValue = getCellValue(
      currentSheet,
      activeEdit.rowIndex,
      activeEdit.columnName,
    );

    if (currentValue === null || currentValue === activeEdit.initialValue) {
      return false;
    }

    pushCellUndoEntry({
      rowIndex: activeEdit.rowIndex,
      columnName: activeEdit.columnName,
      previousValue: activeEdit.initialValue,
      nextValue: currentValue,
    });

    return true;
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

    commitActiveCellEdit();
    activeCellEditRef.current = {
      rowIndex,
      columnName,
      initialValue,
    };
  };

  const updateCell = (rowIndex: number, columnName: string, value: string) => {
    const currentSheet = latestSheetRef.current;

    if (!currentSheet) {
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

  const undoLastCellEdit = () => {
    commitActiveCellEdit();

    const currentSheet = latestSheetRef.current;
    const undoEntry = cellUndoStackRef.current.at(-1);

    if (!currentSheet || !undoEntry) {
      return false;
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

    storeImportedSheet({
      ...currentSheet,
      rows: nextRows,
    });

    return true;
  };

  const focusCell = (rowIndex: number, columnIndex: number) => {
    const key = `${rowIndex}-${columnIndex}`;
    const input = cellInputRefs.current[key];

    input?.focus();
    input?.select();
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

  const tableClassName = isEditMode ? 'data-table editing' : 'data-table';
  const hasWorkingSheet = Boolean(importedSheet);
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);
  const recoveryButtonLabel =
    recoveryInfo?.formattedUpdatedAt
      ? `Recuperar ${recoveryInfo.label || 'Aprendizes'} - ${
          recoveryInfo.formattedUpdatedAt
        }`
      : `Recuperar ${recoveryInfo?.label || 'Aprendizes'}`;
  const recoveryDescription = getRecoveryDescription(recoveryInfo);
  const renderColumnGroup = () => (
    <colgroup>
      {orderedColumns.map((column) => (
        <col key={column} style={getColumnWidthStyle(column)} />
      ))}
    </colgroup>
  );

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
            <button
              className={hasWorkingSheet ? 'square-action' : 'square-action disabled'}
              type="button"
              aria-label="Cadastrar aprendiz"
              title="Cadastrar Aprendiz"
              disabled={!hasWorkingSheet}
            >
              <UserPlusIcon />
            </button>
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
              onClick={() => setIsEditMode((current) => !current)}
            >
              <PencilIcon />
            </button>
            <button
              className={
                hasWorkingSheet && canRecoverBackup
                  ? 'square-action'
                  : 'square-action disabled'
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
            <ThemeToggleButton />
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
          <div className="data-table-frame">
            <div
              className="data-table-header-scroll"
              ref={tableHeaderScrollRef}
              aria-hidden="true"
            >
              <table className={`${tableClassName} data-table-header`}>
                {renderColumnGroup()}
              <thead>
                <tr>
                  {orderedColumns.map((column) => (
                    <th
                      key={column}
                      style={getColumnWidthStyle(column)}
                      draggable={isEditMode}
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
                </tr>
              </thead>
              </table>
            </div>
            <div
              className="data-table-body-scroll"
              ref={tableBodyScrollRef}
              role="region"
              tabIndex={0}
              onScroll={syncHeaderScroll}
            >
              <table className={`${tableClassName} data-table-body`}>
                {renderColumnGroup()}
              <tbody>
                {importedSheet.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {orderedColumns.map((column, orderedColumnIndex) => {
                      const columnIndex = importedSheet.columns.indexOf(column);
                      const value = row[columnIndex] || '';

                      return (
                        <td
                          key={`${column}-${columnIndex}`}
                          style={getColumnWidthStyle(column)}
                        >
                          {isEditMode ? (
                            <input
                              ref={(element) => {
                                cellInputRefs.current[
                                  `${rowIndex}-${orderedColumnIndex}`
                                ] = element;
                              }}
                              aria-label={`${column} linha ${rowIndex + 1}`}
                              size={Math.max(value.length, 1)}
                              style={
                                {
                                  '--edit-input-width': `${Math.max(
                                    value.length + 2,
                                    1,
                                  )}ch`,
                                } as CSSProperties
                              }
                              value={value}
                              onFocus={() =>
                                beginCellEdit(rowIndex, column, value)
                              }
                              onChange={(event) =>
                                updateCell(rowIndex, column, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (
                                  (event.ctrlKey || event.metaKey) &&
                                  !event.shiftKey &&
                                  event.key.toLowerCase() === 'z'
                                ) {
                                  event.preventDefault();
                                  undoLastCellEdit();
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
                                const hasCommittedChange = commitActiveCellEdit();
                                const sheet = latestSheetRef.current;

                                if (hasCommittedChange && sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                              onBlur={() => {
                                const hasCommittedChange = commitActiveCellEdit();
                                const sheet = latestSheetRef.current;

                                if (hasCommittedChange && sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                            />
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h4" />
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
