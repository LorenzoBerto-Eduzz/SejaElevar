import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  TURMAS_ENTITY_ID,
  buildEmptyDataIndexEntity,
  buildTurmasDataIndexEntity,
  type SheetTable,
} from '../../shared/data/dataIndex';
import {
  TURMAS_REQUIRED_COLUMNS,
  normalizeColumnsForSchema,
} from '../../shared/data/schemas';
import { ThemeToggleButton } from '../../shared/ui/ThemeToggleButton';

type XlsxModule = typeof import('xlsx');

let xlsxModulePromise: Promise<XlsxModule> | null = null;

const loadXlsx = () => {
  xlsxModulePromise ??= import('xlsx');
  return xlsxModulePromise;
};

class MissingRequiredColumnsError extends Error {
  missingColumns: string[];

  constructor(missingColumns: string[]) {
    super('missing-required-columns');
    this.missingColumns = missingColumns;
  }
}

const normalizeCell = (value: unknown) => String(value ?? '').trim();
const STUDENTS_COUNT_COLUMN = 'No. de Aprendizes';
const STUDENTS_LIST_COLUMN = 'Aprendizes';

const countListedStudents = (studentsValue: string) => {
  const normalizedValue = studentsValue.trim();

  if (!normalizedValue) {
    return '0';
  }

  return String(
    normalizedValue
      .split(',')
      .map((studentName) => studentName.trim())
      .filter(Boolean).length,
  );
};

const getTurmaDisplayCellValue = (
  sheet: SheetTable,
  row: string[],
  column: string,
) => {
  if (column !== STUDENTS_COUNT_COLUMN) {
    return row[sheet.columns.indexOf(column)] || '';
  }

  const studentsColumnIndex = sheet.columns.indexOf(STUDENTS_LIST_COLUMN);

  if (studentsColumnIndex < 0) {
    return row[sheet.columns.indexOf(column)] || '';
  }

  return countListedStudents(row[studentsColumnIndex] || '');
};

const withDerivedTurmasValues = (sheet: SheetTable): SheetTable => ({
  ...sheet,
  rows: sheet.rows.map((row) =>
    sheet.columns.map((column, columnIndex) =>
      column === STUDENTS_COUNT_COLUMN
        ? getTurmaDisplayCellValue(sheet, row, column)
        : row[columnIndex] || '',
    ),
  ),
});

const invalidImportedFileMessage =
  'Arquivo importado não possui os valores necessários';

const readSheetFile = async (file: File): Promise<SheetTable> => {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('invalid-file-type');
  }

  const { read, utils } = await loadXlsx();
  const workbook = read(await file.arrayBuffer(), {
    cellDates: false,
    type: 'array',
  });
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : null;

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
  const { missingColumns, normalizedColumns } = normalizeColumnsForSchema(
    rawColumns,
    TURMAS_REQUIRED_COLUMNS,
  );

  if (missingColumns.length > 0) {
    throw new MissingRequiredColumnsError(missingColumns);
  }

  const rows = sheetRows
    .slice(headerIndex + 1)
    .map((row) =>
      normalizedColumns.map((_, columnIndex) => normalizeCell(row[columnIndex])),
    )
    .filter((row) => row.some((cell) => cell !== ''));

  return {
    fileName: file.name,
    sheetName,
    importedAt: new Date().toISOString(),
    columns: normalizedColumns,
    rows,
  };
};

