import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type UIEvent,
  type WheelEvent,
} from 'react';
import {
  APRENDIZES_ENTITY_ID,
  TURMAS_ENTITY_ID,
  buildAprendizesDataIndexEntity,
  buildEmptyDataIndexEntity,
  buildTurmasDataIndexEntity,
  type DataIndexEntity,
  type SheetTable,
} from '../../shared/data/dataIndex';
import { APRENDIZES_DATA_CHANGED_EVENT } from '../../shared/data/events';
import {
  APRENDIZES_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
  normalizeColumnsForSchema,
  normalizeFieldLabel,
} from '../../shared/data/schemas';
import { ThemeToggleButton } from '../../shared/ui/ThemeToggleButton';
import {
  handleGlobalUndoShortcut,
  pushGlobalUndoEntry,
  registerGlobalUndoController,
} from '../../shared/undo/globalUndo';

type XlsxModule = typeof import('xlsx');
type XlsxWorksheet = ReturnType<XlsxModule['utils']['aoa_to_sheet']>;

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
const APRENDIZES_VIEW_STORAGE_KEY = 'sejaelevar.aprendizes.view.v1';
const DEFAULT_COLUMN_WIDTH = 96;
const MIN_COLUMN_WIDTH = 34;
const TABLE_HORIZONTAL_PADDING = 10;
const TABLE_WIDTH_BUFFER = 6;
const TABLE_FONT = '12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TABLE_HEADER_FONT =
  '800 12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const STUDENTS_COUNT_COLUMN = 'No. de Aprendizes';
const STUDENTS_LIST_COLUMN = 'Aprendizes';
const TURMA_COLUMN = 'Turma';
const NAME_COLUMN = 'Nome';
const SEX_COLUMN = 'Sexo';
const BIRTHDATE_COLUMN = 'Data de Nascimento';
const EMAIL_COLUMN = 'E-mail';
const CONTACT_COLUMN = 'Contato';
const CPF_COLUMN = 'CPF';
const RG_COLUMN = 'RG';
const RESPONSIBLE_COLUMN = 'Responsável';
const RESPONSIBLE_EMAIL_COLUMN = 'E-mail do Responsável';
const RESPONSIBLE_CONTACT_COLUMN = 'Contato do Responsável';
const ADDRESS_COLUMN = 'Endereço';
const COMPANY_COLUMN = 'Empresa';
const INSTITUTION_COLUMN = 'Instituição de Ensino';
const LEARNING_ARC_COLUMN = 'Arco de Aprendizagem';
const ROLE_COLUMN = 'Função';
const ADMISSION_DATE_COLUMN = 'Data de Admissão';
const END_DATE_COLUMN = 'Data do Término';
const AGE_COLUMN = 'Idade';
const REMOVED_APRENDIZES_COLUMNS = new Set([normalizeFieldLabel('Período')]);
const ROW_DETAILS_PANEL_MARGIN = 20;
const ROW_DETAILS_PANEL_HEIGHT = 360;
const ROW_DETAILS_PANEL_WIDTH = ROW_DETAILS_PANEL_HEIGHT * 1.4;

const invalidImportedFileMessage =
  'Arquivo importado não possui os valores necessários';

type AprendizesViewSettings = {
  columnWidths: Record<string, number>;
};

type CellEditUndoEntry = {
  kind: 'cell-edit';
  rowIndex: number;
  columnName: string;
  previousValue: string;
  nextValue: string;
};

type RowDeleteUndoEntry = {
  kind: 'row-delete';
  rowIndex: number;
  rowValues: string[];
};

type TableUndoEntry = CellEditUndoEntry | RowDeleteUndoEntry;

type ActiveStudentEdit = {
  rowIndex: number;
  columnName: string;
  initialValue: string;
};

type SaveAprendizesOptions = {
  syncTurmas?: boolean;
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

const defaultAprendizesViewSettings: AprendizesViewSettings = {
  columnWidths: {},
};

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

const readAprendizesViewSettings = () => {
  if (typeof window === 'undefined') {
    return defaultAprendizesViewSettings;
  }

  try {
    const savedView = window.localStorage.getItem(APRENDIZES_VIEW_STORAGE_KEY);
    return savedView
      ? {
          ...defaultAprendizesViewSettings,
          ...(JSON.parse(savedView) as AprendizesViewSettings),
        }
      : defaultAprendizesViewSettings;
  } catch {
    window.localStorage.removeItem(APRENDIZES_VIEW_STORAGE_KEY);
    return defaultAprendizesViewSettings;
  }
};

const getColumnIndex = (sheet: SheetTable | null, columnName: string) =>
  sheet?.columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  ) ?? -1;

