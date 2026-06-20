import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
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
import { getBaseWorkbookSheetByEntity } from '../../shared/data/baseWorkbook';
import {
  APRENDIZES_DATA_CHANGED_EVENT,
  GLOBAL_DATA_CHANGED_EVENT,
  GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT,
  GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT,
} from '../../shared/data/events';
import {
  APRENDIZES_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from '../../shared/data/schemas';
import {
  ensureSheetRecordIds,
  getPublicColumns,
  getSheetRecordId,
} from '../../shared/data/stableIds';
import {
  MissingRequiredColumnsError,
  fetchRecoveryInfo as fetchWorkspaceRecoveryInfo,
  isUnifiedWorkbookFile,
  loadXlsx,
  readWorkbookSheetFile,
  recoverGlobalData as recoverWorkspaceGlobalData,
  responseToWorkbookFile,
} from '../../shared/data/workspaceData';
import {
  emptyWorkbookOptions,
  mergeWorkbookOptionValues,
  persistWorkbookOption,
  readWorkbookOptions,
  type WorkbookOptionType,
  type WorkbookOptions,
} from '../../shared/data/workbookOptions';
import {
  GlobalWorkbookToolbar,
  useGlobalWorkbookState,
} from '../../shared/ui/GlobalWorkbookToolbar';
import {
  getGlobalUndoBoundarySnapshot,
  handleGlobalUndoShortcut,
  isGlobalUndoInProgress,
  pushGlobalBoundaryUndoEntry,
  pushGlobalUndoEntry,
  remapGlobalUndoCheckpointReferences,
  replaceGlobalUndoStack,
  registerGlobalUndoController,
  type GlobalUndoEntry,
} from '../../shared/undo/globalUndo';

type XlsxModule = typeof import('xlsx');
type XlsxWorksheet = ReturnType<XlsxModule['utils']['aoa_to_sheet']>;

const normalizeCell = (value: unknown) => String(value ?? '').trim();
const APRENDIZES_VIEW_STORAGE_KEY = 'sejaelevar.aprendizes.view.v1';
const DEFAULT_COLUMN_WIDTH = 96;
const MIN_COLUMN_WIDTH = 34;
const TABLE_HORIZONTAL_PADDING = 10;
const TABLE_WIDTH_BUFFER = 6;
const TABLE_FONT = '12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TABLE_HEADER_FONT =
  '800 12.8px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TURMA_HEADER_TITLE_FONT =
  '900 16.64px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TURMA_HEADER_DETAIL_FONT =
  '800 16px Aptos, "Segoe UI Variable", "Segoe UI", sans-serif';
const TURMA_HEADER_LEFT_PADDING = 22;
const TURMA_HEADER_RIGHT_PADDING = 30;
const TURMA_HEADER_ICON_WIDTH = 21;
const TURMA_HEADER_ICON_GAP = 10;
const TURMA_HEADER_TITLE_HORIZONTAL_PADDING =
  TURMA_HEADER_LEFT_PADDING + TURMA_HEADER_RIGHT_PADDING;
const TURMA_HEADER_DETAIL_HORIZONTAL_PADDING =
  TURMA_HEADER_LEFT_PADDING +
  TURMA_HEADER_RIGHT_PADDING +
  TURMA_HEADER_ICON_WIDTH +
  TURMA_HEADER_ICON_GAP;
const TURMA_HEADER_TITLE_MIN_WIDTH = 62;
const TURMA_HEADER_COUNT_MIN_WIDTH = 44;
const TURMA_HEADER_DAY_MIN_WIDTH = 54;
const TURMA_HEADER_PERIOD_MIN_WIDTH = 138;
const TURMA_HEADER_INSTRUCTOR_MIN_WIDTH = 118;
const TURMA_HEADER_ROOM_MIN_WIDTH = 72;
const STUDENTS_COUNT_COLUMN = 'No. de Aprendizes';
const STUDENTS_LIST_COLUMN = 'Aprendizes';
const TURMA_COLUMN = 'Turma';
const TURMA_DAY_COLUMN = 'Dia';
const TURMA_PERIOD_COLUMN = 'Período';
const TURMA_INSTRUCTOR_COLUMN = 'Instrutor';
const TURMA_ROOM_COLUMN = 'Sala';
const NAME_COLUMN = 'Nome';
const APRENDIZES_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(APRENDIZES_ENTITY_ID)?.sheetName ?? 'Aprendizes';
const TURMAS_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(TURMAS_ENTITY_ID)?.sheetName ?? 'Turmas';
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
const TURMAS_ROW_DETAILS_VERTICAL_OFFSET = -1;
const ROW_DETAILS_PANEL_HEIGHT = 360;
const ROW_DETAILS_PANEL_WIDTH = ROW_DETAILS_PANEL_HEIGHT * 1.4;

const invalidImportedFileMessage =
  'Arquivo importado não possui os valores necessários';

type AprendizesViewSettings = {
  columnOrder: string[];
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

type TurmaRowRef = number | 'draft';

type TurmaHeaderField =
  | 'name'
  | 'count'
  | 'day'
  | 'period'
  | 'instructor'
  | 'room';

type ActiveTurmaNameEdit = {
  rowIndex: TurmaRowRef;
  initialValue: string;
  draftValue: string;
};

type ActiveTurmaDropdown = {
  rowIndex: TurmaRowRef;
  field: Exclude<TurmaHeaderField, 'name' | 'count'>;
  columnName: string;
  style: CSSProperties;
  draftValue: string;
};

type TurmaDraftRow = {
  id: string;
  values: Record<string, string>;
};

type ClearedAprendizTurma = {
  rowIndex: number;
  previousValue: string;
};

type StudentDetailsInputElement = HTMLInputElement | HTMLSelectElement;

type SaveAprendizesOptions = {
  applyLocalState?: boolean;
  patchColumns?: string[];
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
  checkpointId?: string | null;
  fileName?: string | null;
  label?: string | null;
  formattedUpdatedAt?: string | null;
  reason?: RecoveryReason | null;
  importCount?: number | null;
  fileCount?: number | null;
  checkpoints?: Array<{
    checkpointId?: string | null;
    canRecover: boolean;
    label?: string | null;
    formattedUpdatedAt?: string | null;
    reason?: RecoveryReason | null;
    importCount?: number | null;
    fileCount?: number | null;
  }>;
};

const defaultAprendizesViewSettings: AprendizesViewSettings = {
  columnOrder: [],
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

const getMeasuredFieldWidth = (
  values: string[],
  font: string,
  minimumWidth: number,
  horizontalPadding: number,
) =>
  Math.max(
    minimumWidth,
    Math.ceil(
      values.reduce(
        (width, value) => Math.max(width, measureTextWidth(value || '-', font)),
        0,
      ) + horizontalPadding,
    ),
  );

const TURMA_DAY_ABBREVIATIONS = new Map([
  ['segunda', 'Seg'],
  ['segunda feira', 'Seg'],
  ['segunda-feira', 'Seg'],
  ['seg', 'Seg'],
  ['terca', 'Ter'],
  ['terca feira', 'Ter'],
  ['terca-feira', 'Ter'],
  ['ter', 'Ter'],
  ['quarta', 'Qua'],
  ['quarta feira', 'Qua'],
  ['quarta-feira', 'Qua'],
  ['qua', 'Qua'],
  ['quinta', 'Qui'],
  ['quinta feira', 'Qui'],
  ['quinta-feira', 'Qui'],
  ['qui', 'Qui'],
  ['sexta', 'Sex'],
  ['sexta feira', 'Sex'],
  ['sexta-feira', 'Sex'],
  ['sex', 'Sex'],
]);

const formatTurmaDay = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '-';
  }

  return TURMA_DAY_ABBREVIATIONS.get(normalizeFieldLabel(trimmedValue)) ?? trimmedValue;
};

const formatTimeToken = (hour: string, minute?: string) => {
  const parsedHour = Number.parseInt(hour, 10);

  if (!Number.isFinite(parsedHour)) {
    return '';
  }

  const normalizedHour = String(parsedHour).padStart(2, '0');
  const normalizedMinute = String(
    minute && minute.length > 0 ? Number.parseInt(minute, 10) : 0,
  ).padStart(2, '0');

  return `${normalizedHour}:${normalizedMinute}h`;
};

const formatTurmaPeriod = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '-';
  }

  const matches = Array.from(
    trimmedValue.matchAll(/(\d{1,2})(?:(?::|h|H)(\d{2}))?/g),
  )
    .map((match) => formatTimeToken(match[1], match[2]))
    .filter(Boolean);

  if (matches.length >= 2) {
    return `${matches[0]} - ${matches[1]}`;
  }

  return trimmedValue;
};

const getTurmaPeriodStartMinutes = (value: string) => {
  const firstTimeMatch = value.trim().match(/(\d{1,2})(?:(?::|h|H)(\d{2}))?/);

  if (!firstTimeMatch) {
    return null;
  }

  const hour = Number.parseInt(firstTimeMatch[1], 10);
  const minute = firstTimeMatch[2]
    ? Number.parseInt(firstTimeMatch[2], 10)
    : 0;

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
};

const getTurmaPeriodEndMinutes = (value: string) => {
  const timeMatches = Array.from(
    value.trim().matchAll(/(\d{1,2})(?:(?::|h|H)(\d{2}))?/g),
  );
  const endTimeMatch = timeMatches[1];

  if (!endTimeMatch) {
    return getTurmaPeriodStartMinutes(value);
  }

  const hour = Number.parseInt(endTimeMatch[1], 10);
  const minute = endTimeMatch[2]
    ? Number.parseInt(endTimeMatch[2], 10)
    : 0;

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
};

const TURMA_DAY_OPTIONS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const TURMA_DAY_ORDER = new Map(
  TURMA_DAY_OPTIONS.map((day, index) => [normalizeFieldLabel(day), index]),
);
const PERIOD_CURSOR_POSITIONS = [0, 1, 3, 4, 9, 10, 12, 13, 15];

const isPeriodDigitAllowed = (digit: string, digitIndex: number) => {
  const numericDigit = Number.parseInt(digit, 10);

  if (!Number.isFinite(numericDigit)) {
    return false;
  }

  const positionInTime = digitIndex % 4;

  if (positionInTime === 0) {
    return numericDigit >= 0 && numericDigit <= 2;
  }

  if (positionInTime === 2) {
    return numericDigit >= 0 && numericDigit <= 6;
  }

  return numericDigit >= 0 && numericDigit <= 9;
};

const getPeriodDigits = (value: string) => {
  const digits = Array.from(value.matchAll(/\d/g)).map((match) => match[0]);
  let nextDigits = '';

  for (const digit of digits) {
    if (nextDigits.length >= 8) {
      break;
    }

    if (isPeriodDigitAllowed(digit, nextDigits.length)) {
      nextDigits += digit;
    }
  }

  return nextDigits;
};

const formatPeriodDigits = (digits: string) => {
  const paddedDigits = digits.padEnd(8, ' ');
  return `${paddedDigits.slice(0, 2)}:${paddedDigits.slice(2, 4)}h - ${paddedDigits.slice(
    4,
    6,
  )}:${paddedDigits.slice(6, 8)}h`;
};

const getCommittedPeriodFromDigits = (digits: string) =>
  digits.length === 8 ? formatPeriodDigits(digits) : '';

const getPeriodCursorPosition = (digitCount: number) =>
  PERIOD_CURSOR_POSITIONS[Math.max(0, Math.min(digitCount, 8))] ?? 0;

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

const readSheetFile = async (
  file: File,
  entity: string,
  requiredColumns: readonly string[],
  options: {
    preferredSheetName?: string;
    removedColumns?: Set<string>;
  } = {},
): Promise<SheetTable> => {
  return readWorkbookSheetFile(file, {
    entityId: entity,
    preferredSheetName: options.preferredSheetName ?? '',
    removedColumns: options.removedColumns,
    requiredColumns,
  });
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
  canInitialize?: boolean;
  isActive?: boolean;
};