const persistTurmasDataIndex = async (sheet: SheetTable | null) => {
  const entityIndex = sheet
    ? buildTurmasDataIndexEntity(withDerivedTurmasValues(sheet))
    : buildEmptyDataIndexEntity(TURMAS_ENTITY_ID, 'Turmas');

  try {
    await fetch(`/api/data-index/entities/${TURMAS_ENTITY_ID}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(entityIndex),
    });
  } catch {
    // The xlsx remains the source of truth; the index can be rebuilt.
  }
};

export function TurmasPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement>(null);
  const tableBodyScrollRef = useRef<HTMLDivElement>(null);
  const invalidImportToastTimerRef = useRef<number | null>(null);
  const [importedSheet, setImportedSheet] = useState<SheetTable | null>(null);
  const [hasCheckedWorkspace, setHasCheckedWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState('');
  const [invalidImportToast, setInvalidImportToast] = useState('');

  const clearWorkingSheet = () => {
    setImportedSheet(null);
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

  const loadProviderFile = async () => {
    try {
      const response = await fetch('/api/turmas/file', {
        cache: 'no-store',
      });

      if (response.status === 404) {
        clearWorkingSheet();
        await persistTurmasDataIndex(null);
        return;
      }

      if (!response.ok) {
        throw new Error('read-failed');
      }

      const rawFileName = response.headers.get('x-file-name') || 'turmas.xlsx';
      const fileName = decodeURIComponent(rawFileName);
      const blob = await response.blob();
      const file = new File([blob], fileName, {
        type:
          blob.type ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const parsedSheet = await readSheetFile(file);
      const nextSheet = {
        ...parsedSheet,
        fileName,
      };

      setImportedSheet(nextSheet);
      setImportError('');
      await persistTurmasDataIndex(nextSheet);
    } catch (error) {
      clearWorkingSheet();

      if (error instanceof MissingRequiredColumnsError) {
        showInvalidImportToast();
        setImportError('');
        return;
      }

      setImportError('Não foi possível ler a planilha de turmas.');
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadSavedWorkbook = async () => {
      await loadProviderFile();

      if (isMounted) {
        setHasCheckedWorkspace(true);
      }
    };

    void loadSavedWorkbook();

    return () => {
      isMounted = false;
    };
  }, []);

  const importWorkingFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const parsedSheet = await readSheetFile(file);
      const response = await fetch('/api/turmas/import', {
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
      const nextSheet = {
        ...parsedSheet,
        fileName: storedFileName,
      };

      setImportedSheet(nextSheet);
      setImportError('');
      await persistTurmasDataIndex(nextSheet);
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

      setImportError('Não foi possível copiar a planilha para dados.');
    }
  };

  const importFromPicker = () => {
    fileInputRef.current?.click();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void importWorkingFile(event.dataTransfer.files?.[0]);
  };

  const hasWorkingSheet = Boolean(importedSheet);
  const syncHeaderScroll = () => {
    if (!tableHeaderScrollRef.current || !tableBodyScrollRef.current) {
      return;
    }

    tableHeaderScrollRef.current.scrollLeft = tableBodyScrollRef.current.scrollLeft;
  };
  const renderColumnGroup = () => (
    <colgroup>
      {importedSheet?.columns.map((column, columnIndex) => (
        <col key={`${column}-${columnIndex}`} />
      ))}
    </colgroup>
  );
  const renderHeaderColumnGroup = () => (
    <colgroup>
      {importedSheet?.columns.map((column, columnIndex) => (
        <col key={`${column}-${columnIndex}`} />
      ))}
      <col className="table-scrollbar-spacer-column" />
    </colgroup>
  );

  useEffect(() => {
    syncHeaderScroll();
  }, [importedSheet]);

  useEffect(
    () => () => {
      if (invalidImportToastTimerRef.current !== null) {
        window.clearTimeout(invalidImportToastTimerRef.current);
      }
    },
    [],
  );

  return (
    <section className="feature-page" aria-labelledby="turmas-title">
      <div className="feature-heading">
        <div>
          <h1 id="turmas-title">Turmas</h1>
        </div>
        <div className="table-toolbar" aria-label="Ações da tabela">
          <div className="table-toolbar-track">
            <button
              className="square-action disabled"
              type="button"
              aria-label="Adicionar turma"
              title="Adicionar Turma"
              disabled
            >
              <SquarePlusIcon />
            </button>
            <button
              className="square-action toolbar-section-start disabled"
              type="button"
              aria-label="Recuperar dados"
              title="Recuperar Dados"
              disabled
            >
              <RotateClockwiseIcon />
            </button>
            <button
              className="square-action"
              type="button"
              aria-label="Substituir planilha .xlsx"
              title="Importar .xlsx"
              onClick={importFromPicker}
            >
              <ImportIcon />
            </button>
            <button
              className="square-action disabled"
              type="button"
              aria-label="Exportar dados"
              title="Exportar Dados"
              disabled
            >
              <ExportIcon />
            </button>
            <ThemeToggleButton className="toolbar-section-start" />
          </div>
        </div>
      </div>

      {hasCheckedWorkspace && !hasWorkingSheet && (
        <div
          className={
            isDragging
              ? 'empty-data-state empty-tool-state dragging'
              : 'empty-data-state empty-tool-state'
          }
          role="region"
          aria-label="Importar planilha de turmas"
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
            onClick={importFromPicker}
          >
            <ImportIcon />
            Importar .xlsx
          </button>
          {importError && <p className="import-error">{importError}</p>}
        </div>
      )}

      {hasWorkingSheet && importedSheet && (
        <div className="data-table-panel turmas-data-table-panel">
          <div className="data-table-frame">
            <div
              className="data-table-header-scroll"
              ref={tableHeaderScrollRef}
            >
              <table className="data-table data-table-header">
                {renderHeaderColumnGroup()}
                <thead>
                  <tr>
                    {importedSheet.columns.map((column, columnIndex) => (
                      <th key={`${column}-${columnIndex}`}>{column}</th>
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
              onScroll={syncHeaderScroll}
            >
              <table className="data-table data-table-body">
                {renderColumnGroup()}
                <tbody>
                  {importedSheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {importedSheet.columns.map((column, columnIndex) => (
                        <td key={`${rowIndex}-${column}-${columnIndex}`}>
                          {getTurmaDisplayCellValue(importedSheet, row, column)}
                        </td>
                      ))}
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
      {invalidImportToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {invalidImportToast}
        </div>
      )}
    </section>
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

function SquarePlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
    </svg>
  );
}