const getCellValue = (sheet: SheetTable, row: string[], columnName: string) => {
  const columnIndex = getColumnIndex(sheet, columnName);
  return columnIndex >= 0 ? row[columnIndex] || '' : '';
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

const getUniqueValues = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const getDataIndexSheetColumns = (entity: DataIndexEntity) => {
  const columns = new Set<string>();

  entity.records.forEach((record) => {
    Object.keys(record.fields).forEach((fieldName) => {
      columns.add(fieldName);
    });
  });

  return Array.from(columns);
};

const buildSheetFromDataIndexEntity = (
  entity: DataIndexEntity | null | undefined,
): SheetTable | null => {
  if (!entity || entity.records.length === 0) {
    return null;
  }

  const columns = getDataIndexSheetColumns(entity);

  if (columns.length === 0) {
    return null;
  }

  return {
    fileName: entity.sourceFileName || 'Aprendizes.xlsx',
    sheetName: entity.sourceSheetName || 'Aprendizes',
    importedAt: entity.importedAt || entity.updatedAt || new Date().toISOString(),
    columns,
    rows: [...entity.records]
      .sort((leftRecord, rightRecord) => leftRecord.rowIndex - rightRecord.rowIndex)
      .map((record) =>
        columns.map((column) => normalizeCell(record.fields[column])),
      ),
  };
};

const normalizeDropdownKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const getCanonicalDropdownValue = (value: string, options: string[]) => {
  const valueKey = normalizeDropdownKey(value);

  if (!valueKey) {
    return '';
  }

  return (
    options.find((option) => normalizeDropdownKey(option) === valueKey) ?? null
  );
};

const splitStudentsList = (studentsValue: string) =>
  getUniqueValues(
    studentsValue
      .split(',')
      .map((studentName) => studentName.trim())
      .filter(Boolean),
  );

const countListedStudents = (studentsValue: string) => {
  const normalizedValue = studentsValue.trim();

  if (!normalizedValue) {
    return '0';
  }

  return String(splitStudentsList(normalizedValue).length);
};

const sortStudentNames = (students: string[]) =>
  getUniqueValues(students).sort((leftName, rightName) =>
    leftName.localeCompare(rightName, 'pt-BR', {
      sensitivity: 'base',
    }),
  );

const buildStudentsSummary = (students: string[]) => {
  const sortedStudents = sortStudentNames(students);

  return sortedStudents.length > 0 ? sortedStudents.join(', ') : '';
};

const hasSameSheetData = (leftSheet: SheetTable, rightSheet: SheetTable) => {
  if (leftSheet.columns.length !== rightSheet.columns.length) {
    return false;
  }

  if (
    leftSheet.columns.some((column, columnIndex) => {
      return column !== rightSheet.columns[columnIndex];
    })
  ) {
    return false;
  }

  if (leftSheet.rows.length !== rightSheet.rows.length) {
    return false;
  }

  return leftSheet.rows.every((row, rowIndex) => {
    const rightRow = rightSheet.rows[rowIndex] ?? [];

    return (
      row.length === rightRow.length &&
      row.every((cell, columnIndex) => cell === (rightRow[columnIndex] ?? ''))
    );
  });
};

const normalizeWorkbookColumns = (
  rawColumns: string[],
  requiredColumns: readonly string[],
) => {
  const { missingColumns, normalizedColumns } = normalizeColumnsForSchema(
    rawColumns,
    requiredColumns,
  );

  if (missingColumns.length > 0) {
    throw new MissingRequiredColumnsError(missingColumns);
  }

  return normalizedColumns;
};

const readSheetFile = async (
  file: File,
  requiredColumns: readonly string[],
  options: {
    removedColumns?: Set<string>;
  } = {},
): Promise<SheetTable> => {
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
  const normalizedColumns = normalizeWorkbookColumns(rawColumns, requiredColumns);
  const keptColumnIndexes = normalizedColumns
    .map((column, columnIndex) => ({ column, columnIndex }))
    .filter(
      ({ column }) => !options.removedColumns?.has(normalizeFieldLabel(column)),
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

const withDerivedTurmasValues = (
  sheet: SheetTable,
  studentsByClass?: Map<string, string[]>,
): SheetTable => ({
  ...sheet,
  rows: sheet.rows.map((row) =>
    sheet.columns.map((column, columnIndex) => {
      const turmaName = getCellValue(sheet, row, TURMA_COLUMN);
      const turmaStudents = studentsByClass?.get(turmaName) ?? [];

      if (column === STUDENTS_COUNT_COLUMN) {
        return studentsByClass
          ? String(turmaStudents.length)
          : countListedStudents(getCellValue(sheet, row, STUDENTS_LIST_COLUMN));
      }

      if (column === STUDENTS_LIST_COLUMN && studentsByClass) {
        return buildStudentsSummary(turmaStudents);
      }

      return row[columnIndex] || '';
    }),
  ),
});

const persistDataIndexEntity = async (entityId: string, entity: unknown) => {
  try {
    await fetch(`/api/data-index/entities/${entityId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(entity),
    });
  } catch {
    // The xlsx remains the source of truth; the index can be rebuilt.
  }
};

const persistTurmasDataIndex = async (
  sheet: SheetTable | null,
  studentsByClass?: Map<string, string[]>,
) => {
  const entityIndex = sheet
    ? buildTurmasDataIndexEntity(withDerivedTurmasValues(sheet, studentsByClass))
    : buildEmptyDataIndexEntity(TURMAS_ENTITY_ID, 'Turmas');

  await persistDataIndexEntity(TURMAS_ENTITY_ID, entityIndex);
};

const persistAprendizesDataIndex = async (sheet: SheetTable | null) => {
  const entityIndex = sheet
    ? buildAprendizesDataIndexEntity(sheet)
    : buildEmptyDataIndexEntity(APRENDIZES_ENTITY_ID, 'Aprendizes');

  await persistDataIndexEntity(APRENDIZES_ENTITY_ID, entityIndex);
};

type TurmasPageProps = {
  isActive?: boolean;
};

export function TurmasPage({ isActive = true }: TurmasPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const sharedHorizontalScrollRef = useRef<HTMLDivElement>(null);
  const addStudentCellRef = useRef<HTMLTableCellElement>(null);
  const addStudentOptionsRef = useRef<HTMLDivElement>(null);
  const invalidImportToastTimerRef = useRef<number | null>(null);
  const undoStackRef = useRef<TableUndoEntry[]>([]);
  const activeStudentEditRef = useRef<ActiveStudentEdit | null>(null);
  const isApplyingUndoRef = useRef(false);
  const undoGuardTimerRef = useRef<number | null>(null);
  const [turmasSheet, setTurmasSheet] = useState<SheetTable | null>(null);
  const [aprendizesSheet, setAprendizesSheet] = useState<SheetTable | null>(
    null,
  );
  const [hasCheckedWorkspace, setHasCheckedWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState('');
  const [invalidImportToast, setInvalidImportToast] = useState('');
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [isRecoveringBackup, setIsRecoveringBackup] = useState(false);
  const [expandedTurmas, setExpandedTurmas] = useState<Record<string, boolean>>(
    {},
  );
  const [activeAddTurmaKey, setActiveAddTurmaKey] = useState('');
  const [addStudentSearch, setAddStudentSearch] = useState('');
  const [addStudentDropdownStyle, setAddStudentDropdownStyle] =
    useState<CSSProperties>({});
  const [sharedHorizontalScrollWidth, setSharedHorizontalScrollWidth] =
    useState(0);
  const [aprendizesViewSettings, setAprendizesViewSettings] =
    useState<AprendizesViewSettings>(readAprendizesViewSettings);
  const [selectedStudentRowIndex, setSelectedStudentRowIndex] = useState<
    number | null
  >(null);
  const rowDetailsPanelStyleRef = useRef<CSSProperties>({});
  const [rowDetailsPanelStyle, setRowDetailsPanelStyle] =
    useState<CSSProperties>({});
  const isSyncingStudentsScrollRef = useRef(false);

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

  const syncTurmaStudentsHorizontalScroll = (scrollLeft: number) => {
    const frame = boardFrameRef.current;

    if (!frame) {
      return;
    }

    const panels = frame.querySelectorAll<HTMLDivElement>(
      '.turma-students-panel',
    );

    isSyncingStudentsScrollRef.current = true;
    panels.forEach((panel) => {
      if (panel.scrollLeft !== scrollLeft) {
        panel.scrollLeft = scrollLeft;
      }
    });

    if (
      sharedHorizontalScrollRef.current &&
      sharedHorizontalScrollRef.current.scrollLeft !== scrollLeft
    ) {
      sharedHorizontalScrollRef.current.scrollLeft = scrollLeft;
    }

    window.requestAnimationFrame(() => {
      isSyncingStudentsScrollRef.current = false;
    });
  };

  const updateSharedHorizontalScrollWidth = () => {
    const frame = boardFrameRef.current;

    if (!frame) {
      setSharedHorizontalScrollWidth(0);
      return;
    }

    const panels = frame.querySelectorAll<HTMLDivElement>(
      '.turma-students-panel',
    );
    const maxScrollWidth = Array.from(panels).reduce(
      (width, panel) => Math.max(width, panel.scrollWidth),
      0,
    );

    setSharedHorizontalScrollWidth(maxScrollWidth);
  };

  const handleStudentsPanelScroll = (event: UIEvent<HTMLDivElement>) => {
    if (isSyncingStudentsScrollRef.current) {
      return;
    }

    syncTurmaStudentsHorizontalScroll(event.currentTarget.scrollLeft);
  };

  const handleSharedHorizontalScroll = (event: UIEvent<HTMLDivElement>) => {
    if (isSyncingStudentsScrollRef.current) {
      return;
    }

    syncTurmaStudentsHorizontalScroll(event.currentTarget.scrollLeft);
  };

  const handleBoardWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.turma-add-student-options')) {
      return;
    }

    const horizontalDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey
        ? event.deltaX || event.deltaY
        : 0;

    if (horizontalDelta === 0) {
      return;
    }

    const firstPanel =
      boardFrameRef.current?.querySelector<HTMLDivElement>(
        '.turma-students-panel',
      ) ?? null;

    if (!firstPanel) {
      return;
    }

    event.preventDefault();
    const maxScrollLeft = Math.max(
      0,
      firstPanel.scrollWidth - firstPanel.clientWidth,
    );
    const nextScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, firstPanel.scrollLeft + horizontalDelta),
    );
    syncTurmaStudentsHorizontalScroll(nextScrollLeft);
  };

  const turmaNames = useMemo(
    () =>
      getUniqueValues(
        turmasSheet?.rows.map((row) => getCellValue(turmasSheet, row, TURMA_COLUMN)) ??
          [],
      ),
    [turmasSheet],
  );
  const turmaColumnIndex = getColumnIndex(aprendizesSheet, TURMA_COLUMN);
  const selectedStudentRow =
    selectedStudentRowIndex !== null
      ? aprendizesSheet?.rows[selectedStudentRowIndex] ?? null
      : null;
  const shouldShowStudentDetailsPanel = Boolean(
    aprendizesSheet && selectedStudentRow,
  );
  const studentsByClass = useMemo(
    () =>
      aprendizesSheet
        ? buildStudentsByClass(aprendizesSheet, turmaNames)
        : new Map<string, string[]>(),
    [aprendizesSheet, turmaNames],
  );

  const getAutoAprendizColumnWidth = (column: string) => {
    if (!aprendizesSheet) {
      return DEFAULT_COLUMN_WIDTH;
    }

    const columnIndex = aprendizesSheet.columns.indexOf(column);

    if (columnIndex < 0) {
      return DEFAULT_COLUMN_WIDTH;
    }

    const headerWidth = getWrappedHeaderWidth(column);
    const longestCellWidth = aprendizesSheet.rows.reduce((longestWidth, row) => {
      const cellWidth = measureTextWidth(row[columnIndex] || '', TABLE_FONT);
      return Math.max(longestWidth, cellWidth);
    }, 0);
    const textWidth = Math.ceil(Math.max(headerWidth, longestCellWidth));

    return Math.max(
      MIN_COLUMN_WIDTH,
      textWidth + TABLE_HORIZONTAL_PADDING * 2 + TABLE_WIDTH_BUFFER,
    );
  };

  const getAprendizColumnWidth = (column: string) =>
    aprendizesViewSettings.columnWidths[column] ??
    getAutoAprendizColumnWidth(column);

  const getAprendizColumnWidthStyle = (column: string) => {
    const width = getAprendizColumnWidth(column);

    return {
      width,
      minWidth: width,
      maxWidth: width,
    };
  };

  const getSelectedStudentValue = (columnName: string) =>
    aprendizesSheet && selectedStudentRow
      ? getCellValue(aprendizesSheet, selectedStudentRow, columnName)
      : '';

  const getStudentCellValue = (rowIndex: number, columnName: string) => {
    if (!aprendizesSheet) {
      return '';
    }

    const columnIndex = getColumnIndex(aprendizesSheet, columnName);
    return columnIndex >= 0 ? aprendizesSheet.rows[rowIndex]?.[columnIndex] ?? '' : '';
  };

  const pushTableUndoEntry = (entry: TableUndoEntry) => {
    undoStackRef.current = [...undoStackRef.current, entry].slice(-1000);
    pushGlobalUndoEntry({
      originTab: 'turmas',
      ...entry,
    });
  };

  const beginStudentEdit = (
    rowIndex: number,
    columnName: string,
    initialValue: string,
  ) => {
    const activeEdit = activeStudentEditRef.current;

    if (
      activeEdit?.rowIndex === rowIndex &&
      activeEdit.columnName === columnName
    ) {
      return;
    }

    activeStudentEditRef.current = {
      rowIndex,
      columnName,
      initialValue,
    };
  };

  const updateStudentCell = (
    rowIndex: number,
    columnName: string,
    value: string,
  ) => {
    if (!aprendizesSheet) {
      return null;
    }

    const columnIndex = getColumnIndex(aprendizesSheet, columnName);

    if (columnIndex < 0) {
      return null;
    }

    const nextRows = aprendizesSheet.rows.map((row, currentRowIndex) => {
      if (currentRowIndex !== rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = value;
      return nextRow;
    });
    const nextSheet = {
      ...aprendizesSheet,
      rows: nextRows,
    };

    setAprendizesSheet(nextSheet);
    return nextSheet;
  };

  const commitActiveStudentEditForUndo = () => {
    const activeEdit = activeStudentEditRef.current;

    if (!activeEdit || !aprendizesSheet) {
      activeStudentEditRef.current = null;
      return;
    }

    const columnIndex = getColumnIndex(aprendizesSheet, activeEdit.columnName);
    const nextValue =
      columnIndex >= 0
        ? aprendizesSheet.rows[activeEdit.rowIndex]?.[columnIndex] ?? ''
        : activeEdit.initialValue;

    if (activeEdit.initialValue !== nextValue) {
      pushTableUndoEntry({
        kind: 'cell-edit',
        rowIndex: activeEdit.rowIndex,
        columnName: activeEdit.columnName,
        previousValue: activeEdit.initialValue,
        nextValue,
      });
    }

    activeStudentEditRef.current = null;
  };

  const commitStudentCell = (
    rowIndex: number,
    columnName: string,
    value: string,
  ) => {
    const activeEdit = activeStudentEditRef.current;
    const previousValue =
      activeEdit?.rowIndex === rowIndex && activeEdit.columnName === columnName
        ? activeEdit.initialValue
        : getStudentCellValue(rowIndex, columnName);
    const nextSheet = updateStudentCell(rowIndex, columnName, value);

    if (previousValue !== value) {
      pushTableUndoEntry({
        kind: 'cell-edit',
        rowIndex,
        columnName,
        previousValue,
        nextValue: value,
      });
    }

    activeStudentEditRef.current = null;

    if (nextSheet) {
      void writeAprendizesSheetToSourceFile(nextSheet);
    }
  };

  const deleteStudentAndSave = (rowIndex: number) => {
    if (!aprendizesSheet) {
      return;
    }

    const nextSheet = {
      ...aprendizesSheet,
      rows: aprendizesSheet.rows.filter((_, currentRowIndex) => {
        return currentRowIndex !== rowIndex;
      }),
    };

    pushTableUndoEntry({
      kind: 'row-delete',
      rowIndex,
      rowValues: aprendizesSheet.rows[rowIndex],
    });
    setAprendizesSheet(nextSheet);
    setSelectedStudentRowIndex(null);
    applyRowDetailsPanelStyle({});
    void writeAprendizesSheetToSourceFile(nextSheet);
  };

  const renderStudentDetailsField = ({
    className = '',
    columnName,
    label,
  }: {
    className?: string;
    columnName: string;
    label: string;
  }) => {
    const value = getSelectedStudentValue(columnName);
    const isTurmaField = columnName === TURMA_COLUMN;
    const canonicalValue = isTurmaField
      ? getCanonicalDropdownValue(value, turmaNames)
      : value;
    const selectValue = canonicalValue ?? value;
    const shouldIncludeCurrentValue =
      isTurmaField &&
      value !== '' &&
      canonicalValue === null &&
      !turmaNames.includes(value);

    return (
      <div
        className={['row-details-field', className].filter(Boolean).join(' ')}
      >
        <span className="row-details-field-label">{label}</span>
        <span className="row-details-field-value">
          {isTurmaField ? (
            <select
              aria-label={`${label} do aprendiz`}
              className={[
                'row-details-field-value-input',
                'turma-select',
                value !== '' && canonicalValue === null
                  ? 'invalid-dropdown-value'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              value={selectValue}
              onFocus={() => {
                if (selectedStudentRowIndex !== null) {
                  beginStudentEdit(
                    selectedStudentRowIndex,
                    columnName,
                    value,
                  );
                }
              }}
              onChange={(event) => {
                if (selectedStudentRowIndex === null) {
                  return;
                }

                commitStudentCell(
                  selectedStudentRowIndex,
                  columnName,
                  event.target.value,
                );
              }}
            >
              <option value="">Sem turma</option>
              {shouldIncludeCurrentValue && (
                <option value={value}>{value}</option>
              )}
              {turmaNames.map((turmaName) => (
                <option key={turmaName} value={turmaName}>
                  {turmaName}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="row-details-field-value-input"
              aria-label={`${label} do aprendiz`}
              spellCheck={false}
              value={value}
              onFocus={() => {
                if (selectedStudentRowIndex !== null) {
                  beginStudentEdit(
                    selectedStudentRowIndex,
                    columnName,
                    value,
                  );
                }
              }}
              onChange={(event) => {
                if (selectedStudentRowIndex === null) {
                  return;
                }

                updateStudentCell(
                  selectedStudentRowIndex,
                  columnName,
                  event.currentTarget.value,
                );
              }}
              onBeforeInput={handleInputHistoryUndo}
              onKeyDown={(event) => {
                if (runUndoShortcut(event)) {
                  return;
                }

                if (event.key !== 'Enter' || selectedStudentRowIndex === null) {
                  return;
                }

                event.preventDefault();
                commitStudentCell(
                  selectedStudentRowIndex,
                  columnName,
                  event.currentTarget.value,
                );
              }}
              onBlur={(event) => {
                if (isApplyingUndoRef.current || selectedStudentRowIndex === null) {
                  return;
                }

                commitStudentCell(
                  selectedStudentRowIndex,
                  columnName,
                  event.currentTarget.value,
                );
              }}
            />
          )}
        </span>
      </div>
    );
  };

  const clearWorkingSheet = () => {
    setTurmasSheet(null);
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

  const fetchRecoveryInfo = async () => {
    try {
      const response = await fetch('/api/turmas/backup', {
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

  const exportWorkingFile = async () => {
    if (!hasWorkingSheet || !turmasSheet) {
      return;
    }

    try {
      if (aprendizesSheet) {
        const nextStudentsByClass = buildStudentsByClass(
          aprendizesSheet,
          turmaNames,
        );
        const nextTurmasSheet = withDerivedTurmasValues(
          turmasSheet,
          nextStudentsByClass,
        );

        if (!hasSameSheetData(nextTurmasSheet, turmasSheet)) {
          const savedTurmasSheet = await writeTurmasSheetToSourceFile(
            nextTurmasSheet,
            nextStudentsByClass,
          );

          if (!savedTurmasSheet) {
            throw new Error('sync-before-export-failed');
          }
        } else {
          await persistTurmasDataIndex(turmasSheet, nextStudentsByClass);
        }
      }

      const response = await fetch('/api/turmas/export', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('export-failed');
      }

      setImportError('');
    } catch {
      setImportError('Não foi possível exportar a planilha.');
    }
  };

  const recoverBackup = async () => {
    if (!recoveryInfo?.canRecover || isRecoveringBackup) {
      return;
    }

    setIsRecoveringBackup(true);

    try {
      const response = await fetch('/api/turmas/recover', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('recover-failed');
      }

      await response.json();
      const recoveredTurmasSheet = await loadProviderFile(aprendizesSheet);

      if (recoveredTurmasSheet) {
        await syncAprendizesFromRecoveredTurmas(recoveredTurmasSheet);
      }

      await fetchRecoveryInfo();
      setIsRecoveryDialogOpen(false);
      setImportError('');
    } catch {
      setImportError('Não foi possível recuperar os dados do backup.');
    } finally {
      setIsRecoveringBackup(false);
    }
  };

  const loadAprendizesDataIndexFallback = async () => {
    try {
      const response = await fetch('/api/data-index', {
        cache: 'no-store',
      });

      if (!response.ok) {
        return null;
      }

      const index = (await response.json()) as {
        entities?: Record<string, DataIndexEntity>;
      };
      const fallbackSheet = buildSheetFromDataIndexEntity(
        index.entities?.[APRENDIZES_ENTITY_ID],
      );

      if (!fallbackSheet) {
        return null;
      }

      setAprendizesSheet(fallbackSheet);
      return fallbackSheet;
    } catch {
      return null;
    }
  };

  const loadAprendizesProviderFile = async () => {
    try {
      const response = await fetch('/api/aprendizes/file', {
        cache: 'no-store',
      });

      if (response.status === 404) {
        const fallbackSheet = await loadAprendizesDataIndexFallback();

        if (fallbackSheet) {
          return fallbackSheet;
        }

        setAprendizesSheet(null);
        await persistAprendizesDataIndex(null);
        return null;
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
      const parsedSheet = await readSheetFile(file, APRENDIZES_REQUIRED_COLUMNS, {
        removedColumns: REMOVED_APRENDIZES_COLUMNS,
      });
      const nextSheet = {
        ...parsedSheet,
        fileName,
      };

      setAprendizesSheet(nextSheet);
      await persistAprendizesDataIndex(nextSheet);

      return nextSheet;
    } catch {
      const fallbackSheet = await loadAprendizesDataIndexFallback();

      if (fallbackSheet) {
        return fallbackSheet;
      }

      setAprendizesSheet(null);
      return null;
    }
  };

  const loadProviderFile = async (currentAprendizesSheet: SheetTable | null) => {
    try {
      const response = await fetch('/api/turmas/file', {
        cache: 'no-store',
      });

      if (response.status === 404) {
        clearWorkingSheet();
        await persistTurmasDataIndex(null);
        return null;
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
      const parsedSheet = await readSheetFile(file, TURMAS_REQUIRED_COLUMNS);
      const nextSheet = {
        ...parsedSheet,
        fileName,
      };
      const nextTurmaNames = getUniqueValues(
        nextSheet.rows.map((row) => getCellValue(nextSheet, row, TURMA_COLUMN)),
      );
      const nextStudentsByClass = currentAprendizesSheet
        ? buildStudentsByClass(currentAprendizesSheet, nextTurmaNames)
        : undefined;

      setTurmasSheet(nextSheet);
      setImportError('');
      await persistTurmasDataIndex(nextSheet, nextStudentsByClass);
      await fetchRecoveryInfo();
      return nextSheet;
    } catch (error) {
      clearWorkingSheet();

      if (error instanceof MissingRequiredColumnsError) {
        showInvalidImportToast();
        setImportError('');
        return null;
      }

      setImportError('Não foi possível ler a planilha de turmas.');
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadSavedWorkbooks = async () => {
      const nextAprendizesSheet = await loadAprendizesProviderFile();
      await loadProviderFile(nextAprendizesSheet);

      if (isMounted) {
        setHasCheckedWorkspace(true);
      }
    };

    void loadSavedWorkbooks();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (turmasSheet) {
      void persistTurmasDataIndex(turmasSheet, studentsByClass);
    }
  }, [turmasSheet, studentsByClass]);

  useEffect(() => {
    if (!isActive || !hasCheckedWorkspace) {
      return;
    }

    setAprendizesViewSettings(readAprendizesViewSettings());
    void loadAprendizesProviderFile();
  }, [isActive, hasCheckedWorkspace]);

  useEffect(() => {
    const syncAprendizesViewSettings = (event: StorageEvent) => {
      if (event.key === APRENDIZES_VIEW_STORAGE_KEY) {
        setAprendizesViewSettings(readAprendizesViewSettings());
      }
    };

    window.addEventListener('storage', syncAprendizesViewSettings);

    return () => {
      window.removeEventListener('storage', syncAprendizesViewSettings);
    };
  }, []);

  useLayoutEffect(() => {
    updateSharedHorizontalScrollWidth();
  }, [aprendizesSheet, aprendizesViewSettings, expandedTurmas, turmasSheet]);

  useLayoutEffect(() => {
    if (!activeAddTurmaKey) {
      setAddStudentDropdownStyle({});
      return;
    }

    const updateDropdownMetrics = () => {
      const cell = addStudentCellRef.current;
      const frame = boardFrameRef.current;

      if (!cell || !frame) {
        return;
      }

      const cellRect = cell.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const bottomMargin = 8;
      const optionButtons = Array.from(
        addStudentOptionsRef.current?.querySelectorAll('button') ?? [],
      );
      const longestOptionWidth = optionButtons.reduce((longestWidth, button) => {
        const textWidth = measureTextWidth(button.textContent || '', TABLE_FONT);
        return Math.max(longestWidth, textWidth);
      }, 0);
      const dropdownWidth = Math.max(
        160,
        Math.ceil(longestOptionWidth) + TABLE_HORIZONTAL_PADDING * 2 + 18,
      );
      const maxHeight = Math.max(
        0,
        Math.floor(frameRect.bottom - cellRect.bottom - bottomMargin),
      );

      setAddStudentDropdownStyle({
        left: Math.round(frameRect.left),
        top: Math.round(cellRect.bottom),
        width: dropdownWidth,
        maxHeight,
      });
    };

    updateDropdownMetrics();

    const frame = boardFrameRef.current;
    const scrollElement = boardScrollRef.current;
    let animationFrameId: number | null = null;

    const scheduleDropdownMetricsUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updateSharedHorizontalScrollWidth();
        updateDropdownMetrics();
      });
    };

    window.addEventListener('resize', scheduleDropdownMetricsUpdate);
    scrollElement?.addEventListener('scroll', scheduleDropdownMetricsUpdate);

    let observer: ResizeObserver | null = null;

    if (frame && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleDropdownMetricsUpdate);
      observer.observe(frame);
    }

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      observer?.disconnect();
      window.removeEventListener('resize', scheduleDropdownMetricsUpdate);
      scrollElement?.removeEventListener('scroll', scheduleDropdownMetricsUpdate);
    };
  }, [activeAddTurmaKey, addStudentSearch, aprendizesSheet]);

  useLayoutEffect(() => {
    if (!shouldShowStudentDetailsPanel) {
      applyRowDetailsPanelStyle({});
      return;
    }

    const updatePanelMetrics = () => {
      const frame = boardFrameRef.current;

      if (!frame) {
        return;
      }

      const frameWidth = frame.clientWidth;
      const frameHeight = frame.clientHeight;

      if (frameWidth <= 0 || frameHeight <= 0) {
        return;
      }

      const preferredPanelSize = getRowDetailsPanelSize(frame);
      const maximumRight = frameWidth - ROW_DETAILS_PANEL_MARGIN;
      const maximumBottom = frameHeight - ROW_DETAILS_PANEL_MARGIN;
      const availableWidth = Math.max(0, maximumRight - ROW_DETAILS_PANEL_MARGIN);
      const availableHeight = Math.max(
        0,
        maximumBottom - ROW_DETAILS_PANEL_MARGIN,
      );
      const width = Math.min(preferredPanelSize.width, availableWidth);
      const height = Math.min(preferredPanelSize.height, availableHeight);

      if (width <= 0 || height <= 0) {
        applyRowDetailsPanelStyle({
          display: 'none',
        });
        return;
      }

      applyRowDetailsPanelStyle({
        left: Math.round(maximumRight - width),
        top: Math.round(maximumBottom - height),
        width: Math.round(width),
        height: Math.round(height),
      });
    };

    updatePanelMetrics();

    const frame = boardFrameRef.current;
    let animationFrameId: number | null = null;

    const schedulePanelMetricsUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updatePanelMetrics();
      });
    };

    if (!frame || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', schedulePanelMetricsUpdate);

      return () => {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
        }

        window.removeEventListener('resize', schedulePanelMetricsUpdate);
      };
    }

    const observer = new ResizeObserver(schedulePanelMetricsUpdate);
    observer.observe(frame);
    window.addEventListener('resize', schedulePanelMetricsUpdate);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      observer.disconnect();
      window.removeEventListener('resize', schedulePanelMetricsUpdate);
    };
  }, [shouldShowStudentDetailsPanel]);

  useEffect(
    () => () => {
      if (invalidImportToastTimerRef.current !== null) {
        window.clearTimeout(invalidImportToastTimerRef.current);
      }

      if (undoGuardTimerRef.current !== null) {
        window.clearTimeout(undoGuardTimerRef.current);
      }
    },
    [],
  );

  const importWorkingFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const parsedSheet = await readSheetFile(file, TURMAS_REQUIRED_COLUMNS);
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
      const nextTurmaNames = getUniqueValues(
        nextSheet.rows.map((row) => getCellValue(nextSheet, row, TURMA_COLUMN)),
      );
      const nextStudentsByClass = aprendizesSheet
        ? buildStudentsByClass(aprendizesSheet, nextTurmaNames)
        : undefined;

      setTurmasSheet(nextSheet);
      setImportError('');
      await persistTurmasDataIndex(nextSheet, nextStudentsByClass);
      await fetchRecoveryInfo();
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

  const toggleTurma = (turmaKey: string) => {
    setExpandedTurmas((currentExpandedTurmas) => ({
      ...currentExpandedTurmas,
      [turmaKey]: !currentExpandedTurmas[turmaKey],
    }));
  };

  const openAddStudentPicker = (turmaKey: string) => {
    setActiveAddTurmaKey(turmaKey);
    setAddStudentSearch('');
  };

  const preserveColumnFormulas = (
    utils: XlsxModule['utils'],
    previousWorksheet: XlsxWorksheet | undefined,
    nextWorksheet: XlsxWorksheet,
    sheet: SheetTable,
    columnNames: string[],
  ) => {
    if (!previousWorksheet) {
      return;
    }

    const columnIndexes = columnNames
      .map((columnName) => getColumnIndex(sheet, columnName))
      .filter((columnIndex) => columnIndex >= 0);

    if (columnIndexes.length === 0) {
      return;
    }

    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      columnIndexes.forEach((columnIndex) => {
        const cellAddress = utils.encode_cell({
          c: columnIndex,
          r: rowIndex + 1,
        });
        const previousCell = previousWorksheet[cellAddress];

        if (!previousCell?.f) {
          return;
        }

        nextWorksheet[cellAddress] = {
          ...nextWorksheet[cellAddress],
          ...previousCell,
        };
      });
    }
  };

  const preserveAgeFormulas = (
    utils: XlsxModule['utils'],
    previousWorksheet: XlsxWorksheet | undefined,
    nextWorksheet: XlsxWorksheet,
    sheet: SheetTable,
  ) => {
    preserveColumnFormulas(utils, previousWorksheet, nextWorksheet, sheet, [
      AGE_COLUMN,
    ]);
  };

  const writeTurmasSheetToSourceFile = async (
    sheet: SheetTable,
    nextStudentsByClass?: Map<string, string[]>,
  ) => {
    try {
      const saveResponse = await fetch('/api/turmas/values', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sheetName: sheet.sheetName,
          columns: sheet.columns,
          rows: sheet.rows,
          formulaColumns: [STUDENTS_COUNT_COLUMN],
        }),
      });

      if (!saveResponse.ok) {
        throw new Error('save-failed');
      }

      const result = (await saveResponse.json()) as { fileName?: string };
      const savedSheet = {
        ...sheet,
        fileName: result.fileName || sheet.fileName,
      };

      setTurmasSheet(savedSheet);
      await persistTurmasDataIndex(savedSheet, nextStudentsByClass);
      await fetchRecoveryInfo();
      setImportError('');
      return savedSheet;
    } catch {
      setImportError(
        'A alteração ficou na tela, mas não foi possível gravar em dados.',
      );
      return null;
    }
  };

  const syncTurmasWorkbookFromAprendizes = async (sheet: SheetTable) => {
    if (!turmasSheet) {
      return;
    }

    const nextStudentsByClass = buildStudentsByClass(sheet, turmaNames);
    const nextTurmasSheet = withDerivedTurmasValues(
      turmasSheet,
      nextStudentsByClass,
    );

    if (hasSameSheetData(nextTurmasSheet, turmasSheet)) {
      await persistTurmasDataIndex(turmasSheet, nextStudentsByClass);
      return;
    }

    await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);
  };

  const syncAprendizesFromRecoveredTurmas = async (
    recoveredTurmasSheet: SheetTable,
  ) => {
    if (!aprendizesSheet) {
      await persistTurmasDataIndex(recoveredTurmasSheet);
      return;
    }

    const nameColumnIndex = getColumnIndex(aprendizesSheet, NAME_COLUMN);
    const currentTurmaColumnIndex = getColumnIndex(aprendizesSheet, TURMA_COLUMN);

    if (nameColumnIndex < 0 || currentTurmaColumnIndex < 0) {
      await persistTurmasDataIndex(recoveredTurmasSheet);
      return;
    }

    const recoveredTurmaNames = getUniqueValues(
      recoveredTurmasSheet.rows.map((row) =>
        getCellValue(recoveredTurmasSheet, row, TURMA_COLUMN),
      ),
    );
    const recoveredTurmaKeys = new Set(
      recoveredTurmaNames.map((turmaName) => normalizeDropdownKey(turmaName)),
    );
    const studentAssignmentByName = new Map<string, string>();

    recoveredTurmasSheet.rows.forEach((row) => {
      const turmaName = getCellValue(recoveredTurmasSheet, row, TURMA_COLUMN);
      const studentsValue = getCellValue(
        recoveredTurmasSheet,
        row,
        STUDENTS_LIST_COLUMN,
      );

      if (!turmaName || !studentsValue) {
        return;
      }

      splitStudentsList(studentsValue).forEach((studentName) => {
        const studentKey = normalizeDropdownKey(studentName);

        if (!studentKey || studentAssignmentByName.has(studentKey)) {
          return;
        }

        studentAssignmentByName.set(studentKey, turmaName);
      });
    });

    let didChange = false;
    const nextRows = aprendizesSheet.rows.map((row) => {
      const studentName = row[nameColumnIndex] || '';
      const studentKey = normalizeDropdownKey(studentName);
      const recoveredTurmaName = studentAssignmentByName.get(studentKey);
      const currentTurmaName = row[currentTurmaColumnIndex] || '';
      const currentCanonicalTurmaName =
        getCanonicalDropdownValue(currentTurmaName, recoveredTurmaNames) ??
        currentTurmaName;
      const shouldClearRecoveredTurma =
        currentTurmaName !== '' &&
        recoveredTurmaKeys.has(normalizeDropdownKey(currentCanonicalTurmaName));
      const nextTurmaName =
        recoveredTurmaName ??
        (shouldClearRecoveredTurma ? '' : currentTurmaName);

      if (nextTurmaName === currentTurmaName) {
        return row;
      }

      didChange = true;
      const nextRow = [...row];
      nextRow[currentTurmaColumnIndex] = nextTurmaName;
      return nextRow;
    });
    const nextAprendizesSheet = didChange
      ? {
          ...aprendizesSheet,
          rows: nextRows,
        }
      : aprendizesSheet;
    const recoveredStudentsByClass = buildStudentsByClass(
      nextAprendizesSheet,
      recoveredTurmaNames,
    );

    if (didChange) {
      const savedAprendizesSheet = await writeAprendizesSheetToSourceFile(
        nextAprendizesSheet,
        { syncTurmas: false },
      );

      await persistTurmasDataIndex(
        recoveredTurmasSheet,
        savedAprendizesSheet
          ? buildStudentsByClass(savedAprendizesSheet, recoveredTurmaNames)
          : recoveredStudentsByClass,
      );
      return;
    }

    await persistTurmasDataIndex(recoveredTurmasSheet, recoveredStudentsByClass);
  };

  const writeAprendizesSheetToSourceFile = async (
    sheet: SheetTable,
    options: SaveAprendizesOptions = {},
  ) => {
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
      const nextWorksheet = utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);
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
      const savedSheet = {
        ...sheet,
        fileName: result.fileName || sheet.fileName,
      };

      setAprendizesSheet(savedSheet);
      await persistAprendizesDataIndex(savedSheet);
      if (options.syncTurmas !== false) {
        await syncTurmasWorkbookFromAprendizes(savedSheet);
      }
      window.dispatchEvent(new Event(APRENDIZES_DATA_CHANGED_EVENT));
      setImportError('');
      return savedSheet;
    } catch {
      setImportError(
        'A alteração ficou na tela, mas não foi possível gravar em dados.',
      );
    }
  };

  const canonicalizeAprendizesTurmaValues = (sheet: SheetTable) => {
    if (turmaNames.length === 0) {
      return null;
    }

    const currentTurmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

    if (currentTurmaColumnIndex < 0) {
      return null;
    }

    let didChange = false;
    const nextRows = sheet.rows.map((row) => {
      const value = row[currentTurmaColumnIndex] || '';
      const canonicalValue = getCanonicalDropdownValue(value, turmaNames);

      if (!canonicalValue || canonicalValue === value) {
        return row;
      }

      didChange = true;
      const nextRow = [...row];
      nextRow[currentTurmaColumnIndex] = canonicalValue;
      return nextRow;
    });

    return didChange
      ? {
          ...sheet,
          rows: nextRows,
        }
      : null;
  };

  useEffect(() => {
    if (!aprendizesSheet || turmaNames.length === 0) {
      return;
    }

    const canonicalSheet = canonicalizeAprendizesTurmaValues(aprendizesSheet);

    if (!canonicalSheet) {
      return;
    }

    setAprendizesSheet(canonicalSheet);
    void writeAprendizesSheetToSourceFile(canonicalSheet);
  }, [aprendizesSheet, turmaNames]);

  const assignStudentToTurma = (studentRowIndex: number, turmaName: string) => {
    if (!aprendizesSheet || turmaColumnIndex < 0) {
      return;
    }

    const previousValue =
      aprendizesSheet.rows[studentRowIndex]?.[turmaColumnIndex] ?? '';

    if (previousValue === turmaName) {
      return;
    }

    const nextRows = aprendizesSheet.rows.map((row, rowIndex) => {
      if (rowIndex !== studentRowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[turmaColumnIndex] = turmaName;
      return nextRow;
    });
    const nextSheet = {
      ...aprendizesSheet,
      rows: nextRows,
    };

    pushTableUndoEntry({
      kind: 'cell-edit',
      rowIndex: studentRowIndex,
      columnName: TURMA_COLUMN,
      previousValue,
      nextValue: turmaName,
    });
    setAprendizesSheet(nextSheet);
    void writeAprendizesSheetToSourceFile(nextSheet);
  };

  const closeStudentDetailsPanel = () => {
    setSelectedStudentRowIndex(null);
    applyRowDetailsPanelStyle({});
  };

  const handleAddStudentToTurma = (turmaName: string, rowIndex: number) => {
    assignStudentToTurma(rowIndex, turmaName);
    setActiveAddTurmaKey('');
    setAddStudentSearch('');
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

  const undoLastAction = () => {
    commitActiveStudentEditForUndo();
    protectUndoCommit();

    const undoEntry = undoStackRef.current.at(-1);

    if (!undoEntry || !aprendizesSheet) {
      return null;
    }

    undoStackRef.current = undoStackRef.current.slice(0, -1);

    if (undoEntry.kind === 'row-delete') {
      const nextRows = [...aprendizesSheet.rows];
      nextRows.splice(undoEntry.rowIndex, 0, undoEntry.rowValues);
      const nextSheet = {
        ...aprendizesSheet,
        rows: nextRows,
      };

      setAprendizesSheet(nextSheet);
      setSelectedStudentRowIndex(undoEntry.rowIndex);
      return nextSheet;
    }

    const columnIndex = getColumnIndex(aprendizesSheet, undoEntry.columnName);

    if (columnIndex < 0 || !aprendizesSheet.rows[undoEntry.rowIndex]) {
      return null;
    }

    const nextRows = aprendizesSheet.rows.map((row, rowIndex) => {
      if (rowIndex !== undoEntry.rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = undoEntry.previousValue;
      return nextRow;
    });
    const nextSheet = {
      ...aprendizesSheet,
      rows: nextRows,
    };

    setAprendizesSheet(nextSheet);
    setSelectedStudentRowIndex(undoEntry.rowIndex);
    return nextSheet;
  };

  const undoLastActionAndSave = () => {
    const nextSheet = undoLastAction();

    if (nextSheet) {
      void writeAprendizesSheetToSourceFile(nextSheet);
    }
  };

  const runUndoShortcut = (
    event: Pick<
      KeyboardEvent,
      | 'ctrlKey'
      | 'defaultPrevented'
      | 'key'
      | 'metaKey'
      | 'preventDefault'
      | 'shiftKey'
      | 'stopPropagation'
    >,
  ) => {
    return handleGlobalUndoShortcut(event);
  };

  const handleInputHistoryUndo = (event: FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;

    if (nativeEvent.inputType !== 'historyUndo') {
      return;
    }

    event.preventDefault();
    void handleGlobalUndoShortcut({
      ctrlKey: true,
      defaultPrevented: false,
      key: 'z',
      metaKey: false,
      preventDefault: () => {},
      shiftKey: false,
      stopPropagation: () => {},
    });
  };

  useEffect(
    () =>
      registerGlobalUndoController('turmas', {
        beforeUndo: commitActiveStudentEditForUndo,
        undo: () => {
          undoLastActionAndSave();
          return true;
        },
      }),
    [aprendizesSheet, selectedStudentRowIndex],
  );

  const hasWorkingSheet = Boolean(turmasSheet);
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);
  const recoveryButtonLabel =
    recoveryInfo?.formattedUpdatedAt
      ? `Recuperar ${recoveryInfo.label || 'Turmas'} - ${
          recoveryInfo.formattedUpdatedAt
        }`
      : `Recuperar ${recoveryInfo?.label || 'Turmas'}`;
  const recoveryDescription = getRecoveryDescription(recoveryInfo);

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
              className={
                canRecoverBackup
                  ? 'square-action toolbar-section-start'
                  : 'square-action toolbar-section-start disabled'
              }
              type="button"
              aria-label="Recuperar dados"
              title="Recuperar Dados"
              disabled={!canRecoverBackup}
              onClick={() => setIsRecoveryDialogOpen(true)}
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
              className={
                hasWorkingSheet ? 'square-action' : 'square-action disabled'
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

      {hasWorkingSheet && turmasSheet && (
        <div className="data-table-panel turmas-data-table-panel">
          <div className="data-table-frame turmas-board-frame" ref={boardFrameRef}>
            <div
              className="turmas-board-scroll"
              ref={boardScrollRef}
              role="region"
              tabIndex={0}
              onWheel={handleBoardWheel}
            >
              <div className="turmas-board">
                {turmasSheet.rows.map((turmaRow, turmaRowIndex) => {
                  const turmaName =
                    getCellValue(turmasSheet, turmaRow, TURMA_COLUMN) ||
                    `Turma ${turmaRowIndex + 1}`;
                  const turmaKey = `${turmaName}-${turmaRowIndex}`;
                  const isExpanded = Boolean(expandedTurmas[turmaKey]);
                  const assignedStudents = getAssignedStudents(
                    aprendizesSheet,
                    turmaName,
                    turmaNames,
                  );
                  const availableStudents = getAvailableStudents(
                    aprendizesSheet,
                    turmaName,
                    turmaNames,
                  );

                  return (
                    <section
                      className={isExpanded ? 'turma-group expanded' : 'turma-group'}
                      key={turmaKey}
                    >
                      <button
                        className="turma-group-header"
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => toggleTurma(turmaKey)}
                      >
                        <span className="turma-header-title">{turmaName}</span>
                        <ChevronIcon expanded={isExpanded} />
                      </button>

                      {isExpanded && (
                        <div
                          className="turma-students-panel"
                          onScroll={handleStudentsPanelScroll}
                        >
                          {aprendizesSheet ? (
                            <table className="data-table turma-students-table">
                              <colgroup>
                                {aprendizesSheet.columns.map((column) => (
                                  <col
                                    key={column}
                                    style={getAprendizColumnWidthStyle(column)}
                                  />
                                ))}
                              </colgroup>
                              <tbody>
                                {assignedStudents.map(({ row, rowIndex }) => (
                                  <tr
                                    className={
                                      selectedStudentRowIndex === rowIndex
                                        ? 'row-details-selected'
                                        : ''
                                    }
                                    key={rowIndex}
                                    onClick={() =>
                                      setSelectedStudentRowIndex(rowIndex)
                                    }
                                  >
                                    {aprendizesSheet.columns.map(
                                      (column, columnIndex) => {
                                        const value = row[columnIndex] || '';
                                        const isTurmaColumn =
                                          normalizeFieldLabel(column) ===
                                          normalizeFieldLabel(TURMA_COLUMN);
                                        const isInvalidTurma =
                                          isTurmaColumn &&
                                          value !== '' &&
                                          getCanonicalDropdownValue(
                                            value,
                                            turmaNames,
                                          ) === null;

                                        return (
                                          <td
                                            className={
                                              isInvalidTurma
                                                ? 'invalid-dropdown-cell'
                                                : ''
                                            }
                                            key={`${rowIndex}-${column}`}
                                            style={getAprendizColumnWidthStyle(
                                              column,
                                            )}
                                          >
                                            {value}
                                          </td>
                                        );
                                      },
                                    )}
                                  </tr>
                                ))}
                                <tr className="turma-add-student-row">
                                  <td
                                    className={
                                      activeAddTurmaKey === turmaKey
                                        ? 'turma-add-student-cell active'
                                        : 'turma-add-student-cell'
                                    }
                                    colSpan={aprendizesSheet.columns.length}
                                    ref={
                                      activeAddTurmaKey === turmaKey
                                        ? addStudentCellRef
                                        : null
                                    }
                                    onClick={() => {
                                      if (activeAddTurmaKey !== turmaKey) {
                                        openAddStudentPicker(turmaKey);
                                      }
                                    }}
                                  >
                                    {activeAddTurmaKey === turmaKey ? (
                                      <div
                                        className="turma-add-student-picker"
                                        onBlur={(event) => {
                                          const nextFocusedElement =
                                            event.relatedTarget;

                                          if (
                                            nextFocusedElement instanceof Node &&
                                            event.currentTarget.contains(
                                              nextFocusedElement,
                                            )
                                          ) {
                                            return;
                                          }

                                          setActiveAddTurmaKey('');
                                          setAddStudentSearch('');
                                        }}
                                      >
                                        <input
                                          autoFocus
                                          aria-label="Buscar aprendiz"
                                          value={addStudentSearch}
                                          onChange={(event) =>
                                            setAddStudentSearch(
                                              event.target.value,
                                            )
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === 'Escape') {
                                              setActiveAddTurmaKey('');
                                              setAddStudentSearch('');
                                            }
                                          }}
                                        />
                                        <div
                                          className="turma-add-student-options"
                                          ref={addStudentOptionsRef}
                                          style={addStudentDropdownStyle}
                                        >
                                          {filterAvailableStudents(
                                            availableStudents,
                                            aprendizesSheet,
                                            addStudentSearch,
                                          ).map(({ row, rowIndex }) => (
                                            <button
                                              key={rowIndex}
                                              type="button"
                                              onMouseDown={(event) =>
                                                event.preventDefault()
                                              }
                                              onClick={() =>
                                                handleAddStudentToTurma(
                                                  turmaName,
                                                  rowIndex,
                                                )
                                              }
                                            >
                                              {getCellValue(
                                                aprendizesSheet,
                                                row,
                                                NAME_COLUMN,
                                              ) || `Aprendiz ${rowIndex + 1}`}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <span>+ Adicionar Aprendiz</span>
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          ) : (
                            <div className="turma-empty-students">
                              Nenhuma planilha de aprendizes encontrada.
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
            {sharedHorizontalScrollWidth > 0 && (
              <div
                className="turmas-shared-horizontal-scroll"
                ref={sharedHorizontalScrollRef}
                onScroll={handleSharedHorizontalScroll}
                aria-label="Rolagem horizontal dos aprendizes"
                role="presentation"
              >
                <div
                  className="turmas-shared-horizontal-scroll-spacer"
                  style={{ width: sharedHorizontalScrollWidth }}
                />
              </div>
            )}
            {shouldShowStudentDetailsPanel &&
              aprendizesSheet &&
              selectedStudentRow && (
                <aside
                  className="row-details-panel turma-student-details-panel"
                  style={rowDetailsPanelStyle}
                  aria-label="Detalhes do aprendiz"
                >
                  <div className="row-details-content">
                    <section
                      className="row-details-info-section"
                      aria-label="Informações do aprendiz"
                    >
                      <div className="row-details-field-layer row-details-primary-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-name',
                          columnName: NAME_COLUMN,
                          label: 'Nome',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-sex',
                          columnName: SEX_COLUMN,
                          label: 'Sexo',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-birthdate',
                          columnName: BIRTHDATE_COLUMN,
                          label: 'Data Nascimento',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-age',
                          columnName: AGE_COLUMN,
                          label: 'Idade',
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-secondary-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-email',
                          columnName: EMAIL_COLUMN,
                          label: 'E-mail',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-contact',
                          columnName: CONTACT_COLUMN,
                          label: 'Contato',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-cpf',
                          columnName: CPF_COLUMN,
                          label: 'CPF',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-rg',
                          columnName: RG_COLUMN,
                          label: 'RG',
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-tertiary-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-responsible-name',
                          columnName: RESPONSIBLE_COLUMN,
                          label: 'Nome Responsável',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-responsible-email',
                          columnName: RESPONSIBLE_EMAIL_COLUMN,
                          label: 'Email Responsável',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-responsible-contact',
                          columnName: RESPONSIBLE_CONTACT_COLUMN,
                          label: 'Contato Responsável',
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-address-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-address',
                          columnName: ADDRESS_COLUMN,
                          label: 'Endereço',
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-company-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-company',
                          columnName: COMPANY_COLUMN,
                          label: 'Empresa',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-institution',
                          columnName: INSTITUTION_COLUMN,
                          label: 'Instituição Ensino',
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-learning-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-learning-arc',
                          columnName: LEARNING_ARC_COLUMN,
                          label: 'Arco Aprendizagem',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-role',
                          columnName: ROLE_COLUMN,
                          label: 'Função',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-admission-date',
                          columnName: ADMISSION_DATE_COLUMN,
                          label: 'Data Admissão',
                        })}
                        {renderStudentDetailsField({
                          className: 'row-details-field-end-date',
                          columnName: END_DATE_COLUMN,
                          label: 'Data Término',
                        })}
                      </div>
                      <div className="row-details-field-layer row-details-class-layer">
                        {renderStudentDetailsField({
                          className: 'row-details-field-class',
                          columnName: TURMA_COLUMN,
                          label: 'Turma',
                        })}
                      </div>
                    </section>
                    <footer
                      className="row-details-actions"
                      aria-label="Ações do aprendiz"
                    >
                      <button
                        className="row-details-action-button row-details-delete-button"
                        type="button"
                        aria-label="Descadastrar aprendiz"
                        title="Descadastrar Aprendiz"
                        onClick={() => {
                          if (selectedStudentRowIndex !== null) {
                            deleteStudentAndSave(selectedStudentRowIndex);
                          }
                        }}
                      >
                        <UserXIcon />
                      </button>
                    </footer>
                    <button
                      className="row-details-close-button"
                      type="button"
                      aria-label="Fechar detalhes"
                      onClick={closeStudentDetailsPanel}
                    >
                      <CloseIcon />
                    </button>
                  </div>
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

      {invalidImportToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {invalidImportToast}
        </div>
      )}

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
            aria-labelledby="turmas-recovery-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="recovery-dialog-header">
              <h2 id="turmas-recovery-dialog-title">Recuperar Dados</h2>
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

const buildStudentsByClass = (sheet: SheetTable, turmaNames: string[] = []) => {
  const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);
  const studentNameColumnIndex = getColumnIndex(sheet, NAME_COLUMN);
  const nextStudentsByClass = new Map<string, string[]>();

  if (turmaColumnIndex < 0 || studentNameColumnIndex < 0) {
    return nextStudentsByClass;
  }

  sheet.rows.forEach((row) => {
    const rawTurmaName = row[turmaColumnIndex] || '';
    const turmaName =
      getCanonicalDropdownValue(rawTurmaName, turmaNames) ?? rawTurmaName;
    const studentName = row[studentNameColumnIndex] || '';

    if (!turmaName || !studentName) {
      return;
    }

    const turmaStudents = nextStudentsByClass.get(turmaName) ?? [];
    turmaStudents.push(studentName);
    nextStudentsByClass.set(turmaName, turmaStudents);
  });

  return nextStudentsByClass;
};

const getAssignedStudents = (
  sheet: SheetTable | null,
  turmaName: string,
  turmaNames: string[],
) => {
  const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

  if (!sheet || turmaColumnIndex < 0) {
    return [];
  }

  return sheet.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      const rawTurmaName = row[turmaColumnIndex] || '';
      const canonicalTurmaName =
        getCanonicalDropdownValue(rawTurmaName, turmaNames) ?? rawTurmaName;

      return canonicalTurmaName === turmaName;
    });
};

const getAvailableStudents = (
  sheet: SheetTable | null,
  turmaName: string,
  turmaNames: string[],
) => {
  const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

  if (!sheet || turmaColumnIndex < 0) {
    return [];
  }

  return sheet.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      const rawTurmaName = row[turmaColumnIndex] || '';
      const canonicalTurmaName =
        getCanonicalDropdownValue(rawTurmaName, turmaNames) ?? rawTurmaName;

      return canonicalTurmaName !== turmaName;
    });
};

const filterAvailableStudents = (
  students: Array<{ row: string[]; rowIndex: number }>,
  sheet: SheetTable,
  search: string,
) => {
  const normalizedSearch = normalizeFieldLabel(search);
  const getStudentName = (row: string[], rowIndex: number) =>
    getCellValue(sheet, row, NAME_COLUMN) || `Aprendiz ${rowIndex + 1}`;
  const sortByStudentName = (
    leftStudent: { row: string[]; rowIndex: number },
    rightStudent: { row: string[]; rowIndex: number },
  ) =>
    getStudentName(leftStudent.row, leftStudent.rowIndex).localeCompare(
      getStudentName(rightStudent.row, rightStudent.rowIndex),
      'pt-BR',
      {
        sensitivity: 'base',
      },
    );

  if (!normalizedSearch) {
    return [...students].sort(sortByStudentName);
  }

  return students
    .filter(({ row, rowIndex }) =>
      normalizeFieldLabel(getStudentName(row, rowIndex)).includes(
        normalizedSearch,
      ),
    )
    .sort((leftStudent, rightStudent) => {
      const leftName = normalizeFieldLabel(
        getStudentName(leftStudent.row, leftStudent.rowIndex),
      );
      const rightName = normalizeFieldLabel(
        getStudentName(rightStudent.row, rightStudent.rowIndex),
      );
      const leftStartsWithSearch = leftName.startsWith(normalizedSearch);
      const rightStartsWithSearch = rightName.startsWith(normalizedSearch);

      if (leftStartsWithSearch !== rightStartsWithSearch) {
        return leftStartsWithSearch ? -1 : 1;
      }

      return sortByStudentName(leftStudent, rightStudent);
    });
};

function getRecoveryDescription(info: RecoveryInfo | null) {
  switch (info?.reason) {
    case 'before_import':
      return 'Recupere os dados anteriores à última importação.';
    case 'before_edit':
      return 'Recupere os dados para como estavam antes de edições nesta sessão.';
    case 'before_session_edit':
      return 'Recupere os dados para como estavam antes da última sessão com edições.';
    case 'import_original':
      return 'Recupere os dados originais da planilha importada.';
    case 'before_recovery':
      return 'Recupere os dados para como estavam antes da última recuperação.';
    case 'after_recovery':
      return 'Recupere os dados para como estavam após a última recuperação.';
    default:
      return 'Nenhum backup disponível para recuperar.';
  }
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={expanded ? 'turma-chevron expanded' : 'turma-chevron'}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="m9 6 6 6 -6 6" />
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

function SquarePlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
    </svg>
  );
}