export function TurmasPage({
  canInitialize = true,
  isActive = true,
}: TurmasPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const sharedHorizontalScrollRef = useRef<HTMLDivElement>(null);
  const addStudentCellRef = useRef<HTMLTableCellElement>(null);
  const addStudentOptionsRef = useRef<HTMLDivElement>(null);
  const invalidImportToastTimerRef = useRef<number | null>(null);
  const undoStackRef = useRef<TableUndoEntry[]>([]);
  const activeStudentEditRef = useRef<ActiveStudentEdit | null>(null);
  const sourceWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const isApplyingUndoRef = useRef(false);
  const didInitializeWorkspaceRef = useRef(false);
  const suppressNextAprendizesChangeEventRef = useRef(false);
  const suppressNextGlobalDataChangeEventRef = useRef(false);
  const undoGuardTimerRef = useRef<number | null>(null);
  const studentDetailsInputRefs = useRef<
    Record<string, StudentDetailsInputElement | null>
  >({});
  const pendingStudentDetailsFocusColumnRef = useRef('');
  const [turmasSheet, setTurmasSheet] = useState<SheetTable | null>(null);
  const [aprendizesSheet, setAprendizesSheet] = useState<SheetTable | null>(
    null,
  );
  const [workbookOptions, setWorkbookOptions] =
    useState<WorkbookOptions>(emptyWorkbookOptions);
  const latestTurmasSheetRef = useRef<SheetTable | null>(turmasSheet);
  const latestAprendizesSheetRef = useRef<SheetTable | null>(aprendizesSheet);
  const [hasCheckedWorkspace, setHasCheckedWorkspace] = useState(false);
  const [isWorkspaceSyncing, setIsWorkspaceSyncing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState('');
  const [invalidImportToast, setInvalidImportToast] = useState('');
  const globalWorkbookState = useGlobalWorkbookState();
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [isRecoveringBackup, setIsRecoveringBackup] = useState(false);
  const [expandedTurmas, setExpandedTurmas] = useState<Record<string, boolean>>(
    {},
  );
  const [turmaDraft, setTurmaDraft] = useState<TurmaDraftRow | null>(null);
  const [turmaDeleteConfirmation, setTurmaDeleteConfirmation] = useState<{
    rowIndex: number;
    turmaName: string;
  } | null>(null);
  const [activeAddTurmaKey, setActiveAddTurmaKey] = useState('');
  const [addStudentSearch, setAddStudentSearch] = useState('');
  const [addStudentDropdownStyle, setAddStudentDropdownStyle] =
    useState<CSSProperties>({});
  const [activeTurmaNameEdit, setActiveTurmaNameEdit] =
    useState<ActiveTurmaNameEdit | null>(null);
  const activeTurmaNameEditRef = useRef<ActiveTurmaNameEdit | null>(null);
  const [activeTurmaDropdown, setActiveTurmaDropdown] =
    useState<ActiveTurmaDropdown | null>(null);
  const activeTurmaDropdownRef = useRef<ActiveTurmaDropdown | null>(null);
  const turmaPeriodInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    latestTurmasSheetRef.current = turmasSheet;
  }, [turmasSheet]);

  useEffect(() => {
    latestAprendizesSheetRef.current = aprendizesSheet;
  }, [aprendizesSheet]);

  useEffect(() => {
    activeTurmaNameEditRef.current = activeTurmaNameEdit;
  }, [activeTurmaNameEdit]);

  useEffect(() => {
    activeTurmaDropdownRef.current = activeTurmaDropdown;
  }, [activeTurmaDropdown]);

  useLayoutEffect(() => {
    if (activeTurmaDropdown?.field !== 'period') {
      return;
    }

    const cursorPosition = getPeriodCursorPosition(
      activeTurmaDropdown.draftValue.length,
    );

    window.requestAnimationFrame(() => {
      const input = turmaPeriodInputRef.current;

      input?.focus();
      input?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [activeTurmaDropdown?.field, activeTurmaDropdown?.draftValue]);

  useEffect(() => {
    if (!activeTurmaDropdown) {
      return;
    }

    const closeDropdownOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (
        target?.closest('.turma-header-dropdown') ||
        target?.closest('.turma-header-detail')
      ) {
        return;
      }

      const dropdown = activeTurmaDropdownRef.current;

      if (dropdown?.field !== 'day' && dropdown?.draftValue.trim()) {
        void commitTurmaDropdownDraft();
        return;
      }

      activeTurmaDropdownRef.current = null;
      setActiveTurmaDropdown(null);
    };

    window.addEventListener('mousedown', closeDropdownOnOutsideClick);

    return () => {
      window.removeEventListener('mousedown', closeDropdownOnOutsideClick);
    };
  }, [activeTurmaDropdown]);

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

  useEffect(() => {
    if (isActive) {
      return;
    }

    void commitActiveTurmaNameEdit();
    void commitActiveStudentEditForUndo();
    setSelectedStudentRowIndex(null);
    applyRowDetailsPanelStyle({});
  }, [isActive]);

  const syncTurmaStudentsHorizontalScroll = (scrollLeft: number) => {
    const frame = boardFrameRef.current;

    if (!frame) {
      return;
    }

    const scrollTargets = frame.querySelectorAll<HTMLElement>(
      '.turma-students-panel, .turma-header-details',
    );

    isSyncingStudentsScrollRef.current = true;
    scrollTargets.forEach((target) => {
      const canScrollTarget = target.scrollWidth > target.clientWidth + 1;
      const nextScrollLeft = canScrollTarget ? scrollLeft : 0;

      if (target.scrollLeft !== nextScrollLeft) {
        target.scrollLeft = nextScrollLeft;
      }
    });
    frame.style.setProperty(
      '--turmas-horizontal-scroll-left',
      `${Math.max(0, scrollLeft)}px`,
    );

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

    const scrollTargets = frame.querySelectorAll<HTMLElement>(
      '.turma-students-panel, .turma-header-details',
    );
    const frameClientWidth = frame.clientWidth;
    const hasOverflow = Array.from(scrollTargets).some(
      (target) => target.scrollWidth > target.clientWidth + 1,
    );
    const maxSharedWidth = Array.from(scrollTargets).reduce(
      (width, target) =>
        Math.max(
          width,
          target.scrollWidth + Math.max(0, frameClientWidth - target.clientWidth),
        ),
      0,
    );

    setSharedHorizontalScrollWidth(hasOverflow ? maxSharedWidth : 0);
  };

  const handleStudentsPanelScroll = (event: UIEvent<HTMLElement>) => {
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

    const firstScrollableTarget =
      boardFrameRef.current?.querySelector<HTMLElement>(
        '.turma-students-panel, .turma-header-details',
      ) ?? null;

    if (!firstScrollableTarget) {
      return;
    }

    event.preventDefault();
    const maxScrollLeft = Math.max(
      0,
      sharedHorizontalScrollRef.current
        ? sharedHorizontalScrollRef.current.scrollWidth -
            sharedHorizontalScrollRef.current.clientWidth
        : firstScrollableTarget.scrollWidth - firstScrollableTarget.clientWidth,
    );
    const currentScrollLeft =
      sharedHorizontalScrollRef.current?.scrollLeft ??
      firstScrollableTarget.scrollLeft;
    const nextScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, currentScrollLeft + horizontalDelta),
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
  const studentsByClass = useMemo(
    () =>
      aprendizesSheet
        ? buildStudentsByClass(aprendizesSheet, turmaNames)
        : new Map<string, string[]>(),
    [aprendizesSheet, turmaNames],
  );
  const turmaHeaderRows = useMemo(
    () =>
      turmasSheet?.rows.map((row, rowIndex) => {
        const name =
          getCellValue(turmasSheet, row, TURMA_COLUMN) ||
          `Turma ${rowIndex + 1}`;
        const rawPeriod = getCellValue(turmasSheet, row, TURMA_PERIOD_COLUMN);
        const periodStartMinutes = getTurmaPeriodStartMinutes(rawPeriod);

        return {
          name,
          count: String(studentsByClass.get(name)?.length ?? 0),
          day: formatTurmaDay(getCellValue(turmasSheet, row, TURMA_DAY_COLUMN)),
          isMorning: periodStartMinutes === null || periodStartMinutes < 12 * 60,
          period: formatTurmaPeriod(rawPeriod),
          instructor:
            getCellValue(turmasSheet, row, TURMA_INSTRUCTOR_COLUMN) || '-',
          room: getCellValue(turmasSheet, row, TURMA_ROOM_COLUMN) || '-',
        };
      }) ?? [],
    [studentsByClass, turmasSheet],
  );
  const sortedTurmaRows = useMemo(() => {
    if (!turmasSheet) {
      return [];
    }

    return turmasSheet.rows
      .map((row, rowIndex) => ({
        row,
        rowIndex,
      }))
      .sort((left, right) => {
        const leftDay =
          TURMA_DAY_ORDER.get(
            normalizeFieldLabel(getCellValue(turmasSheet, left.row, TURMA_DAY_COLUMN)),
          ) ?? Number.MAX_SAFE_INTEGER;
        const rightDay =
          TURMA_DAY_ORDER.get(
            normalizeFieldLabel(getCellValue(turmasSheet, right.row, TURMA_DAY_COLUMN)),
          ) ?? Number.MAX_SAFE_INTEGER;
        const leftStart =
          getTurmaPeriodStartMinutes(
            getCellValue(turmasSheet, left.row, TURMA_PERIOD_COLUMN),
          ) ?? Number.MAX_SAFE_INTEGER;
        const rightStart =
          getTurmaPeriodStartMinutes(
            getCellValue(turmasSheet, right.row, TURMA_PERIOD_COLUMN),
          ) ?? Number.MAX_SAFE_INTEGER;
        const leftEnd =
          getTurmaPeriodEndMinutes(
            getCellValue(turmasSheet, left.row, TURMA_PERIOD_COLUMN),
          ) ?? Number.MAX_SAFE_INTEGER;
        const rightEnd =
          getTurmaPeriodEndMinutes(
            getCellValue(turmasSheet, right.row, TURMA_PERIOD_COLUMN),
          ) ?? Number.MAX_SAFE_INTEGER;
        const dayDiff = leftDay - rightDay;
        const startDiff = leftStart - rightStart;
        const endDiff = leftEnd - rightEnd;

        if (dayDiff !== 0) {
          return dayDiff;
        }

        if (startDiff !== 0) {
          return startDiff;
        }

        if (endDiff !== 0) {
          return endDiff;
        }

        return getCellValue(turmasSheet, left.row, TURMA_COLUMN).localeCompare(
          getCellValue(turmasSheet, right.row, TURMA_COLUMN),
          'pt-BR',
          { sensitivity: 'base' },
        );
      });
  }, [turmasSheet]);
  const turmaHeaderLayoutStyle = useMemo(
    () =>
      ({
        '--turma-header-title-width': `${getMeasuredFieldWidth(
          turmaHeaderRows.map((row) => row.name),
          TURMA_HEADER_TITLE_FONT,
          TURMA_HEADER_TITLE_MIN_WIDTH,
          TURMA_HEADER_TITLE_HORIZONTAL_PADDING,
        )}px`,
        '--turma-header-count-width': `${getMeasuredFieldWidth(
          turmaHeaderRows.map((row) => row.count),
          TURMA_HEADER_DETAIL_FONT,
          TURMA_HEADER_COUNT_MIN_WIDTH,
          TURMA_HEADER_DETAIL_HORIZONTAL_PADDING,
        )}px`,
        '--turma-header-day-width': `${getMeasuredFieldWidth(
          turmaHeaderRows.map((row) => row.day),
          TURMA_HEADER_DETAIL_FONT,
          TURMA_HEADER_DAY_MIN_WIDTH,
          TURMA_HEADER_DETAIL_HORIZONTAL_PADDING,
        )}px`,
        '--turma-header-period-width': `${getMeasuredFieldWidth(
          turmaHeaderRows.map((row) => row.period),
          TURMA_HEADER_DETAIL_FONT,
          TURMA_HEADER_PERIOD_MIN_WIDTH,
          TURMA_HEADER_DETAIL_HORIZONTAL_PADDING,
        )}px`,
        '--turma-header-instructor-width': `${getMeasuredFieldWidth(
          turmaHeaderRows.map((row) => row.instructor),
          TURMA_HEADER_DETAIL_FONT,
          TURMA_HEADER_INSTRUCTOR_MIN_WIDTH,
          TURMA_HEADER_DETAIL_HORIZONTAL_PADDING,
        )}px`,
        '--turma-header-room-width': `${getMeasuredFieldWidth(
          turmaHeaderRows.map((row) => row.room),
          TURMA_HEADER_DETAIL_FONT,
          TURMA_HEADER_ROOM_MIN_WIDTH,
          TURMA_HEADER_DETAIL_HORIZONTAL_PADDING,
        )}px`,
      }) as CSSProperties,
    [turmaHeaderRows],
  );
  const periodOptions = useMemo(
    () =>
      mergeWorkbookOptionValues(
        workbookOptions.periodo,
        getUniqueValues(
          turmaHeaderRows
            .map((row) => row.period)
            .filter((value) => value !== '-'),
        ),
      ),
    [turmaHeaderRows, workbookOptions.periodo],
  );
  const instructorOptions = useMemo(
    () =>
      mergeWorkbookOptionValues(
        workbookOptions.instrutor,
        getUniqueValues(
          turmaHeaderRows
            .map((row) => row.instructor)
            .filter((value) => value !== '-'),
        ),
      ),
    [turmaHeaderRows, workbookOptions.instrutor],
  );
  const roomOptions = useMemo(
    () =>
      mergeWorkbookOptionValues(
        workbookOptions.sala,
        getUniqueValues(
          turmaHeaderRows
            .map((row) => row.room)
            .filter((value) => value !== '-'),
        ),
      ),
    [turmaHeaderRows, workbookOptions.sala],
  );
  const turmaColumnIndex = getColumnIndex(aprendizesSheet, TURMA_COLUMN);
  const selectedStudentRow =
    selectedStudentRowIndex !== null
      ? aprendizesSheet?.rows[selectedStudentRowIndex] ?? null
      : null;
  const shouldShowStudentDetailsPanel = Boolean(
    aprendizesSheet && selectedStudentRow,
  );
  const orderedAprendizColumns = useMemo(() => {
    if (!aprendizesSheet) {
      return [];
    }

    return getPublicColumns(aprendizesSheet.columns);
  }, [aprendizesSheet]);

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
    const currentSheet = latestAprendizesSheetRef.current;

    if (!currentSheet) {
      return '';
    }

    const columnIndex = getColumnIndex(currentSheet, columnName);
    return columnIndex >= 0 ? currentSheet.rows[rowIndex]?.[columnIndex] ?? '' : '';
  };

  const getStudentActionRef = (rowIndex: number) =>
    aprendizesSheet
      ? getSheetRecordId(aprendizesSheet, rowIndex, APRENDIZES_ENTITY_ID)
      : `apr#${rowIndex + 1}`;

  const getStudentActionLabel = (entry: TableUndoEntry) => {
    if (!aprendizesSheet) {
      return getStudentActionRef(entry.rowIndex);
    }

    const nameColumnIndex = getColumnIndex(aprendizesSheet, NAME_COLUMN);

    if (nameColumnIndex < 0) {
      return getStudentActionRef(entry.rowIndex);
    }

    if (entry.kind === 'row-delete') {
      return entry.rowValues[nameColumnIndex] || getStudentActionRef(entry.rowIndex);
    }

    return (
      aprendizesSheet.rows[entry.rowIndex]?.[nameColumnIndex] ||
      getStudentActionRef(entry.rowIndex)
    );
  };

  const pushTableUndoEntry = (entry: TableUndoEntry) => {
    undoStackRef.current = [...undoStackRef.current, entry].slice(-1000);
    pushGlobalUndoEntry({
      originTab: 'turmas',
      itemRef: getStudentActionRef(entry.rowIndex),
      itemLabel: getStudentActionLabel(entry),
      ...entry,
    });
  };

  const getTurmaActionRef = (rowIndex: number) =>
    turmasSheet
      ? getSheetRecordId(turmasSheet, rowIndex, TURMAS_ENTITY_ID)
      : `tur#${rowIndex + 1}`;

  const getTurmaActionLabel = (
    rowIndex: number,
    fallbackValue?: string,
    sheet: SheetTable | null = latestTurmasSheetRef.current,
  ) => {
    if (!sheet) {
      return fallbackValue || getTurmaActionRef(rowIndex);
    }

    const turmaName = getCellValue(
      sheet,
      sheet.rows[rowIndex] ?? [],
      TURMA_COLUMN,
    );

    return turmaName || fallbackValue || getTurmaActionRef(rowIndex);
  };

  const areTurmaDraftValuesComplete = (values: Record<string, string>) =>
    Boolean(
      values[TURMA_COLUMN]?.trim() &&
        values[TURMA_DAY_COLUMN]?.trim() &&
        values[TURMA_PERIOD_COLUMN]?.trim() &&
        values[TURMA_INSTRUCTOR_COLUMN]?.trim() &&
        values[TURMA_ROOM_COLUMN]?.trim(),
    );

  const getVisibleTurmaDraftValues = (
    draft: TurmaDraftRow | null,
  ): Record<string, string> => {
    if (!draft) {
      return {};
    }

    return {
      ...draft.values,
      ...(activeTurmaNameEdit?.rowIndex === 'draft'
        ? { [TURMA_COLUMN]: activeTurmaNameEdit.draftValue.trim() }
        : {}),
    };
  };

  const isTurmaDraftComplete = (draft: TurmaDraftRow | null) =>
    areTurmaDraftValuesComplete(getVisibleTurmaDraftValues(draft));

  const updateTurmaDraftField = (columnName: string, value: string) => {
    setTurmaDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            values: {
              ...currentDraft.values,
              [columnName]: value,
            },
          }
        : currentDraft,
    );
  };

  const focusTurmaDraftName = (draft: TurmaDraftRow) => {
    activeTurmaDropdownRef.current = null;
    setActiveTurmaDropdown(null);
    activeTurmaNameEditRef.current = {
      rowIndex: 'draft',
      initialValue: draft.values[TURMA_COLUMN] ?? '',
      draftValue: draft.values[TURMA_COLUMN] ?? '',
    };
    setActiveTurmaNameEdit(activeTurmaNameEditRef.current);
  };

  const startTurmaDraft = () => {
    if (!turmasSheet) {
      return;
    }

    if (turmaDraft) {
      focusTurmaDraftName(turmaDraft);
      return;
    }

    const nextDraft: TurmaDraftRow = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      values: {},
    };

    setTurmaDraft(nextDraft);
    window.requestAnimationFrame(() => focusTurmaDraftName(nextDraft));
  };

  const isTurmaFieldUndoEntry = (
    entry: GlobalUndoEntry | undefined,
  ): entry is GlobalUndoEntry & CellEditUndoEntry => {
    return (
      Boolean(entry) &&
      entry?.kind === 'cell-edit' &&
      entry.entityId === TURMAS_ENTITY_ID &&
      typeof entry.rowIndex === 'number' &&
      typeof entry.columnName === 'string' &&
      typeof entry.previousValue === 'string' &&
      typeof entry.nextValue === 'string'
    );
  };

  const isTurmaRowUndoEntry = (
    entry: GlobalUndoEntry | undefined,
  ): entry is GlobalUndoEntry & {
    kind: 'row-insert' | 'row-delete';
    entityId: string;
    rowIndex: number;
    rowValues: string[];
    clearedAprendizTurmas?: ClearedAprendizTurma[];
  } => {
    return (
      Boolean(entry) &&
      (entry?.kind === 'row-insert' || entry?.kind === 'row-delete') &&
      entry.entityId === TURMAS_ENTITY_ID &&
      typeof entry.rowIndex === 'number' &&
      Array.isArray(entry.rowValues)
    );
  };

  const selectStudentFromTable = (rowIndex: number, focusColumnName?: string) => {
    if (selectedStudentRowIndex !== null && selectedStudentRowIndex !== rowIndex) {
      void commitActiveStudentEditForUndo();
    }

    if (focusColumnName && focusColumnName !== AGE_COLUMN) {
      pendingStudentDetailsFocusColumnRef.current = focusColumnName;
    } else {
      pendingStudentDetailsFocusColumnRef.current = '';
    }

    setSelectedStudentRowIndex(rowIndex);
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
    const currentSheet = latestAprendizesSheetRef.current;

    if (!currentSheet) {
      return null;
    }

    const columnIndex = getColumnIndex(currentSheet, columnName);

    if (columnIndex < 0) {
      return null;
    }

    if ((currentSheet.rows[rowIndex]?.[columnIndex] ?? '') === value) {
      return null;
    }

    const nextRows = currentSheet.rows.map((row, currentRowIndex) => {
      if (currentRowIndex !== rowIndex) {
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

    latestAprendizesSheetRef.current = nextSheet;
    setAprendizesSheet(nextSheet);
    return nextSheet;
  };

  const flushPendingAprendizesWrites = async () => {
    await sourceWriteQueueRef.current.catch(() => {
      // The write path owns its visible error state.
    });
  };

  const commitActiveStudentEditForUndo = async () => {
    const activeEdit = activeStudentEditRef.current;

    if (!activeEdit || !latestAprendizesSheetRef.current) {
      activeStudentEditRef.current = null;
      await flushPendingAprendizesWrites();
      return;
    }

    const currentSheet = latestAprendizesSheetRef.current;
    const columnIndex = getColumnIndex(currentSheet, activeEdit.columnName);
    const activeInput =
      studentDetailsInputRefs.current[
        `${activeEdit.rowIndex}-${activeEdit.columnName}`
      ];
    const savedValue =
      columnIndex >= 0
        ? currentSheet.rows[activeEdit.rowIndex]?.[columnIndex] ?? ''
        : activeEdit.initialValue;
    const nextValue = activeInput?.value ?? savedValue;

    if (activeEdit.initialValue !== nextValue) {
      await commitStudentCell(
        activeEdit.rowIndex,
        activeEdit.columnName,
        nextValue,
      );
      await flushPendingAprendizesWrites();
      return;
    }

    activeStudentEditRef.current = null;
    await flushPendingAprendizesWrites();
  };

  const commitActiveTurmaNameEdit = async () => {
    const activeEdit = activeTurmaNameEditRef.current;

    if (!activeEdit) {
      return;
    }

    activeTurmaNameEditRef.current = null;
    setActiveTurmaNameEdit(null);

    if (activeEdit.initialValue === activeEdit.draftValue.trim()) {
      return;
    }

    if (activeEdit.rowIndex === 'draft') {
      updateTurmaDraftField(TURMA_COLUMN, activeEdit.draftValue.trim());
      return;
    }

    await commitTurmaHeaderField(
      activeEdit.rowIndex,
      TURMA_COLUMN,
      activeEdit.draftValue,
    );
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

    if (previousValue === value) {
      activeStudentEditRef.current = null;
      return Promise.resolve(null);
    }

    const nextSheet = updateStudentCell(rowIndex, columnName, value);

    if (!nextSheet) {
      activeStudentEditRef.current = null;
      return Promise.resolve(null);
    }

    pushTableUndoEntry({
      kind: 'cell-edit',
      rowIndex,
      columnName,
      previousValue,
      nextValue: value,
    });

    activeStudentEditRef.current = null;

    if (nextSheet) {
      return writeAprendizesSheetToSourceFile(nextSheet, {
        patchColumns: [columnName],
      });
    }

    return Promise.resolve(null);
  };

  const getAprendizesSheetWithRenamedTurma = (
    sheet: SheetTable | null,
    previousTurmaName: string,
    nextTurmaName: string,
  ) => {
    if (!sheet || previousTurmaName === nextTurmaName) {
      return null;
    }

    const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

    if (turmaColumnIndex < 0) {
      return null;
    }

    let didChange = false;
    const nextRows = sheet.rows.map((row) => {
      const value = row[turmaColumnIndex] || '';
      const shouldUpdate =
        value === previousTurmaName ||
        getCanonicalDropdownValue(value, [previousTurmaName]) ===
          previousTurmaName;

      if (!shouldUpdate) {
        return row;
      }

      didChange = true;
      const nextRow = [...row];
      nextRow[turmaColumnIndex] = nextTurmaName;
      return nextRow;
    });

    return didChange
      ? {
          ...sheet,
          rows: nextRows,
        }
      : null;
  };

  const commitTurmaHeaderField = async (
    rowIndex: number,
    columnName: string,
    value: string,
    options: { trackUndo?: boolean } = {},
  ) => {
    const currentTurmasSheet = latestTurmasSheetRef.current;

    if (!currentTurmasSheet) {
      return false;
    }

    const columnIndex = getColumnIndex(currentTurmasSheet, columnName);

    if (columnIndex < 0 || !currentTurmasSheet.rows[rowIndex]) {
      return false;
    }

    const previousValue =
      currentTurmasSheet.rows[rowIndex]?.[columnIndex] ?? '';
    const nextValue = value.trim();

    if (previousValue === nextValue) {
      return false;
    }

    const nextRows = currentTurmasSheet.rows.map((row, currentRowIndex) => {
      if (currentRowIndex !== rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = nextValue;
      return nextRow;
    });
    const nextTurmasSheet = {
      ...currentTurmasSheet,
      rows: nextRows,
    };
    const nextTurmaNames = getUniqueValues(
      nextTurmasSheet.rows.map((row) =>
        getCellValue(nextTurmasSheet, row, TURMA_COLUMN),
      ),
    );
    const renamedAprendizesSheet =
      columnName === TURMA_COLUMN
        ? getAprendizesSheetWithRenamedTurma(
            latestAprendizesSheetRef.current,
            previousValue,
            nextValue,
          )
        : null;
    const studentsSourceSheet =
      renamedAprendizesSheet ?? latestAprendizesSheetRef.current;
    const nextStudentsByClass = studentsSourceSheet
      ? buildStudentsByClass(studentsSourceSheet, nextTurmaNames)
      : undefined;

    if (options.trackUndo !== false) {
      pushGlobalUndoEntry({
        originTab: 'turmas',
        kind: 'cell-edit',
        entityId: TURMAS_ENTITY_ID,
        itemRef: getTurmaActionRef(rowIndex),
        itemLabel: getTurmaActionLabel(rowIndex, previousValue, currentTurmasSheet),
        rowIndex,
        columnName,
        previousValue,
        nextValue,
      });
    }

    latestTurmasSheetRef.current = nextTurmasSheet;
    setTurmasSheet(nextTurmasSheet);

    if (renamedAprendizesSheet) {
      latestAprendizesSheetRef.current = renamedAprendizesSheet;
      setAprendizesSheet(renamedAprendizesSheet);
    }

    await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);

    if (renamedAprendizesSheet) {
      await writeAprendizesSheetToSourceFile(renamedAprendizesSheet, {
        patchColumns: [TURMA_COLUMN],
        syncTurmas: false,
      });
    }

    return true;
  };

  const getAprendizesSheetWithClearedTurma = (
    sheet: SheetTable | null,
    turmaName: string,
  ) => {
    if (!sheet || !turmaName.trim()) {
      return { sheet: null, clearedAprendizTurmas: [] };
    }

    const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

    if (turmaColumnIndex < 0) {
      return { sheet: null, clearedAprendizTurmas: [] };
    }

    const clearedAprendizTurmas: ClearedAprendizTurma[] = [];
    const nextRows = sheet.rows.map((row, rowIndex) => {
      const value = row[turmaColumnIndex] || '';
      const shouldClear =
        value === turmaName ||
        getCanonicalDropdownValue(value, [turmaName]) === turmaName;

      if (!shouldClear) {
        return row;
      }

      clearedAprendizTurmas.push({
        rowIndex,
        previousValue: value,
      });
      const nextRow = [...row];
      nextRow[turmaColumnIndex] = '';
      return nextRow;
    });

    return clearedAprendizTurmas.length > 0
      ? {
          sheet: {
            ...sheet,
            rows: nextRows,
          },
          clearedAprendizTurmas,
        }
      : { sheet: null, clearedAprendizTurmas: [] };
  };

  const getAprendizesSheetWithRestoredTurmas = (
    sheet: SheetTable | null,
    clearedAprendizTurmas: ClearedAprendizTurma[] = [],
  ) => {
    if (!sheet || clearedAprendizTurmas.length === 0) {
      return null;
    }

    const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

    if (turmaColumnIndex < 0) {
      return null;
    }

    const valuesByRowIndex = new Map(
      clearedAprendizTurmas.map((entry) => [entry.rowIndex, entry.previousValue]),
    );
    const nextRows = sheet.rows.map((row, rowIndex) => {
      if (!valuesByRowIndex.has(rowIndex)) {
        return row;
      }

      const nextRow = [...row];
      nextRow[turmaColumnIndex] = valuesByRowIndex.get(rowIndex) ?? '';
      return nextRow;
    });

    return {
      ...sheet,
      rows: nextRows,
    };
  };

  const saveTurmaDraft = async () => {
    const currentTurmasSheet = latestTurmasSheetRef.current;
    const currentDraft = turmaDraft;

    if (!currentTurmasSheet || !currentDraft) {
      return false;
    }

    const activeDraftNameEdit =
      activeTurmaNameEditRef.current?.rowIndex === 'draft'
        ? activeTurmaNameEditRef.current.draftValue.trim()
        : null;

    const draftValues: Record<string, string> = {
      ...currentDraft.values,
      ...(activeDraftNameEdit !== null
        ? { [TURMA_COLUMN]: activeDraftNameEdit }
        : {}),
    };

    if (!areTurmaDraftValuesComplete(draftValues)) {
      return false;
    }
    const rowValues = currentTurmasSheet.columns.map(
      (columnName) => draftValues[columnName] ?? '',
    );
    const rowIndex = currentTurmasSheet.rows.length;
    const nextTurmasSheet = {
      ...currentTurmasSheet,
      rows: [...currentTurmasSheet.rows, rowValues],
    };
    const nextTurmaNames = getUniqueValues(
      nextTurmasSheet.rows.map((row) =>
        getCellValue(nextTurmasSheet, row, TURMA_COLUMN),
      ),
    );
    const nextStudentsByClass = latestAprendizesSheetRef.current
      ? buildStudentsByClass(latestAprendizesSheetRef.current, nextTurmaNames)
      : undefined;
    const turmaName =
      draftValues[TURMA_COLUMN] || `Turma ${currentTurmasSheet.rows.length + 1}`;

    pushGlobalUndoEntry({
      originTab: 'turmas',
      kind: 'row-insert',
      entityId: TURMAS_ENTITY_ID,
      itemRef: `tur#${rowIndex + 1}`,
      itemLabel: turmaName,
      rowIndex,
      rowValues,
    });

    latestTurmasSheetRef.current = nextTurmasSheet;
    setTurmasSheet(nextTurmasSheet);
    setTurmaDraft(null);
    activeTurmaNameEditRef.current = null;
    setActiveTurmaNameEdit(null);
    activeTurmaDropdownRef.current = null;
    setActiveTurmaDropdown(null);

    await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);
    await Promise.all([
      rememberWorkbookOption('period', draftValues[TURMA_PERIOD_COLUMN] ?? ''),
      rememberWorkbookOption('instructor', draftValues[TURMA_INSTRUCTOR_COLUMN] ?? ''),
      rememberWorkbookOption('room', draftValues[TURMA_ROOM_COLUMN] ?? ''),
    ]);
    return true;
  };

  const deleteTurmaRowAndSave = async (
    rowIndex: number,
    options: { trackUndo?: boolean } = {},
  ) => {
    const currentTurmasSheet = latestTurmasSheetRef.current;
    const deletedRow = currentTurmasSheet?.rows[rowIndex];

    if (!currentTurmasSheet || !deletedRow) {
      return false;
    }

    const turmaName = getCellValue(currentTurmasSheet, deletedRow, TURMA_COLUMN);
    const nextTurmasSheet = {
      ...currentTurmasSheet,
      rows: currentTurmasSheet.rows.filter(
        (_row, currentRowIndex) => currentRowIndex !== rowIndex,
      ),
    };
    const { sheet: clearedAprendizesSheet, clearedAprendizTurmas } =
      getAprendizesSheetWithClearedTurma(
        latestAprendizesSheetRef.current,
        turmaName,
      );
    const nextAprendizesSheet =
      clearedAprendizesSheet ?? latestAprendizesSheetRef.current;
    const nextTurmaNames = getUniqueValues(
      nextTurmasSheet.rows.map((row) =>
        getCellValue(nextTurmasSheet, row, TURMA_COLUMN),
      ),
    );
    const nextStudentsByClass = nextAprendizesSheet
      ? buildStudentsByClass(nextAprendizesSheet, nextTurmaNames)
      : undefined;

    if (options.trackUndo !== false) {
      pushGlobalUndoEntry({
        originTab: 'turmas',
        kind: 'row-delete',
        entityId: TURMAS_ENTITY_ID,
        itemRef: getTurmaActionRef(rowIndex),
        itemLabel: turmaName || getTurmaActionRef(rowIndex),
        rowIndex,
        rowValues: deletedRow,
        clearedAprendizTurmas,
      });
    }

    latestTurmasSheetRef.current = nextTurmasSheet;
    setTurmasSheet(nextTurmasSheet);
    setTurmaDeleteConfirmation(null);

    if (clearedAprendizesSheet) {
      latestAprendizesSheetRef.current = clearedAprendizesSheet;
      setAprendizesSheet(clearedAprendizesSheet);
    }

    await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);

    if (clearedAprendizesSheet) {
      await writeAprendizesSheetToSourceFile(clearedAprendizesSheet, {
        patchColumns: [TURMA_COLUMN],
        syncTurmas: false,
      });
    }

    return true;
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

  const focusStudentDetailsField = (
    rowIndex: number,
    columnName: string,
    { openPicker = false }: { openPicker?: boolean } = {},
  ) => {
    const input = studentDetailsInputRefs.current[`${rowIndex}-${columnName}`];

    if (!input) {
      return;
    }

    input.focus();

    if (input instanceof HTMLInputElement) {
      input.select();
      return;
    }

    if (openPicker) {
      const select = input as HTMLSelectElement & { showPicker?: () => void };

      try {
        select.showPicker?.();
      } catch {
        // Browser/WebView may block programmatic picker opening; focus remains useful.
      }
    }
  };

  useEffect(() => {
    if (
      selectedStudentRowIndex === null ||
      !pendingStudentDetailsFocusColumnRef.current
    ) {
      return;
    }

    const columnName = pendingStudentDetailsFocusColumnRef.current;
    pendingStudentDetailsFocusColumnRef.current = '';

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() =>
        focusStudentDetailsField(selectedStudentRowIndex, columnName, {
          openPicker: columnName === TURMA_COLUMN,
        }),
      );
    });
  }, [selectedStudentRowIndex, aprendizesSheet]);

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
              ref={(element) => {
                if (selectedStudentRowIndex !== null) {
                  studentDetailsInputRefs.current[
                    `${selectedStudentRowIndex}-${columnName}`
                  ] = element;
                }
              }}
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
              ref={(element) => {
                if (selectedStudentRowIndex !== null) {
                  studentDetailsInputRefs.current[
                    `${selectedStudentRowIndex}-${columnName}`
                  ] = element;
                }
              }}
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
    latestTurmasSheetRef.current = null;
    setTurmasSheet(null);
    setWorkbookOptions(emptyWorkbookOptions());
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

  const clearImportMessages = () => {
    setImportError('');
    setInvalidImportToast('');

    if (invalidImportToastTimerRef.current !== null) {
      window.clearTimeout(invalidImportToastTimerRef.current);
      invalidImportToastTimerRef.current = null;
    }
  };

  const fetchRecoveryInfo = async () => {
    try {
      const info = await fetchWorkspaceRecoveryInfo();
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
        await persistTurmasDataIndex(turmasSheet, nextStudentsByClass);
      }

      const response = await fetch('/api/turmas/export', {
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
        return;
      }

      setImportError('');
    } catch {
      setImportError('Não foi possível exportar a planilha.');
    }
  };

  const recoverGlobalData = async (checkpointId?: unknown) => {
    const result = await recoverWorkspaceGlobalData(checkpointId);
    const nextAprendizesSheet = await loadAprendizesProviderFile();
    await loadProviderFile(nextAprendizesSheet);
    await fetchRecoveryInfo();
    window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
    setImportError('');
    return result;
  };

  const recoverBackup = async (checkpointId?: string | null) => {
    if (!recoveryInfo?.canRecover || isRecoveringBackup) {
      return;
    }

    setIsRecoveringBackup(true);

    try {
      const result = await recoverGlobalData(checkpointId);
      if (result.checkpointId) {
        pushGlobalUndoEntry({
          originTab: 'turmas',
          kind: 'global-recovery',
          checkpointId: result.checkpointId,
          restoredCheckpointId: checkpointId,
        });
      }
      setIsRecoveryDialogOpen(false);
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

      latestAprendizesSheetRef.current = fallbackSheet;
      setAprendizesSheet(fallbackSheet);
      return fallbackSheet;
    } catch {
      return null;
    }
  };

  const applyAprendizesFile = async (file: File) => {
    const parsedSheet = await readSheetFile(
      file,
      APRENDIZES_ENTITY_ID,
      APRENDIZES_REQUIRED_COLUMNS,
      {
        preferredSheetName: APRENDIZES_WORKBOOK_SHEET,
        removedColumns: REMOVED_APRENDIZES_COLUMNS,
      },
    );
    const nextSheet = {
      ...parsedSheet,
      fileName: file.name,
    };

    latestAprendizesSheetRef.current = nextSheet;
    setAprendizesSheet(nextSheet);
    await persistAprendizesDataIndex(nextSheet);
    if (nextSheet.hasGeneratedRecordIds) {
      void writeWorkbookSystemMetadataToSourceFile(
        {
          ...nextSheet,
          hasGeneratedRecordIds: false,
        },
        '/api/aprendizes/file/system',
        [AGE_COLUMN],
      );
    }

    return nextSheet;
  };

  const applyTurmasFile = async (
    file: File,
    currentAprendizesSheet: SheetTable | null,
  ) => {
    const [parsedSheet, nextWorkbookOptions] = await Promise.all([
      readSheetFile(file, TURMAS_ENTITY_ID, TURMAS_REQUIRED_COLUMNS, {
        preferredSheetName: TURMAS_WORKBOOK_SHEET,
      }),
      readWorkbookOptions(file),
    ]);
    const nextSheet = {
      ...parsedSheet,
      fileName: file.name,
    };
    const nextTurmaNames = getUniqueValues(
      nextSheet.rows.map((row) => getCellValue(nextSheet, row, TURMA_COLUMN)),
    );
    const nextStudentsByClass = currentAprendizesSheet
      ? buildStudentsByClass(currentAprendizesSheet, nextTurmaNames)
      : undefined;

    latestTurmasSheetRef.current = nextSheet;
    setTurmasSheet(nextSheet);
    setWorkbookOptions(nextWorkbookOptions);
    setImportError('');
    await persistTurmasDataIndex(nextSheet, nextStudentsByClass);
    if (nextSheet.hasGeneratedRecordIds) {
      void writeWorkbookSystemMetadataToSourceFile(
        {
          ...nextSheet,
          hasGeneratedRecordIds: false,
        },
        '/api/turmas/file/system',
      );
    }
    await fetchRecoveryInfo();
    return nextSheet;
  };

  const loadAprendizesProviderFile = async () => {
    try {
      let response = await fetch('/api/base-workbook/file', {
        cache: 'no-store',
      });

      if (response.status === 404) {
        response = await fetch('/api/aprendizes/file', {
          cache: 'no-store',
        });
      }

      if (response.status === 404) {
        const fallbackSheet = await loadAprendizesDataIndexFallback();

        if (fallbackSheet) {
          return fallbackSheet;
        }

        latestAprendizesSheetRef.current = null;
        setAprendizesSheet(null);
        await persistAprendizesDataIndex(null);
        return null;
      }

      if (!response.ok) {
        throw new Error('read-failed');
      }

      const file = await responseToWorkbookFile(response, 'DadosElevar.xlsx');
      return await applyAprendizesFile(file);
    } catch {
      const fallbackSheet = await loadAprendizesDataIndexFallback();

      if (fallbackSheet) {
        return fallbackSheet;
      }

      latestAprendizesSheetRef.current = null;
      setAprendizesSheet(null);
      return null;
    }
  };

  const loadProviderFile = async (currentAprendizesSheet: SheetTable | null) => {
    try {
      let response = await fetch('/api/base-workbook/file', {
        cache: 'no-store',
      });

      if (response.status === 404) {
        response = await fetch('/api/turmas/file', {
          cache: 'no-store',
        });
      }

      if (response.status === 404) {
        clearWorkingSheet();
        await persistTurmasDataIndex(null);
        return null;
      }

      if (!response.ok) {
        throw new Error('read-failed');
      }

      const file = await responseToWorkbookFile(response, 'DadosElevar.xlsx');
      return await applyTurmasFile(file, currentAprendizesSheet);
    } catch (error) {
      clearWorkingSheet();

      if (error instanceof MissingRequiredColumnsError) {
        setImportError('');
        return null;
      }

      setImportError('Não foi possível ler a planilha de turmas.');
    }
  };

  const syncProviderWorkbooks = async (changedFile?: File | null) => {
    setIsWorkspaceSyncing(true);
    clearImportMessages();

    try {
      if (changedFile) {
        const nextAprendizesSheet = await applyAprendizesFile(changedFile);
        await applyTurmasFile(changedFile, nextAprendizesSheet);
        return;
      }

      const nextAprendizesSheet = await loadAprendizesProviderFile();
      await loadProviderFile(nextAprendizesSheet);
    } finally {
      setIsWorkspaceSyncing(false);
    }
  };

  useEffect(() => {
    if (!canInitialize || didInitializeWorkspaceRef.current) {
      return;
    }

    didInitializeWorkspaceRef.current = true;
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
  }, [canInitialize]);

  useEffect(() => {
    if (turmasSheet) {
      void persistTurmasDataIndex(turmasSheet, studentsByClass);
    }
  }, [turmasSheet, studentsByClass]);

  useEffect(() => {
    if (!isActive || !hasCheckedWorkspace || isGlobalUndoInProgress()) {
      return;
    }

    setAprendizesViewSettings(readAprendizesViewSettings());
    if (!aprendizesSheet) {
      void (async () => {
        await commitActiveStudentEditForUndo();
        await loadAprendizesProviderFile();
      })();
    }
  }, [aprendizesSheet, isActive, hasCheckedWorkspace]);

  useEffect(() => {
    if (!isActive || !hasCheckedWorkspace || isGlobalUndoInProgress()) {
      return;
    }

    void syncProviderWorkbooks();
  }, [isActive, hasCheckedWorkspace]);

  useEffect(() => {
    const syncAprendizesData = () => {
      if (suppressNextAprendizesChangeEventRef.current) {
        suppressNextAprendizesChangeEventRef.current = false;
        return;
      }

      if (isApplyingUndoRef.current || isGlobalUndoInProgress()) {
        return;
      }

      void loadAprendizesProviderFile();
    };

    window.addEventListener(APRENDIZES_DATA_CHANGED_EVENT, syncAprendizesData);

    return () => {
      window.removeEventListener(APRENDIZES_DATA_CHANGED_EVENT, syncAprendizesData);
    };
  }, []);

  useEffect(() => {
    const syncGlobalData = (event: Event) => {
      const isForcedGlobalDataChange =
        event instanceof CustomEvent && event.detail?.force === true;

      if (suppressNextGlobalDataChangeEventRef.current) {
        suppressNextGlobalDataChangeEventRef.current = false;

        if (!isForcedGlobalDataChange) {
          return;
        }
      }

      if (
        (isApplyingUndoRef.current || isGlobalUndoInProgress()) &&
        !isForcedGlobalDataChange
      ) {
        return;
      }

      const changedFile =
        event instanceof CustomEvent && event.detail?.file instanceof File
          ? event.detail.file
          : null;

      void (async () => {
        await commitActiveStudentEditForUndo();
        await syncProviderWorkbooks(changedFile);
      })();
    };

    window.addEventListener(GLOBAL_DATA_CHANGED_EVENT, syncGlobalData);

    return () => {
      window.removeEventListener(GLOBAL_DATA_CHANGED_EVENT, syncGlobalData);
    };
  }, []);

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
    const frame = boardFrameRef.current;
    let animationFrameId: number | null = null;

    const scheduleSharedScrollWidthUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updateSharedHorizontalScrollWidth();
      });
    };

    window.addEventListener('resize', scheduleSharedScrollWidthUpdate);

    let observer: ResizeObserver | null = null;

    if (frame && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleSharedScrollWidthUpdate);
      observer.observe(frame);
    }

    scheduleSharedScrollWidthUpdate();

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      observer?.disconnect();
      window.removeEventListener('resize', scheduleSharedScrollWidthUpdate);
    };
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
        top: Math.round(maximumBottom - height + TURMAS_ROW_DETAILS_VERTICAL_OFFSET),
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
      const previousUndoStack = getGlobalUndoBoundarySnapshot();
      const shouldImportBaseWorkbook = await isUnifiedWorkbookFile(file);
      const parsedSheet = await readSheetFile(
        file,
        TURMAS_ENTITY_ID,
        TURMAS_REQUIRED_COLUMNS,
        {
          preferredSheetName: TURMAS_WORKBOOK_SHEET,
        },
      );
      const response = await fetch(
        shouldImportBaseWorkbook ? '/api/base-workbook/import' : '/api/turmas/import',
        {
          method: 'POST',
          headers: {
            'content-type':
              file.type ||
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'x-file-name': encodeURIComponent(file.name),
          },
          body: await file.arrayBuffer(),
        },
      );

      if (!response.ok) {
        throw new Error('import-failed');
      }

      const result = (await response.json()) as {
        fileName?: string;
        globalCheckpointId?: string | null;
      };
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

      latestTurmasSheetRef.current = nextSheet;
      setTurmasSheet(nextSheet);
      setImportError('');
      await persistTurmasDataIndex(nextSheet, nextStudentsByClass);
      if (nextSheet.hasGeneratedRecordIds) {
        void writeWorkbookSystemMetadataToSourceFile(
          {
            ...nextSheet,
            hasGeneratedRecordIds: false,
          },
          '/api/turmas/file/system',
        );
      }
      const nextRecoveryInfo = await fetchRecoveryInfo();
      if (nextRecoveryInfo?.canRecover) {
        pushGlobalBoundaryUndoEntry(
          {
            originTab: 'turmas',
            kind: 'global-import',
            checkpointId: result.globalCheckpointId,
            fileName: storedFileName,
          },
          previousUndoStack,
        );
      }
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
    window.dispatchEvent(
      new CustomEvent(GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT, {
        detail: event.dataTransfer.files?.[0],
      }),
    );
  };

  const toggleTurma = (turmaKey: string) => {
    setExpandedTurmas((currentExpandedTurmas) => ({
      ...currentExpandedTurmas,
      [turmaKey]: !currentExpandedTurmas[turmaKey],
    }));
  };

  const getTurmaKeyByName = (rawTurmaName: unknown) => {
    const turmaName = String(rawTurmaName ?? '').trim();

    if (!turmasSheet || !turmaName) {
      return '';
    }

    const canonicalTurmaName =
      getCanonicalDropdownValue(turmaName, turmaNames) ?? turmaName;

    for (let rowIndex = 0; rowIndex < turmasSheet.rows.length; rowIndex += 1) {
      const rowTurmaName =
        getCellValue(turmasSheet, turmasSheet.rows[rowIndex], TURMA_COLUMN) ||
        `Turma ${rowIndex + 1}`;
      const canonicalRowTurmaName =
        getCanonicalDropdownValue(rowTurmaName, turmaNames) ?? rowTurmaName;

      if (canonicalRowTurmaName === canonicalTurmaName) {
        return `${rowTurmaName}-${rowIndex}`;
      }
    }

    return '';
  };

  const expandTurmaByName = (rawTurmaName: unknown) => {
    const turmaKey = getTurmaKeyByName(rawTurmaName);

    if (!turmaKey) {
      return;
    }

    setExpandedTurmas((currentExpandedTurmas) =>
      currentExpandedTurmas[turmaKey]
        ? currentExpandedTurmas
        : {
            ...currentExpandedTurmas,
            [turmaKey]: true,
          },
    );
  };

  const expandTurmasForUndoEntry = (entry: TableUndoEntry) => {
    if (entry.kind === 'cell-edit') {
      if (normalizeFieldLabel(entry.columnName) !== normalizeFieldLabel(TURMA_COLUMN)) {
        return;
      }

      expandTurmaByName(entry.previousValue);
      expandTurmaByName(entry.nextValue);
      return;
    }

    const turmaColumnIndex = getColumnIndex(aprendizesSheet, TURMA_COLUMN);

    if (turmaColumnIndex >= 0) {
      expandTurmaByName(entry.rowValues[turmaColumnIndex]);
    }
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

  const writeWorkbookSystemMetadataToSourceFile = async (
    sheet: SheetTable,
    endpoint: string,
    formulaColumns: string[] = [],
  ) => {
    try {
      const { read, utils, write } = await loadXlsx();
      let saveEndpoint = '/api/base-workbook/file/system';
      let sourceResponse = await fetch('/api/base-workbook/file', {
        cache: 'no-store',
      });

      if (sourceResponse.status === 404) {
        saveEndpoint = endpoint;
        sourceResponse = await fetch(endpoint.replace('/system', ''), {
          cache: 'no-store',
        });
      }

      if (!sourceResponse.ok) {
        return;
      }

      const workbook = read(await sourceResponse.arrayBuffer(), {
        cellDates: true,
      });
      const sheetName =
        sheet.sheetName || workbook.SheetNames[0] || 'Planilha';
      const safeSheetName = sheetName.slice(0, 31);
      const previousWorksheet = workbook.Sheets[safeSheetName];
      const nextWorksheet = utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);

      preserveColumnFormulas(
        utils,
        previousWorksheet,
        nextWorksheet,
        sheet,
        formulaColumns,
      );
      workbook.Sheets[safeSheetName] = nextWorksheet;

      if (!workbook.SheetNames.includes(safeSheetName)) {
        workbook.SheetNames.push(safeSheetName);
      }

      const output = write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      }) as ArrayBuffer;

      await fetch(saveEndpoint, {
        method: 'PUT',
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: output,
      });
    } catch {
      // Internal ID seeding is repaired on the next successful save/load.
    }
  };

  const writeTurmasSheetToSourceFile = async (
    sheet: SheetTable,
    nextStudentsByClass?: Map<string, string[]>,
  ) => {
    try {
      const { sheet: sheetWithIds } = ensureSheetRecordIds(
        sheet,
        TURMAS_ENTITY_ID,
      );
      const saveResponse = await fetch('/api/turmas/values', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sheetName: sheetWithIds.sheetName,
          columns: sheetWithIds.columns,
          rows: sheetWithIds.rows,
        }),
      });

      if (!saveResponse.ok) {
        throw new Error('save-failed');
      }

      const result = (await saveResponse.json()) as { fileName?: string };
      const savedSheet = {
        ...sheetWithIds,
        fileName: result.fileName || sheetWithIds.fileName,
      };

      latestTurmasSheetRef.current = savedSheet;
      setTurmasSheet(savedSheet);
      await persistTurmasDataIndex(savedSheet, nextStudentsByClass);
      await fetchRecoveryInfo();
      suppressNextGlobalDataChangeEventRef.current = true;
      window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
      window.dispatchEvent(new Event(GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT));
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
    const currentTurmasSheet = latestTurmasSheetRef.current;

    if (!currentTurmasSheet) {
      return;
    }

    const nextStudentsByClass = buildStudentsByClass(sheet, turmaNames);
    await persistTurmasDataIndex(currentTurmasSheet, nextStudentsByClass);
  };

  const performAprendizesSheetSourceWrite = async (
    sheet: SheetTable,
    options: SaveAprendizesOptions = {},
  ) => {
    try {
      const { sheet: sheetWithIds } = ensureSheetRecordIds(
        sheet,
        APRENDIZES_ENTITY_ID,
      );
      const patchColumns = Array.from(
        new Set(
          (options.patchColumns ?? []).filter((columnName) =>
            sheetWithIds.columns.includes(columnName),
          ),
        ),
      );
      const columnsToSave =
        patchColumns.length > 0 ? patchColumns : sheetWithIds.columns;
      const rowsToSave =
        patchColumns.length > 0
          ? sheetWithIds.rows.map((row) =>
              columnsToSave.map((columnName) => {
                const columnIndex = sheetWithIds.columns.indexOf(columnName);
                return columnIndex >= 0 ? row[columnIndex] ?? '' : '';
              }),
            )
          : sheetWithIds.rows;
      const saveResponse = await fetch('/api/aprendizes/values', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sheetName: sheetWithIds.sheetName,
          columns: columnsToSave,
          rows: rowsToSave,
          formulaColumns: [AGE_COLUMN],
          patchColumnsOnly: patchColumns.length > 0,
        }),
      });

      if (!saveResponse.ok) {
        throw new Error('save-failed');
      }

      const result = (await saveResponse.json()) as { fileName?: string };
      const savedSheet = {
        ...sheetWithIds,
        fileName: result.fileName || sheetWithIds.fileName,
      };

      if (options.applyLocalState !== false) {
        latestAprendizesSheetRef.current = savedSheet;
        setAprendizesSheet(savedSheet);
      }
      await persistAprendizesDataIndex(savedSheet);
      if (options.syncTurmas !== false) {
        await syncTurmasWorkbookFromAprendizes(savedSheet);
      }
      suppressNextAprendizesChangeEventRef.current = true;
      suppressNextGlobalDataChangeEventRef.current = true;
      window.dispatchEvent(new Event(APRENDIZES_DATA_CHANGED_EVENT));
      window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
      window.dispatchEvent(new Event(GLOBAL_TOOLBAR_REFRESH_REQUEST_EVENT));
      setImportError('');
      return savedSheet;
    } catch {
      setImportError(
        'A alteração ficou na tela, mas não foi possível gravar em dados.',
      );
    }
  };

  const writeAprendizesSheetToSourceFile = (
    sheet: SheetTable,
    options: SaveAprendizesOptions = {},
  ) => {
    const queuedWrite = sourceWriteQueueRef.current
      .catch(() => {
        // The write path owns its visible error state.
      })
      .then(() => performAprendizesSheetSourceWrite(sheet, options));

    sourceWriteQueueRef.current = queuedWrite.catch(() => {
      // Keep the queue alive after a failed write.
    });

    return queuedWrite;
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

    latestAprendizesSheetRef.current = canonicalSheet;
    setAprendizesSheet(canonicalSheet);
    void writeAprendizesSheetToSourceFile(canonicalSheet, {
      patchColumns: [TURMA_COLUMN],
    });
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
    latestAprendizesSheetRef.current = nextSheet;
    setAprendizesSheet(nextSheet);
    void writeAprendizesSheetToSourceFile(nextSheet, {
      patchColumns: [TURMA_COLUMN],
    });
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

  const getTurmaDropdownOptions = (field: ActiveTurmaDropdown['field']) => {
    if (field === 'day') {
      return TURMA_DAY_OPTIONS;
    }

    if (field === 'period') {
      return periodOptions;
    }

    if (field === 'instructor') {
      return instructorOptions;
    }

    return roomOptions;
  };

  const getTurmaDropdownColumn = (field: ActiveTurmaDropdown['field']) => {
    if (field === 'day') {
      return TURMA_DAY_COLUMN;
    }

    if (field === 'period') {
      return TURMA_PERIOD_COLUMN;
    }

    if (field === 'instructor') {
      return TURMA_INSTRUCTOR_COLUMN;
    }

    return TURMA_ROOM_COLUMN;
  };

  const getWorkbookOptionTypeForTurmaDropdown = (
    field: ActiveTurmaDropdown['field'],
  ): WorkbookOptionType | null => {
    if (field === 'period') {
      return 'periodo';
    }

    if (field === 'instructor') {
      return 'instrutor';
    }

    if (field === 'room') {
      return 'sala';
    }

    return null;
  };

  const rememberWorkbookOption = async (
    field: ActiveTurmaDropdown['field'],
    value: string,
  ) => {
    const type = getWorkbookOptionTypeForTurmaDropdown(field);
    const normalizedValue = value.trim();

    if (!type || !normalizedValue) {
      return;
    }

    setWorkbookOptions((currentOptions) => ({
      ...currentOptions,
      [type]: mergeWorkbookOptionValues(currentOptions[type], [normalizedValue]),
    }));

    try {
      await persistWorkbookOption(type, normalizedValue);
    } catch {
      // The Turma field save is the source of truth. Option persistence can be
      // retried by creating/keeping the value in the workbook later.
    }
  };

  const openTurmaDropdown = (
    rowIndex: TurmaRowRef,
    field: ActiveTurmaDropdown['field'],
    anchorElement: HTMLElement,
  ) => {
    const columnName = getTurmaDropdownColumn(field);
    const currentSheet = latestTurmasSheetRef.current;
    const currentValue =
      rowIndex === 'draft'
        ? turmaDraft?.values[columnName] ?? ''
        : currentSheet?.rows[rowIndex] && currentSheet
        ? getCellValue(currentSheet, currentSheet.rows[rowIndex], columnName)
        : '';
    const anchorRect = anchorElement.getBoundingClientRect();
    const frameBottom =
      boardFrameRef.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    const maxDropdownHeight = Math.max(
      120,
      Math.round(frameBottom - anchorRect.bottom - 12),
    );

    const nextDropdown: ActiveTurmaDropdown = {
      rowIndex,
      field,
      columnName,
      draftValue: field === 'period' ? getPeriodDigits(currentValue) : currentValue,
      style: {
        left: Math.round(anchorRect.left),
        top: Math.round(anchorRect.bottom + 4),
        width: Math.round(anchorRect.width),
        maxHeight: maxDropdownHeight,
      },
    };

    activeTurmaDropdownRef.current = nextDropdown;
    setActiveTurmaDropdown(nextDropdown);
  };

  const selectTurmaDropdownValue = async (
    dropdown: ActiveTurmaDropdown,
    value: string,
  ) => {
    activeTurmaDropdownRef.current = null;
    setActiveTurmaDropdown(null);

    if (dropdown.rowIndex === 'draft') {
      updateTurmaDraftField(dropdown.columnName, value);
      return;
    }

    const didCommit = await commitTurmaHeaderField(
      dropdown.rowIndex,
      dropdown.columnName,
      value,
    );

    if (didCommit) {
      await rememberWorkbookOption(dropdown.field, value);
    }
  };

  const commitTurmaDropdownDraft = async () => {
    const dropdown = activeTurmaDropdownRef.current;

    if (!dropdown) {
      return;
    }

    const nextValue =
      dropdown.field === 'period'
        ? getCommittedPeriodFromDigits(dropdown.draftValue)
        : dropdown.draftValue.trim();

    activeTurmaDropdownRef.current = null;
    setActiveTurmaDropdown(null);

    if (!nextValue) {
      return;
    }

    if (dropdown.rowIndex === 'draft') {
      updateTurmaDraftField(dropdown.columnName, nextValue);
      return;
    }

    const didCommit = await commitTurmaHeaderField(
      dropdown.rowIndex,
      dropdown.columnName,
      nextValue,
    );

    if (didCommit) {
      await rememberWorkbookOption(dropdown.field, nextValue);
    }
  };

  const updateTurmaDropdownDraft = (value: string) => {
    const nextDraftValue =
      activeTurmaDropdownRef.current?.field === 'period'
        ? getPeriodDigits(value)
        : value;

    setActiveTurmaDropdown((currentDropdown) => {
      if (!currentDropdown) {
        return currentDropdown;
      }

      return {
        ...currentDropdown,
        draftValue:
          currentDropdown.field === 'period'
            ? getPeriodDigits(value)
            : nextDraftValue,
      };
    });
    activeTurmaDropdownRef.current = activeTurmaDropdownRef.current
      ? {
          ...activeTurmaDropdownRef.current,
          draftValue: nextDraftValue,
        }
      : null;

    if (activeTurmaDropdownRef.current?.field === 'period') {
      const cursorPosition = getPeriodCursorPosition(nextDraftValue.length);
      window.requestAnimationFrame(() => {
        turmaPeriodInputRef.current?.setSelectionRange(
          cursorPosition,
          cursorPosition,
        );
      });
    }
  };

  const startTurmaNameEdit = (rowIndex: TurmaRowRef, value: string) => {
    void commitActiveTurmaNameEdit();
    activeTurmaDropdownRef.current = null;
    setActiveTurmaDropdown(null);
    setActiveTurmaNameEdit({
      rowIndex,
      initialValue: value,
      draftValue: value,
    });
  };

  const handleTurmaNameKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitActiveTurmaNameEdit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      activeTurmaNameEditRef.current = null;
      setActiveTurmaNameEdit(null);
    }
  };

  const handleTurmaDropdownKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    const dropdown = activeTurmaDropdownRef.current;

    if (dropdown?.field === 'period') {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();

        if (dropdown.draftValue.length < 8) {
          updateTurmaDropdownDraft(dropdown.draftValue + event.key);
        }

        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        updateTurmaDropdownDraft(dropdown.draftValue.slice(0, -1));
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void commitTurmaDropdownDraft();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      activeTurmaDropdownRef.current = null;
      setActiveTurmaDropdown(null);
    }
  };

  const handleTurmaPeriodPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const dropdown = activeTurmaDropdownRef.current;

    if (dropdown?.field !== 'period') {
      return;
    }

    event.preventDefault();
    updateTurmaDropdownDraft(
      (dropdown.draftValue + getPeriodDigits(event.clipboardData.getData('text'))).slice(
        0,
        8,
      ),
    );
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

  const isTableUndoEntry = (
    entry: GlobalUndoEntry | TableUndoEntry | undefined,
  ): entry is TableUndoEntry => {
    if (!entry) {
      return false;
    }

    if (entry.kind === 'row-delete') {
      return (
        typeof entry.rowIndex === 'number' && Array.isArray(entry.rowValues)
      );
    }

    return (
      entry.kind === 'cell-edit' &&
      typeof entry.rowIndex === 'number' &&
      typeof entry.columnName === 'string' &&
      typeof entry.previousValue === 'string' &&
      typeof entry.nextValue === 'string'
    );
  };

  const tableUndoEntriesMatch = (
    leftEntry: TableUndoEntry,
    rightEntry: TableUndoEntry,
  ) => {
    if (
      leftEntry.kind !== rightEntry.kind ||
      leftEntry.rowIndex !== rightEntry.rowIndex
    ) {
      return false;
    }

    if (leftEntry.kind === 'row-delete' && rightEntry.kind === 'row-delete') {
      return leftEntry.rowValues.join('\u0000') === rightEntry.rowValues.join('\u0000');
    }

    if (leftEntry.kind === 'cell-edit' && rightEntry.kind === 'cell-edit') {
      return (
        leftEntry.columnName === rightEntry.columnName &&
        leftEntry.previousValue === rightEntry.previousValue &&
        leftEntry.nextValue === rightEntry.nextValue
      );
    }

    return false;
  };

  const takeUndoEntry = (requestedEntry?: GlobalUndoEntry) => {
    if (!requestedEntry) {
      const undoEntry = undoStackRef.current.at(-1);
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      return undoEntry;
    }

    if (!isTableUndoEntry(requestedEntry)) {
      return null;
    }

    const undoEntry = requestedEntry;
    let matchingIndex = -1;

    for (
      let index = undoStackRef.current.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (tableUndoEntriesMatch(undoStackRef.current[index], undoEntry)) {
        matchingIndex = index;
        break;
      }
    }

    if (matchingIndex >= 0) {
      undoStackRef.current = undoStackRef.current.filter(
        (_entry, index) => index !== matchingIndex,
      );
    }

    return undoEntry;
  };

  const undoLastAction = (requestedEntry?: GlobalUndoEntry) => {
    protectUndoCommit();

    const undoEntry = takeUndoEntry(requestedEntry);
    const selectedRowBeforeUndo = selectedStudentRowIndex;
    const currentSheet = latestAprendizesSheetRef.current;

    if (!undoEntry || !currentSheet) {
      return null;
    }

    expandTurmasForUndoEntry(undoEntry);

    if (undoEntry.kind === 'row-delete') {
      const nextRows = [...currentSheet.rows];
      nextRows.splice(undoEntry.rowIndex, 0, undoEntry.rowValues);
      const nextSheet = {
        ...currentSheet,
        rows: nextRows,
      };

      latestAprendizesSheetRef.current = nextSheet;
      setAprendizesSheet(nextSheet);
      if (selectedRowBeforeUndo !== null) {
        setSelectedStudentRowIndex(
          selectedRowBeforeUndo >= undoEntry.rowIndex
            ? selectedRowBeforeUndo + 1
            : selectedRowBeforeUndo,
        );
      }
      return nextSheet;
    }

    const columnIndex = getColumnIndex(currentSheet, undoEntry.columnName);

    if (columnIndex < 0 || !currentSheet.rows[undoEntry.rowIndex]) {
      return null;
    }

    const nextRows = currentSheet.rows.map((row, rowIndex) => {
      if (rowIndex !== undoEntry.rowIndex) {
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

    latestAprendizesSheetRef.current = nextSheet;
    setAprendizesSheet(nextSheet);
    return nextSheet;
  };

  const undoLastActionAndSave = async (entry?: GlobalUndoEntry) => {
    const nextSheet = undoLastAction(entry);
    const patchColumns =
      entry && isTableUndoEntry(entry) && entry.kind === 'cell-edit'
        ? [entry.columnName]
        : undefined;

    if (nextSheet) {
      await writeAprendizesSheetToSourceFile(nextSheet, {
        applyLocalState: false,
        patchColumns,
      });
    }

    return Boolean(nextSheet);
  };

  const redoLastActionAndSave = async (entry: GlobalUndoEntry) => {
    const currentSheet = latestAprendizesSheetRef.current;

    if (!isTableUndoEntry(entry) || !currentSheet) {
      return false;
    }

    protectUndoCommit();
    activeStudentEditRef.current = null;
    expandTurmasForUndoEntry(entry);

    if (entry.kind === 'row-delete') {
      if (!currentSheet.rows[entry.rowIndex]) {
        return false;
      }
      const selectedRowBeforeRedo = selectedStudentRowIndex;

      const nextSheet = {
        ...currentSheet,
        rows: currentSheet.rows.filter(
          (_row, currentRowIndex) => currentRowIndex !== entry.rowIndex,
        ),
      };

      latestAprendizesSheetRef.current = nextSheet;
      setAprendizesSheet(nextSheet);
      if (selectedRowBeforeRedo === entry.rowIndex) {
        setSelectedStudentRowIndex(null);
        applyRowDetailsPanelStyle({});
      } else if (selectedRowBeforeRedo !== null) {
        setSelectedStudentRowIndex(
          selectedRowBeforeRedo > entry.rowIndex
            ? selectedRowBeforeRedo - 1
            : selectedRowBeforeRedo,
        );
      }
      await writeAprendizesSheetToSourceFile(nextSheet, {
        applyLocalState: false,
      });
      return true;
    }

    const columnIndex = getColumnIndex(currentSheet, entry.columnName);

    if (columnIndex < 0 || !currentSheet.rows[entry.rowIndex]) {
      return false;
    }

    const nextRows = currentSheet.rows.map((row, rowIndex) => {
      if (rowIndex !== entry.rowIndex) {
        return row;
      }

      const nextRow = [...row];
      nextRow[columnIndex] = entry.nextValue;
      return nextRow;
    });
    const nextSheet = {
      ...currentSheet,
      rows: nextRows,
    };

    latestAprendizesSheetRef.current = nextSheet;
    setAprendizesSheet(nextSheet);
    await writeAprendizesSheetToSourceFile(nextSheet, {
      applyLocalState: false,
      patchColumns: [entry.columnName],
    });
    return true;
  };

  const undoTurmaRowActionAndSave = async (entry: GlobalUndoEntry) => {
    if (!isTurmaRowUndoEntry(entry)) {
      return false;
    }

    if (entry.kind === 'row-insert') {
      const currentTurmasSheet = latestTurmasSheetRef.current;

      if (!currentTurmasSheet) {
        return false;
      }

      const nextTurmasSheet = {
        ...currentTurmasSheet,
        rows: currentTurmasSheet.rows.filter(
          (_row, currentRowIndex) => currentRowIndex !== entry.rowIndex,
        ),
      };
      const nextTurmaNames = getUniqueValues(
        nextTurmasSheet.rows.map((row) =>
          getCellValue(nextTurmasSheet, row, TURMA_COLUMN),
        ),
      );
      const nextStudentsByClass = latestAprendizesSheetRef.current
        ? buildStudentsByClass(latestAprendizesSheetRef.current, nextTurmaNames)
        : undefined;

      latestTurmasSheetRef.current = nextTurmasSheet;
      setTurmasSheet(nextTurmasSheet);
      await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);
      return true;
    }

    const currentTurmasSheet = latestTurmasSheetRef.current;

    if (!currentTurmasSheet) {
      return false;
    }

    const nextRows = [...currentTurmasSheet.rows];
    nextRows.splice(entry.rowIndex, 0, entry.rowValues);
    const nextTurmasSheet = {
      ...currentTurmasSheet,
      rows: nextRows,
    };
    const restoredAprendizesSheet = getAprendizesSheetWithRestoredTurmas(
      latestAprendizesSheetRef.current,
      entry.clearedAprendizTurmas,
    );
    const nextAprendizesSheet =
      restoredAprendizesSheet ?? latestAprendizesSheetRef.current;
    const nextTurmaNames = getUniqueValues(
      nextTurmasSheet.rows.map((row) =>
        getCellValue(nextTurmasSheet, row, TURMA_COLUMN),
      ),
    );
    const nextStudentsByClass = nextAprendizesSheet
      ? buildStudentsByClass(nextAprendizesSheet, nextTurmaNames)
      : undefined;

    latestTurmasSheetRef.current = nextTurmasSheet;
    setTurmasSheet(nextTurmasSheet);

    if (restoredAprendizesSheet) {
      latestAprendizesSheetRef.current = restoredAprendizesSheet;
      setAprendizesSheet(restoredAprendizesSheet);
    }

    await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);

    if (restoredAprendizesSheet) {
      await writeAprendizesSheetToSourceFile(restoredAprendizesSheet, {
        patchColumns: [TURMA_COLUMN],
        syncTurmas: false,
      });
    }

    return true;
  };

  const redoTurmaRowActionAndSave = async (entry: GlobalUndoEntry) => {
    if (!isTurmaRowUndoEntry(entry)) {
      return false;
    }

    if (entry.kind === 'row-insert') {
      const currentTurmasSheet = latestTurmasSheetRef.current;

      if (!currentTurmasSheet) {
        return false;
      }

      const nextRows = [...currentTurmasSheet.rows];
      nextRows.splice(entry.rowIndex, 0, entry.rowValues);
      const nextTurmasSheet = {
        ...currentTurmasSheet,
        rows: nextRows,
      };
      const nextTurmaNames = getUniqueValues(
        nextTurmasSheet.rows.map((row) =>
          getCellValue(nextTurmasSheet, row, TURMA_COLUMN),
        ),
      );
      const nextStudentsByClass = latestAprendizesSheetRef.current
        ? buildStudentsByClass(latestAprendizesSheetRef.current, nextTurmaNames)
        : undefined;

      latestTurmasSheetRef.current = nextTurmasSheet;
      setTurmasSheet(nextTurmasSheet);
      await writeTurmasSheetToSourceFile(nextTurmasSheet, nextStudentsByClass);
      return true;
    }

    return deleteTurmaRowAndSave(entry.rowIndex, { trackUndo: false });
  };

  const restoreUndoStackFromBoundary = (entry: GlobalUndoEntry) => {
    replaceGlobalUndoStack(
      Array.isArray(entry.previousUndoStack)
        ? (entry.previousUndoStack as GlobalUndoEntry[])
        : [],
    );
  };

  const undoGlobalBoundaryAction = async (entry: GlobalUndoEntry) => {
    try {
      const result = await recoverGlobalData(entry.checkpointId);
      entry.redoCheckpointId = result.checkpointId;
      restoreUndoStackFromBoundary(entry);
      return true;
    } catch {
      setImportError('Não foi possível desfazer a importação.');
      return false;
    }
  };

  const redoGlobalBoundaryAction = async (entry: GlobalUndoEntry) => {
    try {
      const result = await recoverGlobalData(entry.redoCheckpointId);
      entry.checkpointId = result.checkpointId;
      return true;
    } catch {
      setImportError('Não foi possível refazer a importação.');
      return false;
    }
  };

  const undoGlobalRecoveryAction = async (entry: GlobalUndoEntry) => {
    try {
      const result = await recoverGlobalData(entry.checkpointId);
      entry.redoCheckpointId = result.checkpointId;
      remapGlobalUndoCheckpointReferences(
        entry.restoredCheckpointId,
        result.checkpointId,
      );
      entry.restoredCheckpointId = result.checkpointId;
      return true;
    } catch {
      setImportError('N\u00e3o foi poss\u00edvel desfazer a recupera\u00e7\u00e3o.');
      return false;
    }
  };

  const redoGlobalRecoveryAction = async (entry: GlobalUndoEntry) => {
    try {
      const result = await recoverGlobalData(entry.redoCheckpointId);
      entry.checkpointId = result.checkpointId;
      return true;
    } catch {
      setImportError('N\u00e3o foi poss\u00edvel refazer a recupera\u00e7\u00e3o.');
      return false;
    }
  };

  const undoTurmaHeaderEditAndSave = async (entry: GlobalUndoEntry) => {
    if (!isTurmaFieldUndoEntry(entry)) {
      return false;
    }

    return commitTurmaHeaderField(
      entry.rowIndex,
      entry.columnName,
      entry.previousValue,
      { trackUndo: false },
    );
  };

  const redoTurmaHeaderEditAndSave = async (entry: GlobalUndoEntry) => {
    if (!isTurmaFieldUndoEntry(entry)) {
      return false;
    }

    return commitTurmaHeaderField(
      entry.rowIndex,
      entry.columnName,
      entry.nextValue,
      { trackUndo: false },
    );
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

    if (
      nativeEvent.inputType !== 'historyUndo' &&
      nativeEvent.inputType !== 'historyRedo'
    ) {
      return;
    }

    event.preventDefault();
    void handleGlobalUndoShortcut({
      ctrlKey: true,
      defaultPrevented: false,
      key: nativeEvent.inputType === 'historyRedo' ? 'y' : 'z',
      metaKey: false,
      preventDefault: () => {},
      shiftKey: false,
      stopPropagation: () => {},
    });
  };

  useEffect(
    () =>
      registerGlobalUndoController('turmas', {
        beforeUndo: async () => {
          await commitActiveTurmaNameEdit();
          await commitActiveStudentEditForUndo();
        },
        undo: (entry) => {
          if (entry.kind === 'global-import') {
            return undoGlobalBoundaryAction(entry);
          }

          if (entry.kind === 'global-recovery') {
            return undoGlobalRecoveryAction(entry);
          }

          if (isTurmaFieldUndoEntry(entry)) {
            return undoTurmaHeaderEditAndSave(entry);
          }

          if (isTurmaRowUndoEntry(entry)) {
            return undoTurmaRowActionAndSave(entry);
          }

          return undoLastActionAndSave(entry);
        },
        redo: (entry) => {
          if (entry.kind === 'global-import') {
            return redoGlobalBoundaryAction(entry);
          }

          if (entry.kind === 'global-recovery') {
            return redoGlobalRecoveryAction(entry);
          }

          if (isTurmaFieldUndoEntry(entry)) {
            return redoTurmaHeaderEditAndSave(entry);
          }

          if (isTurmaRowUndoEntry(entry)) {
            return redoTurmaRowActionAndSave(entry);
          }

          return redoLastActionAndSave(entry);
        },
      }),
    [aprendizesSheet, selectedStudentRowIndex, turmasSheet],
  );

  const hasWorkingSheet = Boolean(turmasSheet);
  const shouldShowEmptyImportState =
    !hasWorkingSheet &&
    (globalWorkbookState.hasLoaded
      ? !globalWorkbookState.hasWorkbook
      : hasCheckedWorkspace);
  const canRecoverBackup = Boolean(recoveryInfo?.canRecover);
  const recoveryCheckpoints =
    recoveryInfo?.checkpoints && recoveryInfo.checkpoints.length > 0
      ? recoveryInfo.checkpoints
      : recoveryInfo?.canRecover
        ? [
            {
              checkpointId: recoveryInfo.checkpointId,
              canRecover: recoveryInfo.canRecover,
              label: recoveryInfo.label,
              formattedUpdatedAt: recoveryInfo.formattedUpdatedAt,
              reason: recoveryInfo.reason,
            },
          ]
        : [];
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
              className={
                hasWorkingSheet ? 'square-action' : 'square-action disabled'
              }
              type="button"
              aria-label="Adicionar turma"
              title="Adicionar Turma"
              disabled={!hasWorkingSheet}
              onClick={startTurmaDraft}
            >
              <SquarePlusIcon />
            </button>
            {isActive && <GlobalWorkbookToolbar />}
          </div>
        </div>
      </div>

      {shouldShowEmptyImportState && (
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
            onClick={() =>
              window.dispatchEvent(
                new Event(GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT),
              )
            }
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
              <div className="turmas-board" style={turmaHeaderLayoutStyle}>
                {[
                  ...(turmaDraft
                    ? [
                        {
                          kind: 'draft' as const,
                          row: turmasSheet.columns.map(
                            (columnName) =>
                              getVisibleTurmaDraftValues(turmaDraft)[columnName] ?? '',
                          ),
                          rowIndex: 'draft' as const,
                          key: `draft-${turmaDraft.id}`,
                        },
                      ]
                    : []),
                  ...sortedTurmaRows.map(({ row, rowIndex }) => ({
                    kind: 'real' as const,
                    row,
                    rowIndex,
                    key: getSheetRecordId(turmasSheet, rowIndex, TURMAS_ENTITY_ID),
                  })),
                ].map((displayRow) => {
                  const isDraft = displayRow.kind === 'draft';
                  const turmaRow = displayRow.row;
                  const turmaRowIndex = displayRow.rowIndex;
                  const draftValues =
                    isDraft && turmaDraft
                      ? getVisibleTurmaDraftValues(turmaDraft)
                      : {};
                  const turmaHeader =
                    isDraft
                      ? {
                          name: draftValues[TURMA_COLUMN] || '-',
                          count: '0',
                          day: draftValues[TURMA_DAY_COLUMN]
                            ? formatTurmaDay(draftValues[TURMA_DAY_COLUMN])
                            : '-',
                          isMorning:
                            getTurmaPeriodStartMinutes(
                              draftValues[TURMA_PERIOD_COLUMN] ?? '',
                            ) === null ||
                            (getTurmaPeriodStartMinutes(
                              draftValues[TURMA_PERIOD_COLUMN] ?? '',
                            ) ?? 0) <
                              12 * 60,
                          period: draftValues[TURMA_PERIOD_COLUMN]
                            ? formatTurmaPeriod(draftValues[TURMA_PERIOD_COLUMN])
                            : '-',
                          instructor:
                            draftValues[TURMA_INSTRUCTOR_COLUMN] || '-',
                          room: draftValues[TURMA_ROOM_COLUMN] || '-',
                        }
                      : typeof turmaRowIndex === 'number'
                      ? turmaHeaderRows[turmaRowIndex]
                      : undefined;
                  const turmaNameValue = isDraft
                    ? draftValues[TURMA_COLUMN] ?? ''
                    : getCellValue(turmasSheet, turmaRow, TURMA_COLUMN);
                  const turmaName =
                    turmaHeader?.name ||
                    turmaNameValue ||
                    `Turma ${
                      typeof turmaRowIndex === 'number' ? turmaRowIndex + 1 : ''
                    }`;
                  const turmaKey = isDraft
                    ? displayRow.key
                    : `${turmaName}-${turmaRowIndex}`;
                  const isExpanded = !isDraft && Boolean(expandedTurmas[turmaKey]);
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
                      className={[
                        isExpanded ? 'turma-group expanded' : 'turma-group',
                        isDraft ? 'turma-group-draft' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={turmaKey}
                    >
                      <div
                        className="turma-group-header"
                        role={isDraft ? undefined : 'button'}
                        tabIndex={isDraft ? undefined : 0}
                        aria-expanded={isDraft ? undefined : isExpanded}
                        onClick={() => {
                          if (!isDraft) {
                            toggleTurma(turmaKey);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            isDraft ||
                            (event.key !== 'Enter' && event.key !== ' ')
                          ) {
                            return;
                          }

                          event.preventDefault();
                          toggleTurma(turmaKey);
                        }}
                      >
                        <span
                          className={
                            activeTurmaNameEdit?.rowIndex === turmaRowIndex
                              ? 'turma-header-title active'
                              : 'turma-header-title'
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (activeTurmaNameEdit?.rowIndex !== turmaRowIndex) {
                              startTurmaNameEdit(turmaRowIndex, turmaNameValue);
                            }
                          }}
                        >
                          {activeTurmaNameEdit?.rowIndex === turmaRowIndex ? (
                            <input
                              className="turma-header-inline-input"
                              autoFocus
                              value={activeTurmaNameEdit.draftValue}
                              onBlur={() => void commitActiveTurmaNameEdit()}
                              onChange={(event) => {
                                const nextEdit = {
                                  ...activeTurmaNameEdit,
                                  draftValue: event.target.value,
                                };

                                activeTurmaNameEditRef.current = nextEdit;
                                setActiveTurmaNameEdit(nextEdit);
                              }}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={handleTurmaNameKeyDown}
                            />
                          ) : (
                            <span className="turma-header-text">
                              {turmaName}
                            </span>
                          )}
                        </span>
                        <span
                          className="turma-header-separator turma-header-leading-separator"
                          aria-hidden="true"
                        />
                        <span
                          className="turma-header-details"
                          onScroll={handleStudentsPanelScroll}
                        >
                          <span className="turma-header-details-track">
                            <span
                              className="turma-header-detail turma-header-count"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isDraft) {
                                  toggleTurma(turmaKey);
                                }
                              }}
                            >
                              <PeopleIcon />
                              <span className="turma-header-text">
                                {turmaHeader?.count ?? '0'}
                              </span>
                            </span>
                            <span
                              className="turma-header-separator"
                              aria-hidden="true"
                            />
                            <span
                              className={
                                activeTurmaDropdown?.rowIndex === turmaRowIndex &&
                                activeTurmaDropdown.field === 'day'
                                  ? 'turma-header-detail turma-header-day active'
                                  : 'turma-header-detail turma-header-day'
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                openTurmaDropdown(
                                  turmaRowIndex,
                                  'day',
                                  event.currentTarget,
                                );
                              }}
                            >
                              {turmaHeader?.isMorning ? (
                                <Brightness2Icon />
                              ) : (
                                <MoonIcon />
                              )}
                              <span className="turma-header-text">
                                {turmaHeader?.day ?? '-'}
                              </span>
                            </span>
                            <span
                              className="turma-header-separator"
                              aria-hidden="true"
                            />
                            <span
                              className={
                                activeTurmaDropdown?.rowIndex === turmaRowIndex &&
                                activeTurmaDropdown.field === 'period'
                                  ? 'turma-header-detail turma-header-period active'
                                  : 'turma-header-detail turma-header-period'
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                openTurmaDropdown(
                                  turmaRowIndex,
                                  'period',
                                  event.currentTarget,
                                );
                              }}
                            >
                              <ClockHour4Icon />
                              <span className="turma-header-text">
                                {turmaHeader?.period ?? '-'}
                              </span>
                            </span>
                            <span
                              className="turma-header-separator"
                              aria-hidden="true"
                            />
                            <span
                              className={
                                activeTurmaDropdown?.rowIndex === turmaRowIndex &&
                                activeTurmaDropdown.field === 'instructor'
                                  ? 'turma-header-detail turma-header-instructor active'
                                  : 'turma-header-detail turma-header-instructor'
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                openTurmaDropdown(
                                  turmaRowIndex,
                                  'instructor',
                                  event.currentTarget,
                                );
                              }}
                            >
                              <SchoolIcon />
                              <span className="turma-header-text">
                                {turmaHeader?.instructor ?? '-'}
                              </span>
                            </span>
                            <span
                              className="turma-header-separator"
                              aria-hidden="true"
                            />
                            <span
                              className={
                                activeTurmaDropdown?.rowIndex === turmaRowIndex &&
                                activeTurmaDropdown.field === 'room'
                                  ? 'turma-header-detail turma-header-room active'
                                  : 'turma-header-detail turma-header-room'
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                openTurmaDropdown(
                                  turmaRowIndex,
                                  'room',
                                  event.currentTarget,
                                );
                              }}
                            >
                              <DoorIcon />
                              <span className="turma-header-text">
                                {turmaHeader?.room ?? '-'}
                              </span>
                            </span>
                            <span
                              className="turma-header-separator"
                              aria-hidden="true"
                            />
                          </span>
                        </span>
                        <span className="turma-header-actions">
                          {isDraft ? (
                            <>
                              <button
                                className={
                                  isTurmaDraftComplete(turmaDraft)
                                    ? 'turma-header-action-button turma-header-add-button'
                                    : 'turma-header-action-button turma-header-add-button disabled'
                                }
                                type="button"
                                aria-label="Adicionar turma"
                                title="Adicionar Turma"
                                disabled={!isTurmaDraftComplete(turmaDraft)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void saveTurmaDraft();
                                }}
                              >
                                <PlusIcon />
                              </button>
                              <button
                                className="turma-header-action-button turma-header-delete-button"
                                type="button"
                                aria-label="Descartar nova turma"
                                title="Descartar"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setTurmaDraft(null);
                                  activeTurmaNameEditRef.current = null;
                                  setActiveTurmaNameEdit(null);
                                  activeTurmaDropdownRef.current = null;
                                  setActiveTurmaDropdown(null);
                                }}
                              >
                                <CloseIcon />
                              </button>
                            </>
                          ) : (
                            <>
                              <ChevronIcon expanded={isExpanded} />
                              <button
                                className="turma-header-action-button turma-header-delete-button"
                                type="button"
                                aria-label="Deletar turma"
                                title="Deletar Turma"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (typeof turmaRowIndex === 'number') {
                                    setTurmaDeleteConfirmation({
                                      rowIndex: turmaRowIndex,
                                      turmaName,
                                    });
                                  }
                                }}
                              >
                                <CloseIcon />
                              </button>
                            </>
                          )}
                        </span>
                      </div>

                      {isExpanded && (
                        <div
                          className="turma-students-panel"
                          onScroll={handleStudentsPanelScroll}
                        >
                          {aprendizesSheet ? (
                            <table className="data-table turma-students-table">
                              <colgroup>
                                {orderedAprendizColumns.map((column) => (
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
                                    onClick={() => selectStudentFromTable(rowIndex)}
                                  >
                                    {orderedAprendizColumns.map(
                                      (column, orderedColumnIndex) => {
                                        const sourceColumnIndex =
                                          aprendizesSheet.columns.indexOf(column);
                                        const value =
                                          sourceColumnIndex >= 0
                                            ? row[sourceColumnIndex] || ''
                                            : '';
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
                                              [
                                                orderedColumnIndex === 0
                                                  ? 'pinned-column'
                                                  : '',
                                                isInvalidTurma
                                                  ? 'invalid-dropdown-cell'
                                                  : '',
                                              ]
                                                .filter(Boolean)
                                                .join(' ')
                                            }
                                            key={`${rowIndex}-${column}`}
                                            style={getAprendizColumnWidthStyle(
                                              column,
                                            )}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              selectStudentFromTable(
                                                rowIndex,
                                                column,
                                              );
                                            }}
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
                                    colSpan={orderedAprendizColumns.length}
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
            {activeTurmaDropdown && (
              <div
                className="turma-header-dropdown"
                style={activeTurmaDropdown.style}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {activeTurmaDropdown.field !== 'day' && (
                  <label className="turma-header-dropdown-create">
                    <input
                      ref={
                        activeTurmaDropdown.field === 'period'
                          ? turmaPeriodInputRef
                          : null
                      }
                      autoFocus
                      value={
                        activeTurmaDropdown.field === 'period'
                          ? formatPeriodDigits(activeTurmaDropdown.draftValue)
                          : activeTurmaDropdown.draftValue
                      }
                      onBlur={() => void commitTurmaDropdownDraft()}
                      onChange={(event) =>
                        updateTurmaDropdownDraft(event.target.value)
                      }
                      onClick={() => {
                        if (activeTurmaDropdown.field !== 'period') {
                          return;
                        }

                        const cursorPosition = getPeriodCursorPosition(
                          activeTurmaDropdown.draftValue.length,
                        );
                        turmaPeriodInputRef.current?.setSelectionRange(
                          cursorPosition,
                          cursorPosition,
                        );
                      }}
                      onKeyDown={handleTurmaDropdownKeyDown}
                      onPaste={handleTurmaPeriodPaste}
                    />
                  </label>
                )}
                <div className="turma-header-dropdown-options">
                  {getTurmaDropdownOptions(activeTurmaDropdown.field).map(
                    (option) => (
                      <button
                        key={option}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          void selectTurmaDropdownValue(
                            activeTurmaDropdown,
                            option,
                          )
                        }
                      >
                        {option}
                      </button>
                    ),
                  )}
                </div>
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
          const selectedFile = event.target.files?.[0];

          if (selectedFile) {
            window.dispatchEvent(
              new CustomEvent(GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT, {
                detail: selectedFile,
              }),
            );
          }

          event.currentTarget.value = '';
        }}
      />

      {invalidImportToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {invalidImportToast}
        </div>
      )}

      {turmaDeleteConfirmation && (
        <div
          className="page-modal-backdrop"
          role="presentation"
          onMouseDown={() => setTurmaDeleteConfirmation(null)}
        >
          <div
            className="recovery-dialog turma-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="turma-delete-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="recovery-dialog-header">
              <h2 id="turma-delete-dialog-title">Confirmar aÃ§Ã£o</h2>
              <button
                className="dialog-close-button"
                type="button"
                aria-label="Fechar"
                onClick={() => setTurmaDeleteConfirmation(null)}
              >
                <CloseIcon />
              </button>
            </div>
            <p>
              VocÃª estÃ¡ prestes a deletar a turma{' '}
              {turmaDeleteConfirmation.turmaName || 'sem nome'}.
            </p>
            <button
              className="primary-action recovery-confirm-action turma-delete-confirm-action"
              type="button"
              onClick={() =>
                void deleteTurmaRowAndSave(turmaDeleteConfirmation.rowIndex)
              }
            >
              <CloseIcon />
              Deletar turma
            </button>
          </div>
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
            <div className="recovery-checkpoint-list">
              {recoveryCheckpoints.map((checkpoint) => (
                <button
                  className="primary-action recovery-confirm-action"
                  type="button"
                  disabled={!checkpoint.canRecover || isRecoveringBackup}
                  key={checkpoint.checkpointId ?? checkpoint.formattedUpdatedAt}
                  onClick={() => void recoverBackup(checkpoint.checkpointId)}
                >
                  <RotateClockwiseIcon />
                  {isRecoveringBackup
                    ? 'Recuperando...'
                    : `Recuperar dados em ${
                        checkpoint.formattedUpdatedAt || 'checkpoint'
                      }`}
                </button>
              ))}
            </div>
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
      if ((info.fileCount ?? 0) === 0) {
        return (info.importCount ?? 0) > 1
          ? 'Recupere os dados para como estavam antes das primeiras importações.'
          : 'Recupere os dados para como estavam antes da primeira importação.';
      }

      return (info.importCount ?? 0) > 1
        ? 'Recupere os dados para como estavam antes das últimas importações.'
        : 'Recupere os dados para como estavam antes da última importação.';
    case 'before_edit':
      return 'Recupere os dados para como estavam antes de edições nesta sessão.';
    case 'before_session_edit':
      return 'Recupere os dados para como estavam antes da última sessão com edições.';
    case 'import_original':
      return 'Recupere os dados para como estavam quando o arquivo foi importado.';
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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

function PeopleIcon() {
  return (
    <svg className="turma-header-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
      <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />
    </svg>
  );
}

function Brightness2Icon() {
  return (
    <svg
      className="turma-header-icon turma-header-brightness-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M6 6h3.5l2.5 -2.5l2.5 2.5h3.5v3.5l2.5 2.5l-2.5 2.5v3.5h-3.5l-2.5 2.5l-2.5 -2.5h-3.5v-3.5l-2.5 -2.5l2.5 -2.5z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      className="turma-header-icon turma-header-moon-icon mirrored"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
    </svg>
  );
}

function ClockHour4Icon() {
  return (
    <svg className="turma-header-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7v5l3 2" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
    </svg>
  );
}

function SchoolIcon() {
  return (
    <svg className="turma-header-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 9l-10 -4l-10 4l10 4l10 -4v6" />
      <path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4" />
    </svg>
  );
}

function DoorIcon() {
  return (
    <svg className="turma-header-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 12v.01" />
      <path d="M3 21h18" />
      <path d="M5 21v-16a2 2 0 0 1 2 -2h10v18" />
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
