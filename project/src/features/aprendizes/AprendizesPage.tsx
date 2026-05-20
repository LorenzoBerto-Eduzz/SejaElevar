import { useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { read, utils, write } from 'xlsx';

const APRENDIZES_STORAGE_KEY = 'sejaelevar.aprendizes.sheet.v1';
const APRENDIZES_VIEW_STORAGE_KEY = 'sejaelevar.aprendizes.view.v1';
const DEFAULT_COLUMN_WIDTH = 96;
const MIN_COLUMN_WIDTH = 90;
const MAX_AUTO_COLUMN_WIDTH = 520;
const TABLE_HORIZONTAL_PADDING = 10;
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

const defaultViewSettings: TableViewSettings = {
  columnOrder: [],
  columnWidths: {},
};

type SpreadsheetFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
  getFile: () => Promise<File>;
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (
    descriptor: { mode: 'readwrite' },
  ) => Promise<PermissionState>;
};

type WindowWithFilePicker = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SpreadsheetFileHandle[]>;
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

const readSavedSheet = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const savedSheet = window.localStorage.getItem(APRENDIZES_STORAGE_KEY);
    return savedSheet ? (JSON.parse(savedSheet) as ImportedSheet) : null;
  } catch {
    window.localStorage.removeItem(APRENDIZES_STORAGE_KEY);
    return null;
  }
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
  const sourceFileHandleRef = useRef<SpreadsheetFileHandle | null>(null);
  const [importedSheet, setImportedSheet] = useState<ImportedSheet | null>(
    readSavedSheet,
  );
  const latestSheetRef = useRef<ImportedSheet | null>(importedSheet);
  const [viewSettings, setViewSettings] = useState<TableViewSettings>(
    readSavedViewSettings,
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState('');
  const [importError, setImportError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

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
    window.localStorage.setItem(APRENDIZES_STORAGE_KEY, JSON.stringify(sheet));
  };

  const saveImportedSheet = (sheet: ImportedSheet) => {
    storeImportedSheet(sheet);

    const knownColumns = new Set(sheet.columns);
    const nextColumnOrder = [
      ...viewSettings.columnOrder.filter((column) => knownColumns.has(column)),
      ...sheet.columns.filter(
        (column) => !viewSettings.columnOrder.includes(column),
      ),
    ];
    const nextColumnWidths = Object.fromEntries(
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

  const requestWritePermission = async (handle: SpreadsheetFileHandle) => {
    if (!handle.queryPermission || !handle.requestPermission) {
      return true;
    }

    const currentPermission = await handle.queryPermission({
      mode: 'readwrite',
    });

    if (currentPermission === 'granted') {
      return true;
    }

    const nextPermission = await handle.requestPermission({
      mode: 'readwrite',
    });

    return nextPermission === 'granted';
  };

  const importFromPicker = async () => {
    const picker = (window as WindowWithFilePicker).showOpenFilePicker;

    if (!picker) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const [handle] = await picker({
        multiple: false,
        types: [
          {
            description: 'Planilha Excel',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                ['.xlsx'],
            },
          },
        ],
      });

      if (!handle) {
        return;
      }

      const file = await handle.getFile();
      const canWrite = await requestWritePermission(handle);
      await selectFile(file, canWrite ? handle : undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setImportError('Não foi possível abrir este arquivo .xlsx.');
    }
  };

  const selectFile = async (
    file: File | undefined,
    sourceFileHandle?: SpreadsheetFileHandle,
  ) => {
    if (!file) {
      return;
    }

    sourceFileHandleRef.current = sourceFileHandle ?? null;

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

      saveImportedSheet({
        fileName: file.name,
        sheetName,
        importedAt: new Date().toISOString(),
        columns,
        rows,
      });
      setImportError('');
    } catch {
      setImportError('Não foi possível ler este arquivo .xlsx.');
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void selectFile(event.dataTransfer.files[0]);
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

    const headerWidth = measureTextWidth(column, TABLE_HEADER_FONT);
    const longestCellWidth = importedSheet.rows.reduce((longestWidth, row) => {
      const cellWidth = measureTextWidth(row[columnIndex] || '', TABLE_FONT);
      return Math.max(longestWidth, cellWidth);
    }, 0);
    const textWidth = Math.ceil(Math.max(headerWidth, longestCellWidth));

    return Math.min(
      MAX_AUTO_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, textWidth + TABLE_HORIZONTAL_PADDING * 2),
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
    const sourceFileHandle = sourceFileHandleRef.current;

    if (!sourceFileHandle) {
      return;
    }

    try {
      const workbook = utils.book_new();
      const worksheet = utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);
      utils.book_append_sheet(workbook, worksheet, sheet.sheetName || 'Dados');
      const output = write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      }) as ArrayBuffer;
      const writable = await sourceFileHandle.createWritable();
      await writable.write(
        new Blob([output], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      await writable.close();
    } catch {
      sourceFileHandleRef.current = null;
      setImportError(
        'A alteração ficou salva no app, mas o navegador não liberou gravar no .xlsx.',
      );
    }
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

  return (
    <section className="feature-page" aria-labelledby="aprendizes-title">
      <div className="feature-heading">
        <div>
          <h1 id="aprendizes-title">Aprendizes</h1>
        </div>
        {importedSheet && (
          <div className="table-toolbar" aria-label="Ações da tabela">
            <button
              className={isEditMode ? 'square-action active' : 'square-action'}
              type="button"
              aria-label="Editar visualização da tabela"
              aria-pressed={isEditMode}
              title="Editar tabela"
              onClick={() => setIsEditMode((current) => !current)}
            >
              <PencilIcon />
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
          </div>
        )}
      </div>

      {!importedSheet && (
        <div
          className={
            isDragging ? 'empty-data-state dragging' : 'empty-data-state'
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
          <div className="empty-data-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 4h14v16H5V4Z" />
              <path d="M8 8h8" />
              <path d="M8 12h8" />
              <path d="M8 16h5" />
            </svg>
          </div>
          <h2>Nenhuma planilha importada</h2>
          {importError && <p className="import-error">{importError}</p>}
          <button
            className="primary-action"
            type="button"
            onClick={() => void importFromPicker()}
          >
            Importar .xlsx
          </button>
        </div>
      )}

      {importedSheet && (
        <div className="data-table-panel">
          {importError && <p className="import-error">{importError}</p>}

          <div className="data-table-scroll" role="region" tabIndex={0}>
            <table
              className={isEditMode ? 'data-table editing' : 'data-table'}
            >
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
              <tbody>
                {importedSheet.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {orderedColumns.map((column) => {
                      const columnIndex = importedSheet.columns.indexOf(column);

                      return (
                        <td
                          key={`${column}-${columnIndex}`}
                          style={getColumnWidthStyle(column)}
                        >
                          {isEditMode ? (
                            <input
                              aria-label={`${column} linha ${rowIndex + 1}`}
                              value={row[columnIndex] || ''}
                              onChange={(event) =>
                                updateCell(rowIndex, column, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter') {
                                  return;
                                }

                                event.preventDefault();
                                const sheet = latestSheetRef.current;

                                if (sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                              onBlur={() => {
                                const sheet = latestSheetRef.current;

                                if (sheet) {
                                  void writeSheetToSourceFile(sheet);
                                }
                              }}
                            />
                          ) : (
                            row[columnIndex] || ''
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
      )}

      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => {
          void selectFile(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
    </section>
  );
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
