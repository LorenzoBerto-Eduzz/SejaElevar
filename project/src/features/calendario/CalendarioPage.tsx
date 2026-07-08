import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { GLOBAL_DATA_CHANGED_EVENT } from '../../shared/data/events';
import { getBaseWorkbookSheetByEntity } from '../../shared/data/baseWorkbook';
import {
  APRENDIZES_ENTITY_ID,
  AULAS_ENTITY_ID,
  CRONOGRAMA_ENTITY_ID,
  HORAS_APLICADAS_ENTITY_ID,
  PLANO_PROGRESSO_ENTITY_ID,
  PRESENCAS_ENTITY_ID,
  TURMAS_ENTITY_ID,
  buildCronogramaDataIndexEntity,
  type SheetTable,
} from '../../shared/data/dataIndex';
import {
  AULAS_REQUIRED_COLUMNS,
  CRONOGRAMA_REQUIRED_COLUMNS,
  HORAS_APLICADAS_REQUIRED_COLUMNS,
  PLANO_PROGRESSO_REQUIRED_COLUMNS,
  PRESENCAS_REQUIRED_COLUMNS,
  TURMAS_REQUIRED_COLUMNS,
  normalizeFieldLabel,
} from '../../shared/data/schemas';
import { generateStableRecordId, getSheetRecordId } from '../../shared/data/stableIds';
import {
  type AcademicAttendanceSelection,
  type AcademicEventSnapshot,
  getAcademicCellValue,
  readAcademicWorkbookSheets,
  saveWorkbookSheets,
  syncAcademicWorkbookFromSource,
  updateAcademicAttendance,
  validateAcademicAttendance,
} from '../../shared/data/academicProgress';
import {
  ensureActiveWorkbookManagedSheets,
  fetchBaseWorkbookFileWithRetry,
  fetchRecoveryInfo,
  loadXlsx,
  persistManagedWorkbookDataIndexes,
  readWorkbookSheetFile,
  responseToWorkbookFile,
} from '../../shared/data/workspaceData';
import {
  markGlobalWorkbookAvailable,
  useGlobalWorkbookState,
} from '../../shared/ui/GlobalWorkbookToolbar';
import { EmptyWorkbookImportState } from '../../shared/ui/EmptyWorkbookImportState';
import { MonthYearPicker } from '../../shared/ui/MonthYearPicker';
import { useTimedToast } from '../../shared/ui/useTimedToast';
import {
  CronogramaEventBlock,
  type CronogramaEventField,
} from '../cronograma/CronogramaEventBlock';
import {
  pushGlobalUndoEntry,
  registerGlobalUndoController,
  type GlobalUndoEntry,
} from '../../shared/undo/globalUndo';

type CalendarioPageProps = {
  canInitialize?: boolean;
  isActive?: boolean;
};

const CALENDARIO_WEEK_STORAGE_KEY = 'sejaelevar.calendario.weekStart.v1';
const WEEK_DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_LABELS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];
const MINUTES_PER_DAY = 24 * 60;
const SLOT_MINUTES = 15;
const DEFAULT_VISIBLE_START_MINUTES = 8 * 60;
const CRONOGRAMA_MIN_DURATION_MINUTES = 15;
const CRONOGRAMA_DEFAULT_DURATION_MINUTES = 30;
const CRONOGRAMA_SNAP_MINUTES = 5;
const CRONOGRAMA_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(CRONOGRAMA_ENTITY_ID)?.sheetName ?? 'Cronograma';
const AULAS_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(AULAS_ENTITY_ID)?.sheetName ?? 'Aulas';
const PRESENCAS_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(PRESENCAS_ENTITY_ID)?.sheetName ?? 'Presencas';
const HORAS_APLICADAS_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(HORAS_APLICADAS_ENTITY_ID)?.sheetName ??
  'Horas Aplicadas';
const PLANO_PROGRESSO_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(PLANO_PROGRESSO_ENTITY_ID)?.sheetName ??
  'Plano Progresso';
const TURMAS_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(TURMAS_ENTITY_ID)?.sheetName ?? 'Turmas';
const TURMA_COLUMN = 'Turma';
const NAME_COLUMN = 'Nome';
const LEARNING_ARC_COLUMN = 'Arco de Aprendizagem';
const CRONOGRAMA_DATE_COLUMN = 'Data';
const CRONOGRAMA_START_COLUMN = 'Início';
const CRONOGRAMA_END_COLUMN = 'Fim';
const CRONOGRAMA_TYPE_COLUMN = 'Tipo';
const CRONOGRAMA_LESSON_COLUMN = 'Aula';
const CRONOGRAMA_LESSON_ID_COLUMN = 'Aula ID';
const TURMA_INSTRUCTOR_COLUMN = 'Instrutor';
const TURMA_ROOM_COLUMN = 'Sala';
const CRONOGRAMA_COLOR_COLUMN = 'Cor';
const CRONOGRAMA_ID_COLUMN = 'ID';
const AULA_DEFAULT_INSTRUCTOR_COLUMN = 'Instrutor Padrão';
const AULA_DEFAULT_ROOM_COLUMN = 'Sala Padrão';
const DEFAULT_CRONOGRAMA_BLOCK_COLOR = '#2069df';
const DEFAULT_CRONOGRAMA_BLOCK_TYPE = 'Aula';

const padTimePart = (value: number) => String(value).padStart(2, '0');

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const snapMinutes = (minutes: number) =>
  Math.round(minutes / CRONOGRAMA_SNAP_MINUTES) * CRONOGRAMA_SNAP_MINUTES;

const formatTimeLabel = (minutes: number) => {
  const normalizedMinutes = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;

  return `${padTimePart(hours)}:${padTimePart(minute)}`;
};

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(
    date.getDate(),
  )}`;

const parseDateKey = (value: string | null) => {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const parsedDate = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const startOfSundayWeek = (date: Date) => {
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = nextDate.getDay();

  nextDate.setDate(nextDate.getDate() - dayOffset);
  return nextDate;
};

const addDays = (date: Date, days: number) => {
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const getStoredWeekStart = () => {
  if (typeof window === 'undefined') {
    return startOfSundayWeek(new Date());
  }

  return startOfSundayWeek(
    parseDateKey(window.localStorage.getItem(CALENDARIO_WEEK_STORAGE_KEY)) ??
      new Date(),
  );
};

const formatCalendarMonthLabel = (date: Date) =>
  `${MONTH_LABELS[date.getMonth()]}/${String(date.getFullYear()).slice(-2)}`;

const formatCalendarDateLabel = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);

const getColumnIndex = (sheet: SheetTable | null, columnName: string) =>
  sheet?.columns.findIndex(
    (column) => normalizeFieldLabel(column) === normalizeFieldLabel(columnName),
  ) ?? -1;

const getCellValue = (sheet: SheetTable, row: readonly string[], columnName: string) => {
  const columnIndex = getColumnIndex(sheet, columnName);

  return columnIndex >= 0 ? String(row[columnIndex] ?? '').trim() : '';
};

const normalizeDropdownKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const uniqueNonEmptyValues = (values: string[]) => {
  const seenKeys = new Set<string>();
  const uniqueValues: string[] = [];

  values.forEach((value) => {
    const trimmedValue = value.trim();
    const key = normalizeDropdownKey(trimmedValue);

    if (!trimmedValue || seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    uniqueValues.push(trimmedValue);
  });

  return uniqueValues;
};

const getCanonicalDropdownValue = (value: string, options: string[]) => {
  const valueKey = normalizeDropdownKey(value);

  if (!valueKey) {
    return '';
  }

  return (
    options.find((option) => normalizeDropdownKey(option) === valueKey) ?? null
  );
};

const cloneSheetSnapshot = (sheet: SheetTable): SheetTable => ({
  ...sheet,
  columns: [...sheet.columns],
  rows: sheet.rows.map((row) => [...row]),
});

const sheetSnapshotsHaveSameData = (first: SheetTable, second: SheetTable) =>
  first.columns.length === second.columns.length &&
  first.rows.length === second.rows.length &&
  first.columns.every((column, index) => column === second.columns[index]) &&
  first.rows.every(
    (row, rowIndex) =>
      row.length === second.rows[rowIndex]?.length &&
      row.every((value, columnIndex) => value === second.rows[rowIndex][columnIndex]),
  );

const parseScheduleTimeValue = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

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

type CalendarEventBlock = {
  id: string;
  rowIndex: number;
  row: string[];
  turma: string;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  type: string;
  lessonId: string;
  lesson: string;
  instructor: string;
  room: string;
  color: string;
};

type CalendarEventSegment = CalendarEventBlock & {
  segmentId: string;
  sourceDateKey: string;
  slotMinutes: number;
  topRowUnits: number;
  heightRowUnits: number;
  lane: number;
  laneCount: number;
};

type AulaCatalogOption = {
  id: string;
  name: string;
  color: string;
  defaultInstructor: string;
  defaultRoom: string;
};

type ActiveCalendarFieldEditor = {
  blockId: string;
  field: CronogramaEventField;
  draftValue: string;
  style: CSSProperties;
};

type AcademicAttendanceUndoSnapshot = {
  presencasSheet: SheetTable;
  horasAplicadasSheet: SheetTable;
  planoProgressoSheet: SheetTable;
};

type ActiveAttendancePanel = {
  blockId: string;
  style: CSSProperties;
};

type CalendarPointerMode = 'move' | 'resize-start' | 'resize-end';

type ActiveCalendarPointer = {
  blockId: string;
  mode: CalendarPointerMode;
  originalRow: string[];
  originalRowIndex: number;
  initialClientX: number;
  initialClientY: number;
  didMove: boolean;
  grabbedOffsetMinutes: number;
  rowHeight: number;
  timeColumnWidth: number;
  grid: HTMLDivElement;
};

const readCronogramaSheetFromFile = async (file: File) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: CRONOGRAMA_ENTITY_ID,
      ensureRecordIds: false,
      preferredSheetName: CRONOGRAMA_WORKBOOK_SHEET,
      requiredColumns: CRONOGRAMA_REQUIRED_COLUMNS,
    });
  } catch {
    return {
      fileName: file.name,
      sheetName: CRONOGRAMA_WORKBOOK_SHEET,
      importedAt: new Date().toISOString(),
      columns: [...CRONOGRAMA_REQUIRED_COLUMNS],
      rows: [],
    };
  }
};

const readAulasSheetFromFile = async (file: File) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: AULAS_ENTITY_ID,
      ensureRecordIds: false,
      preferredSheetName: AULAS_WORKBOOK_SHEET,
      requiredColumns: AULAS_REQUIRED_COLUMNS,
    });
  } catch {
    return {
      fileName: file.name,
      sheetName: AULAS_WORKBOOK_SHEET,
      importedAt: new Date().toISOString(),
      columns: [...AULAS_REQUIRED_COLUMNS],
      rows: [],
    };
  }
};

const readTurmasSheetFromFile = async (file: File) => {
  try {
    return await readWorkbookSheetFile(file, {
      entityId: TURMAS_ENTITY_ID,
      ensureRecordIds: false,
      preferredSheetName: TURMAS_WORKBOOK_SHEET,
      requiredColumns: TURMAS_REQUIRED_COLUMNS,
    });
  } catch {
    return {
      fileName: file.name,
      sheetName: TURMAS_WORKBOOK_SHEET,
      importedAt: new Date().toISOString(),
      columns: [...TURMAS_REQUIRED_COLUMNS],
      rows: [],
    };
  }
};

const buildCalendarEventBlocks = (sheet: SheetTable | null): CalendarEventBlock[] => {
  if (!sheet) {
    return [];
  }

  return sheet.rows.flatMap((row, rowIndex) => {
    const startMinutes = parseScheduleTimeValue(
      getCellValue(sheet, row, CRONOGRAMA_START_COLUMN),
    );
    const rawEndMinutes = parseScheduleTimeValue(
      getCellValue(sheet, row, CRONOGRAMA_END_COLUMN),
    );
    const dateKey = getCellValue(sheet, row, CRONOGRAMA_DATE_COLUMN);
    const turma = getCellValue(sheet, row, TURMA_COLUMN);

    if (!dateKey || startMinutes === null || rawEndMinutes === null) {
      return [];
    }

    const endMinutes =
      rawEndMinutes <= startMinutes ? rawEndMinutes + MINUTES_PER_DAY : rawEndMinutes;
    const id =
      getCellValue(sheet, row, CRONOGRAMA_ID_COLUMN) ||
      `${CRONOGRAMA_ENTITY_ID}#${rowIndex + 1}`;

    return [
      {
        id,
        rowIndex,
        row,
        turma,
        dateKey,
        startMinutes,
        endMinutes,
        type: getCellValue(sheet, row, CRONOGRAMA_TYPE_COLUMN) || DEFAULT_CRONOGRAMA_BLOCK_TYPE,
        lessonId: getCellValue(sheet, row, CRONOGRAMA_LESSON_ID_COLUMN),
        lesson: getCellValue(sheet, row, CRONOGRAMA_LESSON_COLUMN),
        instructor: getCellValue(sheet, row, TURMA_INSTRUCTOR_COLUMN),
        room: getCellValue(sheet, row, TURMA_ROOM_COLUMN),
        color: getCellValue(sheet, row, CRONOGRAMA_COLOR_COLUMN) || DEFAULT_CRONOGRAMA_BLOCK_COLOR,
      },
    ];
  });
};

const splitEventBlockByDay = (block: CalendarEventBlock) => {
  const startDate = parseDateKey(block.dateKey);

  if (!startDate) {
    return [];
  }

  const segments: CalendarEventSegment[] = [];

  for (
    let dayOffset = Math.floor(block.startMinutes / MINUTES_PER_DAY);
    dayOffset <= Math.floor((block.endMinutes - 1) / MINUTES_PER_DAY);
    dayOffset += 1
  ) {
    const dayStartMinutes = dayOffset * MINUTES_PER_DAY;
    const segmentStart = Math.max(block.startMinutes, dayStartMinutes);
    const segmentEnd = Math.min(block.endMinutes, dayStartMinutes + MINUTES_PER_DAY);
    const segmentDate = addDays(startDate, dayOffset);
    const startMinutes = segmentStart - dayStartMinutes;
    const endMinutes = segmentEnd - dayStartMinutes;
    const slotMinutes = Math.floor(startMinutes / SLOT_MINUTES) * SLOT_MINUTES;

    if (endMinutes <= startMinutes) {
      continue;
    }

    segments.push({
      ...block,
      segmentId: `${block.id}-${dayOffset}`,
      sourceDateKey: block.dateKey,
      dateKey: formatDateKey(segmentDate),
      startMinutes,
      endMinutes,
      slotMinutes,
      topRowUnits: (startMinutes - slotMinutes) / SLOT_MINUTES,
      heightRowUnits: Math.max((endMinutes - startMinutes) / SLOT_MINUTES, 1),
      lane: 0,
      laneCount: 1,
    });
  }

  return segments;
};

const doSegmentsOverlap = (
  first: Pick<CalendarEventSegment, 'startMinutes' | 'endMinutes'>,
  second: Pick<CalendarEventSegment, 'startMinutes' | 'endMinutes'>,
) => first.startMinutes < second.endMinutes && first.endMinutes > second.startMinutes;

const assignEventSegmentLanes = (segments: CalendarEventSegment[]) => {
  const sortedSegments = [...segments].sort((first, second) =>
    first.startMinutes === second.startMinutes
      ? second.endMinutes - first.endMinutes
      : first.startMinutes - second.startMinutes,
  );
  const laidOutSegments: CalendarEventSegment[] = [];
  let currentGroup: CalendarEventSegment[] = [];
  let currentGroupEnd = -1;

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      return;
    }

    const laneEnds: number[] = [];
    const groupWithLanes = currentGroup.map((segment) => {
      const laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= segment.startMinutes);
      const lane = laneIndex >= 0 ? laneIndex : laneEnds.length;

      laneEnds[lane] = segment.endMinutes;
      return {
        ...segment,
        lane,
      };
    });
    const laneCount = Math.max(1, laneEnds.length);

    laidOutSegments.push(
      ...groupWithLanes.map((segment) => ({
        ...segment,
        laneCount,
      })),
    );
    currentGroup = [];
    currentGroupEnd = -1;
  };

  sortedSegments.forEach((segment) => {
    if (currentGroup.length > 0 && segment.startMinutes >= currentGroupEnd) {
      flushGroup();
    }

    currentGroup.push(segment);
    currentGroupEnd = Math.max(currentGroupEnd, segment.endMinutes);
  });
  flushGroup();

  return laidOutSegments.sort((first, second) => {
    if (first.slotMinutes !== second.slotMinutes) {
      return first.slotMinutes - second.slotMinutes;
    }

    return first.lane - second.lane;
  });
};

const buildEventSegmentsByDateAndSlot = (blocks: CalendarEventBlock[]) => {
  const segmentsByDate = new Map<string, CalendarEventSegment[]>();

  blocks.flatMap(splitEventBlockByDay).forEach((segment) => {
    const dateSegments = segmentsByDate.get(segment.dateKey) ?? [];

    dateSegments.push(segment);
    segmentsByDate.set(segment.dateKey, dateSegments);
  });

  const segmentsByDateAndSlot = new Map<string, CalendarEventSegment[]>();

  segmentsByDate.forEach((dateSegments, dateKey) => {
    assignEventSegmentLanes(dateSegments).forEach((segment) => {
      const slotKey = `${dateKey}-${segment.slotMinutes}`;
      const slotSegments = segmentsByDateAndSlot.get(slotKey) ?? [];

      slotSegments.push(segment);
      segmentsByDateAndSlot.set(slotKey, slotSegments);
    });
  });

  return segmentsByDateAndSlot;
};

const resolveLiveAulaForUnconfirmedBlock = <T extends CalendarEventBlock>(
  block: T,
  aulaCatalogOptions: AulaCatalogOption[],
  hasCurrentPresence: boolean,
): T => {
  if (hasCurrentPresence || !block.lessonId) {
    return block;
  }

  const liveAula = aulaCatalogOptions.find((option) => option.id === block.lessonId);

  if (!liveAula) {
    return block;
  }

  return {
    ...block,
    lesson: liveAula.name || block.lesson,
    color: liveAula.color || block.color,
  };
};

const getCronogramaRowId = (sheet: SheetTable, row: string[]) =>
  getCellValue(sheet, row, CRONOGRAMA_ID_COLUMN);

const getCronogramaRowWithBlockValues = (
  sheet: SheetTable,
  sourceRow: string[],
  values: {
    id: string;
    turmaName: string;
    dateKey: string;
    startMinutes: number;
    endMinutes: number;
    type?: string;
    lessonId?: string;
    lesson?: string;
    instructor?: string;
    room?: string;
    color?: string;
  },
) =>
  sheet.columns.map((column, columnIndex) => {
    const currentValue = sourceRow[columnIndex] ?? '';

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_ID_COLUMN)) {
      return values.id;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(TURMA_COLUMN)) {
      return values.turmaName;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_DATE_COLUMN)) {
      return values.dateKey;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_START_COLUMN)) {
      return formatTimeLabel(values.startMinutes);
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_END_COLUMN)) {
      return formatTimeLabel(values.endMinutes);
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_TYPE_COLUMN)) {
      return values.type ?? currentValue;
    }

    if (
      normalizeFieldLabel(column) ===
      normalizeFieldLabel(CRONOGRAMA_LESSON_ID_COLUMN)
    ) {
      return values.lessonId ?? currentValue;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_LESSON_COLUMN)) {
      return values.lesson ?? currentValue;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(TURMA_INSTRUCTOR_COLUMN)) {
      return values.instructor ?? currentValue;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(TURMA_ROOM_COLUMN)) {
      return values.room ?? currentValue;
    }

    if (normalizeFieldLabel(column) === normalizeFieldLabel(CRONOGRAMA_COLOR_COLUMN)) {
      return values.color ?? currentValue;
    }

    return currentValue;
  });

const getCronogramaRowWithValues = (
  sheet: SheetTable,
  values: Record<string, string>,
) =>
  sheet.columns.map((column) => {
    const matchingValue = Object.entries(values).find(
      ([key]) => normalizeFieldLabel(key) === normalizeFieldLabel(column),
    );

    return matchingValue?.[1] ?? '';
  });

const replaceCronogramaRow = (
  sheet: SheetTable,
  rowIndex: number,
  nextRow: string[],
): SheetTable => ({
  ...sheet,
  rows: sheet.rows.map((row, currentIndex) =>
    currentIndex === rowIndex ? nextRow : row,
  ),
});

const persistCronogramaDataIndex = async (sheet: SheetTable | null) => {
  try {
    const entityIndex = sheet
      ? buildCronogramaDataIndexEntity(sheet)
      : {
          entity: CRONOGRAMA_ENTITY_ID,
          label: 'Cronograma',
          sourceFileName: null,
          sourceSheetName: null,
          importedAt: null,
          updatedAt: new Date().toISOString(),
          records: [],
        };

    await fetch(`/api/data-index/entities/${CRONOGRAMA_ENTITY_ID}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(entityIndex),
    });
  } catch {
    // The workbook remains the source of truth; the index can be rebuilt.
  }
};

const saveCronogramaSheetToSourceFile = async (sheet: SheetTable) => {
  const { read, utils, write } = await loadXlsx();
  const sourceResponse = await fetch('/api/base-workbook/file', {
    cache: 'no-store',
  });

  if (!sourceResponse.ok) {
    return null;
  }

  const sourceFile = await responseToWorkbookFile(
    sourceResponse,
    'DadosElevar.xlsx',
  );
  const workbook = read(await sourceFile.arrayBuffer(), {
    cellDates: true,
  });
  const sheetName =
    workbook.SheetNames.find(
      (candidateName) =>
        normalizeFieldLabel(candidateName) ===
        normalizeFieldLabel(CRONOGRAMA_WORKBOOK_SHEET),
    ) ?? CRONOGRAMA_WORKBOOK_SHEET;

  workbook.Sheets[sheetName] = utils.aoa_to_sheet([
    sheet.columns,
    ...sheet.rows,
  ]);

  if (!workbook.SheetNames.includes(sheetName)) {
    workbook.SheetNames.push(sheetName);
  }

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
    return null;
  }

  const result = (await saveResponse.json()) as { fileName?: string };

  return {
    ...sheet,
    fileName: result.fileName || sheet.fileName,
  };
};

export function CalendarioPage({
  canInitialize = true,
  isActive = true,
}: CalendarioPageProps) {
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const calendarFieldInputRef = useRef<HTMLInputElement | null>(null);
  const [hasActiveWorkbook, setHasActiveWorkbook] = useState(false);
  const [hasCheckedWorkbook, setHasCheckedWorkbook] = useState(false);
  const [cronogramaSheet, setCronogramaSheet] = useState<SheetTable | null>(null);
  const [aulasSheet, setAulasSheet] = useState<SheetTable | null>(null);
  const [turmasSheet, setTurmasSheet] = useState<SheetTable | null>(null);
  const [aprendizesSheet, setAprendizesSheet] = useState<SheetTable | null>(null);
  const [aulasDisciplinasSheet, setAulasDisciplinasSheet] =
    useState<SheetTable | null>(null);
  const [planoEnsinoSheet, setPlanoEnsinoSheet] = useState<SheetTable | null>(null);
  const [presencasSheet, setPresencasSheet] = useState<SheetTable | null>(null);
  const [horasAplicadasSheet, setHorasAplicadasSheet] =
    useState<SheetTable | null>(null);
  const [planoProgressoSheet, setPlanoProgressoSheet] =
    useState<SheetTable | null>(null);
  const latestCronogramaSheetRef = useRef<SheetTable | null>(null);
  const latestAprendizesSheetRef = useRef<SheetTable | null>(null);
  const latestAulasDisciplinasSheetRef = useRef<SheetTable | null>(null);
  const latestPlanoEnsinoSheetRef = useRef<SheetTable | null>(null);
  const latestPresencasSheetRef = useRef<SheetTable | null>(null);
  const latestHorasAplicadasSheetRef = useRef<SheetTable | null>(null);
  const latestPlanoProgressoSheetRef = useRef<SheetTable | null>(null);
  const activeCalendarFieldEditorRef =
    useRef<ActiveCalendarFieldEditor | null>(null);
  const activeCalendarPointerRef = useRef<ActiveCalendarPointer | null>(null);
  const [activeCalendarFieldEditor, setActiveCalendarFieldEditor] =
    useState<ActiveCalendarFieldEditor | null>(null);
  const [activeAttendancePanel, setActiveAttendancePanel] =
    useState<ActiveAttendancePanel | null>(null);
  const activeAttendancePanelRef = useRef<ActiveAttendancePanel | null>(null);
  const [attendanceDraft, setAttendanceDraft] = useState<Record<string, boolean>>(
    {},
  );
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const { message: warningToast, showToast: showWarningToast } = useTimedToast();
  const [weekStart, setWeekStart] = useState(getStoredWeekStart);
  const globalWorkbookState = useGlobalWorkbookState();

  useEffect(() => {
    latestCronogramaSheetRef.current = cronogramaSheet;
  }, [cronogramaSheet]);

  useEffect(() => {
    latestAprendizesSheetRef.current = aprendizesSheet;
  }, [aprendizesSheet]);

  useEffect(() => {
    latestAulasDisciplinasSheetRef.current = aulasDisciplinasSheet;
  }, [aulasDisciplinasSheet]);

  useEffect(() => {
    latestPlanoEnsinoSheetRef.current = planoEnsinoSheet;
  }, [planoEnsinoSheet]);

  useEffect(() => {
    latestPresencasSheetRef.current = presencasSheet;
  }, [presencasSheet]);

  useEffect(() => {
    latestHorasAplicadasSheetRef.current = horasAplicadasSheet;
  }, [horasAplicadasSheet]);

  useEffect(() => {
    latestPlanoProgressoSheetRef.current = planoProgressoSheet;
  }, [planoProgressoSheet]);

  useEffect(() => {
    activeCalendarFieldEditorRef.current = activeCalendarFieldEditor;
  }, [activeCalendarFieldEditor]);

  useEffect(() => {
    activeAttendancePanelRef.current = activeAttendancePanel;
  }, [activeAttendancePanel]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      CALENDARIO_WEEK_STORAGE_KEY,
      formatDateKey(weekStart),
    );
  }, [weekStart]);

  useEffect(() => {
    if (!canInitialize) {
      return;
    }

    let isMounted = true;

    const loadWorkbookState = async () => {
      try {
        await ensureActiveWorkbookManagedSheets().catch(() => false);
        const file = await fetchBaseWorkbookFileWithRetry(3, 180).catch(
          () => null,
        );

        if (!isMounted) {
          return;
        }

        const [
          nextCronogramaSheet,
          nextAulasSheet,
          nextTurmasSheet,
          nextAcademicSheets,
        ] = file
          ? await Promise.all([
              readCronogramaSheetFromFile(file),
              readAulasSheetFromFile(file),
              readTurmasSheetFromFile(file),
              readAcademicWorkbookSheets(file),
            ])
          : [null, null, null, null];

        if (!isMounted) {
          return;
        }

        setHasActiveWorkbook(Boolean(file) || globalWorkbookState.hasWorkbook);
        setCronogramaSheet(nextCronogramaSheet);
        setAulasSheet(nextAulasSheet);
        setTurmasSheet(nextTurmasSheet);
        setAprendizesSheet(nextAcademicSheets?.aprendizes ?? null);
        setAulasDisciplinasSheet(nextAcademicSheets?.aulasDisciplinas ?? null);
        setPlanoEnsinoSheet(nextAcademicSheets?.planoEnsino ?? null);
        setPresencasSheet(nextAcademicSheets?.presencas ?? null);
        setHorasAplicadasSheet(nextAcademicSheets?.horasAplicadas ?? null);
        setPlanoProgressoSheet(nextAcademicSheets?.planoProgresso ?? null);
        setHasCheckedWorkbook(true);

        if (file || globalWorkbookState.hasWorkbook) {
          markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
        }
      } catch {
        if (!isMounted) {
          return;
        }

        setHasActiveWorkbook(globalWorkbookState.hasWorkbook);
        setCronogramaSheet(null);
        setAulasSheet(null);
        setTurmasSheet(null);
        setAprendizesSheet(null);
        setAulasDisciplinasSheet(null);
        setPlanoEnsinoSheet(null);
        setPresencasSheet(null);
        setHorasAplicadasSheet(null);
        setPlanoProgressoSheet(null);
        setHasCheckedWorkbook(true);
      }
    };

    const handleGlobalDataChanged = () => {
      void loadWorkbookState();
    };

    void loadWorkbookState();
    window.addEventListener(GLOBAL_DATA_CHANGED_EVENT, handleGlobalDataChanged);

    return () => {
      isMounted = false;
      window.removeEventListener(
        GLOBAL_DATA_CHANGED_EVENT,
        handleGlobalDataChanged,
      );
    };
  }, [canInitialize, globalWorkbookState.hasWorkbook]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const timeSlots = useMemo(
    () =>
      Array.from(
        { length: MINUTES_PER_DAY / SLOT_MINUTES + 1 },
        (_, index) => index * SLOT_MINUTES,
      ),
    [],
  );
  const monthLabel = formatCalendarMonthLabel(weekStart);
  const cronogramaBlocks = useMemo(
    () => buildCalendarEventBlocks(cronogramaSheet),
    [cronogramaSheet],
  );
  const eventSegmentsByDateAndSlot = useMemo(
    () => buildEventSegmentsByDateAndSlot(cronogramaBlocks),
    [cronogramaBlocks],
  );
  const aulaCatalogOptions = useMemo<AulaCatalogOption[]>(
    () =>
      aulasSheet
        ? aulasSheet.rows.flatMap((row, rowIndex) => {
            const name = getCellValue(aulasSheet, row, CRONOGRAMA_LESSON_COLUMN);

            if (!name) {
              return [];
            }

            return [
              {
                id:
                  getCellValue(aulasSheet, row, CRONOGRAMA_ID_COLUMN) ||
                  getSheetRecordId(aulasSheet, rowIndex, AULAS_ENTITY_ID),
                name,
                color:
                  getCellValue(aulasSheet, row, CRONOGRAMA_COLOR_COLUMN) ||
                  DEFAULT_CRONOGRAMA_BLOCK_COLOR,
                defaultInstructor: getCellValue(
                  aulasSheet,
                  row,
                  AULA_DEFAULT_INSTRUCTOR_COLUMN,
                ),
                defaultRoom: getCellValue(aulasSheet, row, AULA_DEFAULT_ROOM_COLUMN),
              },
            ];
          })
        : [],
    [aulasSheet],
  );
  const turmaNames = useMemo(
    () =>
      turmasSheet
        ? uniqueNonEmptyValues(
            turmasSheet.rows.map((row) =>
              getCellValue(turmasSheet, row, TURMA_COLUMN),
            ),
          )
        : [],
    [turmasSheet],
  );
  const calendarInstructorOptions = useMemo(
    () =>
      uniqueNonEmptyValues([
        ...cronogramaBlocks.map((block) => block.instructor),
        ...aulaCatalogOptions.map((option) => option.defaultInstructor),
      ]),
    [aulaCatalogOptions, cronogramaBlocks],
  );
  const calendarRoomOptions = useMemo(
    () =>
      uniqueNonEmptyValues([
        ...cronogramaBlocks.map((block) => block.room),
        ...aulaCatalogOptions.map((option) => option.defaultRoom),
      ]),
    [aulaCatalogOptions, cronogramaBlocks],
  );

  const getAcademicFallbackSheet = (
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

  const getCurrentAttendanceUndoSnapshot = (
    fileName: string,
  ): AcademicAttendanceUndoSnapshot => ({
    presencasSheet: cloneSheetSnapshot(
      latestPresencasSheetRef.current ??
        getAcademicFallbackSheet(
          fileName,
          PRESENCAS_WORKBOOK_SHEET,
          PRESENCAS_REQUIRED_COLUMNS,
        ),
    ),
    horasAplicadasSheet: cloneSheetSnapshot(
      latestHorasAplicadasSheetRef.current ??
        getAcademicFallbackSheet(
          fileName,
          HORAS_APLICADAS_WORKBOOK_SHEET,
          HORAS_APLICADAS_REQUIRED_COLUMNS,
        ),
    ),
    planoProgressoSheet: cloneSheetSnapshot(
      latestPlanoProgressoSheetRef.current ??
        getAcademicFallbackSheet(
          fileName,
          PLANO_PROGRESSO_WORKBOOK_SHEET,
          PLANO_PROGRESSO_REQUIRED_COLUMNS,
        ),
    ),
  });

  const areAttendanceSnapshotsEqual = (
    first: AcademicAttendanceUndoSnapshot,
    second: AcademicAttendanceUndoSnapshot,
  ) =>
    sheetSnapshotsHaveSameData(first.presencasSheet, second.presencasSheet) &&
    sheetSnapshotsHaveSameData(
      first.horasAplicadasSheet,
      second.horasAplicadasSheet,
    ) &&
    sheetSnapshotsHaveSameData(
      first.planoProgressoSheet,
      second.planoProgressoSheet,
    );

  const getTurmaRecordId = (turmaName: string) => {
    const sheet = turmasSheet;

    if (!sheet) {
      return '';
    }

    const rowIndex = sheet.rows.findIndex(
      (row) =>
        normalizeFieldLabel(getCellValue(sheet, row, TURMA_COLUMN)) ===
        normalizeFieldLabel(turmaName),
    );

    return rowIndex >= 0 ? getSheetRecordId(sheet, rowIndex, TURMAS_ENTITY_ID) : '';
  };

  const getEventAttendanceSnapshot = (
    block: CalendarEventBlock,
  ): AcademicEventSnapshot => {
    const snapshotBlock = resolveLiveAulaForUnconfirmedBlock(
      block,
      aulaCatalogOptions,
      blockHasAttendance(block.id),
    );

    return {
      id: snapshotBlock.id,
      turma: snapshotBlock.turma,
      turmaId: getTurmaRecordId(snapshotBlock.turma),
      date: snapshotBlock.dateKey,
      start: formatTimeLabel(snapshotBlock.startMinutes),
      end: formatTimeLabel(snapshotBlock.endMinutes),
      aulaId: snapshotBlock.lessonId,
      aula: snapshotBlock.lesson,
      instructor: snapshotBlock.instructor,
      room: snapshotBlock.room,
      durationMinutes: Math.max(
        0,
        snapshotBlock.endMinutes - snapshotBlock.startMinutes,
      ),
    };
  };

  const getAttendanceStatusesForBlock = (blockId: string) => {
    const statuses = new Map<string, string>();
    const sheet = latestPresencasSheetRef.current;

    sheet?.rows.forEach((row) => {
      if (getAcademicCellValue(sheet, row, 'Evento ID') !== blockId) {
        return;
      }

      statuses.set(
        getAcademicCellValue(sheet, row, 'Aprendiz ID'),
        getAcademicCellValue(sheet, row, 'Status Presenca') ||
          getAcademicCellValue(sheet, row, 'Status Presença'),
      );
    });

    return statuses;
  };

  const blockHasAttendance = (blockId: string) => {
    if (activeAttendancePanel?.blockId === blockId) {
      return Object.values(attendanceDraft).some(Boolean);
    }

    const statuses = getAttendanceStatusesForBlock(blockId);

    return Array.from(statuses.values()).some(
      (status) =>
        normalizeFieldLabel(status) === normalizeFieldLabel('Presente'),
    );
  };

  const warnBlockedEventWithAttendance = (action: string) => {
    showWarningToast(
      `Este evento já possui presença registrada e não pode ser ${action} sem uma revisão.`,
    );
  };

  const getAttendanceStudentsForBlock = (block: CalendarEventBlock) => {
    const sheet = latestAprendizesSheetRef.current;
    const turmaColumnIndex = getColumnIndex(sheet, TURMA_COLUMN);

    if (!sheet || turmaColumnIndex < 0 || !block.turma) {
      return [];
    }

    return sheet.rows
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter(({ row }) => {
        const rawTurmaName = row[turmaColumnIndex] || '';
        const canonicalTurmaName =
          getCanonicalDropdownValue(rawTurmaName, turmaNames) ?? rawTurmaName;

        return canonicalTurmaName === block.turma;
      })
      .map(({ row, rowIndex }) => ({
        aprendizId: getSheetRecordId(sheet, rowIndex, APRENDIZES_ENTITY_ID),
        aprendiz: getCellValue(sheet, row, NAME_COLUMN) || `Aprendiz ${rowIndex + 1}`,
        arco: getCellValue(sheet, row, LEARNING_ARC_COLUMN),
      }));
  };

  const getAttendanceDraftForBlock = (block: CalendarEventBlock) => {
    const statuses = getAttendanceStatusesForBlock(block.id);
    const students = getAttendanceStudentsForBlock(block);

    return Object.fromEntries(
      students.map((student) => [
        student.aprendizId,
        statuses.get(student.aprendizId) === 'Presente',
      ]),
    );
  };

  const openAttendancePanel = (block: CalendarEventBlock) => {
    if (!block.turma) {
      showWarningToast('Selecione uma turma antes de registrar presença.');
      return;
    }

    const anchor = calendarGridRef.current?.querySelector<HTMLElement>(
      `[data-schedule-block-id="${block.id}"]`,
    );
    const nextDraft = getAttendanceDraftForBlock(block);

    setAttendanceDraft(nextDraft);

    if (!anchor) {
      setActiveAttendancePanel({
        blockId: block.id,
        style: { visibility: 'hidden' },
      });
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const panelWidth = 300;
    const left = Math.min(
      Math.max(12, Math.round(rect.right + 8)),
      Math.max(12, Math.round(window.innerWidth - panelWidth - 12)),
    );
    const top = Math.min(
      Math.max(12, Math.round(rect.top)),
      Math.max(12, Math.round(window.innerHeight - 320)),
    );

    setActiveAttendancePanel({
      blockId: block.id,
      style: {
        left,
        top,
        width: panelWidth,
        visibility: 'visible',
      },
    });
  };

  const saveAttendanceForBlock = async (
    block: CalendarEventBlock,
    nextAttendanceDraft = attendanceDraft,
  ) => {
    if (isSavingAttendance) {
      return;
    }

    const students = getAttendanceStudentsForBlock(block);

    if (!block.lessonId && !block.lesson) {
      showWarningToast('Selecione uma aula antes de registrar presença.');
      return;
    }

    setIsSavingAttendance(true);

    try {
      const syncedAcademicFile = await syncAcademicWorkbookFromSource().catch(
        () => null,
      );

      if (syncedAcademicFile) {
        const academicSheets = await readAcademicWorkbookSheets(syncedAcademicFile);

        latestAprendizesSheetRef.current = academicSheets.aprendizes;
        setAprendizesSheet(academicSheets.aprendizes);
        latestAulasDisciplinasSheetRef.current = academicSheets.aulasDisciplinas;
        setAulasDisciplinasSheet(academicSheets.aulasDisciplinas);
        latestPlanoEnsinoSheetRef.current = academicSheets.planoEnsino;
        setPlanoEnsinoSheet(academicSheets.planoEnsino);
        latestPresencasSheetRef.current = academicSheets.presencas;
        setPresencasSheet(academicSheets.presencas);
        latestHorasAplicadasSheetRef.current = academicSheets.horasAplicadas;
        setHorasAplicadasSheet(academicSheets.horasAplicadas);
        latestPlanoProgressoSheetRef.current = academicSheets.planoProgresso;
        setPlanoProgressoSheet(academicSheets.planoProgresso);
      }

      const fileName =
        latestCronogramaSheetRef.current?.fileName ??
        latestPresencasSheetRef.current?.fileName ??
        'DadosElevar.xlsx';
      const previousAcademicSheets = getCurrentAttendanceUndoSnapshot(fileName);
      const eventSnapshot = getEventAttendanceSnapshot(block);
      const selections: AcademicAttendanceSelection[] = students.map((student) => ({
        ...student,
        status: nextAttendanceDraft[student.aprendizId] ? 'Presente' : 'Ausente',
      }));
      const validation = validateAcademicAttendance(
        latestPlanoEnsinoSheetRef.current,
        latestAulasDisciplinasSheetRef.current,
        eventSnapshot,
        selections,
      );

      if (!validation.ok) {
        showWarningToast(validation.message);
        return;
      }

      const nextAcademicSheets = updateAcademicAttendance(
        fileName,
        latestPresencasSheetRef.current,
        latestHorasAplicadasSheetRef.current,
        latestPlanoEnsinoSheetRef.current,
        latestAulasDisciplinasSheetRef.current,
        eventSnapshot,
        selections,
      );
      const nextAcademicUndoSheets: AcademicAttendanceUndoSnapshot = {
        presencasSheet: cloneSheetSnapshot(nextAcademicSheets.presencasSheet),
        horasAplicadasSheet: cloneSheetSnapshot(
          nextAcademicSheets.horasAplicadasSheet,
        ),
        planoProgressoSheet: cloneSheetSnapshot(
          nextAcademicSheets.planoProgressoSheet,
        ),
      };

      if (areAttendanceSnapshotsEqual(previousAcademicSheets, nextAcademicUndoSheets)) {
        return;
      }

      const savedFile = await saveWorkbookSheets([
        nextAcademicSheets.presencasSheet,
        nextAcademicSheets.horasAplicadasSheet,
        nextAcademicSheets.planoProgressoSheet,
      ]);

      latestPresencasSheetRef.current = nextAcademicSheets.presencasSheet;
      setPresencasSheet(nextAcademicSheets.presencasSheet);
      latestHorasAplicadasSheetRef.current =
        nextAcademicSheets.horasAplicadasSheet;
      setHorasAplicadasSheet(nextAcademicSheets.horasAplicadasSheet);
      latestPlanoProgressoSheetRef.current =
        nextAcademicSheets.planoProgressoSheet;
      setPlanoProgressoSheet(nextAcademicSheets.planoProgressoSheet);
      if (savedFile) {
        window.dispatchEvent(
          new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
            detail: {
              file: savedFile,
              fileName: savedFile.name,
              reason: 'attendance-save',
              force: true,
            },
          }),
        );
      } else {
        window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
      }
      await fetchRecoveryInfo();
      pushGlobalUndoEntry({
        originTab: 'calendario',
        kind: 'attendance-save',
        itemRef: block.id,
        itemLabel: block.lesson || block.id,
        previousAcademicSheets,
        nextAcademicSheets: nextAcademicUndoSheets,
      });
    } catch {
      showWarningToast('Não foi possível salvar a presença.');
    } finally {
      setIsSavingAttendance(false);
    }
  };
  const hasWorkbookForPage = hasActiveWorkbook || globalWorkbookState.hasWorkbook;
  const shouldShowImportState = hasCheckedWorkbook && !hasWorkbookForPage;
  const shouldShowCalendar = hasCheckedWorkbook && hasWorkbookForPage;
  const titleId = 'calendario-title';
  const gridStyle =
    {
      '--calendario-day-count': weekDates.length,
    } as CSSProperties;

  const moveWeek = (weekOffset: number) => {
    setWeekStart((currentWeekStart) => addDays(currentWeekStart, weekOffset * 7));
  };

  useLayoutEffect(() => {
    if (!isActive || !shouldShowCalendar || typeof window === 'undefined') {
      return;
    }

    const grid = calendarGridRef.current;

    if (!grid) {
      return;
    }

    const scrollToDefaultTime = () => {
      const rowHeight = Number.parseFloat(
        window.getComputedStyle(grid).getPropertyValue('--calendario-row-height'),
      );
      const defaultScrollTop =
        (DEFAULT_VISIBLE_START_MINUTES / SLOT_MINUTES) *
        (Number.isFinite(rowHeight) ? rowHeight : 22);

      grid.scrollTop = defaultScrollTop;
    };
    const firstAnimationFrame = window.requestAnimationFrame(() => {
      scrollToDefaultTime();

      window.requestAnimationFrame(scrollToDefaultTime);
    });
    const timeout = window.setTimeout(scrollToDefaultTime, 120);

    return () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      window.clearTimeout(timeout);
    };
  }, [isActive, shouldShowCalendar]);

  const selectCalendarMonth = (month: Date) => {
    setWeekStart(startOfSundayWeek(month));
  };

  const getFilteredCalendarAulaOptions = (searchValue: string) => {
    const searchKey = normalizeDropdownKey(searchValue);

    return searchKey
      ? aulaCatalogOptions.filter((option) =>
          normalizeDropdownKey(option.name).includes(searchKey),
        )
      : aulaCatalogOptions;
  };

  const getFilteredCalendarValueOptions = (
    field: Exclude<CronogramaEventField, 'lesson'>,
    searchValue: string,
  ) => {
    const options =
      field === 'turma'
        ? turmaNames
        : field === 'instructor'
          ? calendarInstructorOptions
          : calendarRoomOptions;
    const searchKey = normalizeDropdownKey(searchValue);

    return searchKey
      ? options.filter((option) => normalizeDropdownKey(option).includes(searchKey))
      : options;
  };

  const updateCalendarFieldEditorStyle = (
    blockId: string,
    field: CronogramaEventField,
  ) => {
    const anchor = calendarGridRef.current?.querySelector<HTMLElement>(
      `[data-schedule-field-anchor="${blockId}-${field}"]`,
    );

    if (!anchor) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const gridBottom =
      calendarGridRef.current?.getBoundingClientRect().bottom ??
      window.innerHeight;
    const maxDropdownHeight = Math.max(
      92,
      Math.round(gridBottom - anchorRect.bottom - 10),
    );
    const lessonMaxDropdownHeight = 234;
    const targetWidth =
      field === 'lesson' ? Math.max(anchorRect.width, 340) : anchorRect.width;
    const dropdownWidth = Math.min(targetWidth, window.innerWidth - 24);
    const dropdownLeft = Math.min(
      Math.round(anchorRect.left),
      Math.max(12, Math.round(window.innerWidth - dropdownWidth - 12)),
    );

    setActiveCalendarFieldEditor((currentEditor) => {
      if (
        !currentEditor ||
        currentEditor.blockId !== blockId ||
        currentEditor.field !== field
      ) {
        return currentEditor;
      }

      return {
        ...currentEditor,
        style: {
          left: dropdownLeft,
          top: Math.round(anchorRect.bottom + 4),
          width: Math.round(dropdownWidth),
          maxHeight:
            field === 'lesson'
              ? Math.min(maxDropdownHeight, lessonMaxDropdownHeight)
              : maxDropdownHeight,
          visibility: 'visible',
        },
      };
    });
  };

  const openCalendarFieldEditor = (
    block: CalendarEventBlock,
    field: CronogramaEventField,
  ) => {
    const draftValue =
      field === 'lesson'
        ? ''
        : field === 'turma'
          ? ''
          : field === 'instructor'
            ? block.instructor
            : block.room;
    const nextEditor: ActiveCalendarFieldEditor = {
      blockId: block.id,
      field,
      draftValue,
      style: { visibility: 'hidden' },
    };

    activeCalendarFieldEditorRef.current = nextEditor;
    setActiveCalendarFieldEditor(nextEditor);
  };

  const updateCalendarFieldEditorDraft = (value: string) => {
    setActiveCalendarFieldEditor((currentEditor) => {
      if (!currentEditor) {
        return currentEditor;
      }

      const nextEditor = {
        ...currentEditor,
        draftValue: value,
      };

      activeCalendarFieldEditorRef.current = nextEditor;
      return nextEditor;
    });
  };

  const cancelCalendarFieldEditor = () => {
    activeCalendarFieldEditorRef.current = null;
    setActiveCalendarFieldEditor(null);
  };

  const updateCalendarBlockValues = async (
    blockId: string,
    values: {
      lessonId?: string;
      lesson?: string;
      nextTurmaName?: string;
      nextDateKey?: string;
      nextStartMinutes?: number;
      nextEndMinutes?: number;
      instructor?: string;
      room?: string;
      color?: string;
    },
  ) => {
    if (blockHasAttendance(blockId)) {
      warnBlockedEventWithAttendance('alterado');
      return false;
    }

    const sheet = latestCronogramaSheetRef.current;

    if (!sheet) {
      return false;
    }

    const currentRowIndex = sheet.rows.findIndex(
      (row) => getCronogramaRowId(sheet, row) === blockId,
    );

    if (currentRowIndex < 0) {
      return false;
    }

    const currentRow = sheet.rows[currentRowIndex];
    const currentBlock = buildCalendarEventBlocks(sheet).find(
      (block) => block.id === blockId,
    );

    if (!currentBlock) {
      return false;
    }

    const nextRow = getCronogramaRowWithBlockValues(sheet, currentRow, {
      id: blockId,
      turmaName: values.nextTurmaName ?? currentBlock.turma,
      dateKey: values.nextDateKey ?? currentBlock.dateKey,
      startMinutes: values.nextStartMinutes ?? currentBlock.startMinutes,
      endMinutes: values.nextEndMinutes ?? currentBlock.endMinutes,
      ...values,
    });

    if (nextRow.join('\u0000') === currentRow.join('\u0000')) {
      return false;
    }

    const nextSheet = replaceCronogramaRow(sheet, currentRowIndex, nextRow);
    latestCronogramaSheetRef.current = nextSheet;
    setCronogramaSheet(nextSheet);
    const savedSheet = await saveCronogramaSheetToSourceFile(nextSheet);

    if (!savedSheet) {
      latestCronogramaSheetRef.current = sheet;
      setCronogramaSheet(sheet);
      showWarningToast('Não foi possível salvar a alteração do evento.');
      return false;
    }

    latestCronogramaSheetRef.current = savedSheet;
    setCronogramaSheet(savedSheet);
    await persistCronogramaDataIndex(savedSheet);
    markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
    pushGlobalUndoEntry({
      originTab: 'calendario',
      kind: 'cronograma-update',
      itemRef: blockId,
      itemLabel: values.lesson || currentBlock.lesson || blockId,
      rowIndex: currentRowIndex,
      previousRowValues: currentRow,
      nextRowValues: nextRow,
    });
    window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
    return true;
  };

  const createCalendarBlock = async (date: Date, startMinutes: number) => {
    const sheet =
      latestCronogramaSheetRef.current ?? {
        fileName: 'DadosElevar.xlsx',
        sheetName: CRONOGRAMA_WORKBOOK_SHEET,
        importedAt: new Date().toISOString(),
        columns: [...CRONOGRAMA_REQUIRED_COLUMNS],
        rows: [],
      };
    const id = generateStableRecordId(CRONOGRAMA_ENTITY_ID);
    const nextRow = getCronogramaRowWithValues(sheet, {
      [CRONOGRAMA_ID_COLUMN]: id,
      [TURMA_COLUMN]: '',
      [CRONOGRAMA_DATE_COLUMN]: formatDateKey(date),
      [CRONOGRAMA_START_COLUMN]: formatTimeLabel(startMinutes),
      [CRONOGRAMA_END_COLUMN]: formatTimeLabel(
        startMinutes + CRONOGRAMA_DEFAULT_DURATION_MINUTES,
      ),
      [CRONOGRAMA_TYPE_COLUMN]: DEFAULT_CRONOGRAMA_BLOCK_TYPE,
      [CRONOGRAMA_LESSON_ID_COLUMN]: '',
      [CRONOGRAMA_LESSON_COLUMN]: '',
      [TURMA_INSTRUCTOR_COLUMN]: '',
      [TURMA_ROOM_COLUMN]: '',
      [CRONOGRAMA_COLOR_COLUMN]: DEFAULT_CRONOGRAMA_BLOCK_COLOR,
    });
    const nextSheet = {
      ...sheet,
      rows: [...sheet.rows, nextRow],
    };

    latestCronogramaSheetRef.current = nextSheet;
    setCronogramaSheet(nextSheet);
    const savedSheet = await saveCronogramaSheetToSourceFile(nextSheet);

    if (!savedSheet) {
      latestCronogramaSheetRef.current = sheet;
      setCronogramaSheet(sheet);
      showWarningToast('Não foi possível criar o evento.');
      return;
    }

    latestCronogramaSheetRef.current = savedSheet;
    setCronogramaSheet(savedSheet);
    await persistCronogramaDataIndex(savedSheet);
    markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
    pushGlobalUndoEntry({
      originTab: 'calendario',
      kind: 'cronograma-insert',
      itemRef: id,
      itemLabel: id,
      rowIndex: sheet.rows.length,
      rowValues: nextRow,
    });
    window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
    activeCalendarFieldEditorRef.current = {
      blockId: id,
      field: 'lesson',
      draftValue: '',
      style: { visibility: 'hidden' },
    };
    setActiveCalendarFieldEditor(activeCalendarFieldEditorRef.current);
  };

  const selectCalendarAula = async (
    editor: ActiveCalendarFieldEditor,
    option: AulaCatalogOption,
  ) => {
    const currentBlock = buildCalendarEventBlocks(
      latestCronogramaSheetRef.current,
    ).find((block) => block.id === editor.blockId);

    cancelCalendarFieldEditor();
    const didUpdate = await updateCalendarBlockValues(editor.blockId, {
      lessonId: option.id,
      lesson: option.name,
      instructor: option.defaultInstructor || currentBlock?.instructor || '',
      room: option.defaultRoom || currentBlock?.room || '',
      color: option.color,
    });

    if (
      didUpdate &&
      activeAttendancePanel?.blockId === editor.blockId &&
      Object.values(attendanceDraft).some(Boolean)
    ) {
      const updatedBlock = buildCalendarEventBlocks(
        latestCronogramaSheetRef.current,
      ).find((block) => block.id === editor.blockId);

      if (updatedBlock) {
        await saveAttendanceForBlock(updatedBlock, attendanceDraft);
      }
    }
  };

  const commitCalendarFieldEditor = async (
    editor = activeCalendarFieldEditorRef.current,
  ) => {
    if (!editor) {
      return;
    }

    if (editor.field === 'lesson') {
      cancelCalendarFieldEditor();
      return;
    }

    const nextValue = editor.draftValue.trim();
    cancelCalendarFieldEditor();

    if (editor.field === 'turma' && !nextValue) {
      return;
    }

    const canonicalTurmaName =
      editor.field === 'turma'
        ? getCanonicalDropdownValue(nextValue, turmaNames)
        : null;

    if (editor.field === 'turma' && !canonicalTurmaName) {
      showWarningToast(
        turmaNames.length > 0
          ? 'Selecione uma turma cadastrada para vincular este evento.'
          : 'Cadastre uma turma antes de vincular este evento.',
      );
      return;
    }

    await updateCalendarBlockValues(
      editor.blockId,
      editor.field === 'turma'
        ? { nextTurmaName: canonicalTurmaName ?? nextValue }
        : editor.field === 'instructor'
          ? { instructor: nextValue }
          : { room: nextValue },
    );
  };

  const deleteCalendarBlock = async (block: CalendarEventBlock) => {
    if (blockHasAttendance(block.id)) {
      warnBlockedEventWithAttendance('deletado');
      return;
    }

    const sheet = latestCronogramaSheetRef.current;

    if (!sheet) {
      return;
    }

    const currentRowIndex = sheet.rows.findIndex(
      (row) => getCronogramaRowId(sheet, row) === block.id,
    );

    if (currentRowIndex < 0) {
      return;
    }

    const deletedRow = sheet.rows[currentRowIndex];
    const nextSheet: SheetTable = {
      ...sheet,
      rows: sheet.rows.filter((_, rowIndex) => rowIndex !== currentRowIndex),
    };

    latestCronogramaSheetRef.current = nextSheet;
    setCronogramaSheet(nextSheet);
    const savedSheet = await saveCronogramaSheetToSourceFile(nextSheet);

    if (!savedSheet) {
      latestCronogramaSheetRef.current = sheet;
      setCronogramaSheet(sheet);
      showWarningToast('Não foi possível deletar o evento.');
      return;
    }

    latestCronogramaSheetRef.current = savedSheet;
    setCronogramaSheet(savedSheet);
    await persistCronogramaDataIndex(savedSheet);
    markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
    pushGlobalUndoEntry({
      originTab: 'calendario',
      kind: 'cronograma-delete',
      itemRef: block.id,
      itemLabel: block.lesson || block.id,
      rowIndex: currentRowIndex,
      rowValues: deletedRow,
    });
    window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
  };

  const getCalendarPointerTarget = (
    pointer: ActiveCalendarPointer,
    clientX: number,
    clientY: number,
  ) => {
    const gridRect = pointer.grid.getBoundingClientRect();
    const scheduleWidth = Math.max(
      1,
      pointer.grid.scrollWidth - pointer.timeColumnWidth,
    );
    const dateColumnWidth = scheduleWidth / Math.max(1, weekDates.length);
    const contentX = clientX - gridRect.left + pointer.grid.scrollLeft;
    const contentY = clientY - gridRect.top + pointer.grid.scrollTop;
    const dateIndex = clampNumber(
      Math.floor((contentX - pointer.timeColumnWidth) / dateColumnWidth),
      0,
      weekDates.length - 1,
    );
    const rawMinutes =
      ((contentY - pointer.rowHeight) / pointer.rowHeight) * SLOT_MINUTES;

    return {
      date: weekDates[dateIndex] ?? weekDates[0],
      minutes: clampNumber(snapMinutes(rawMinutes), 0, MINUTES_PER_DAY),
    };
  };

  const previewCalendarBlockRow = (
    pointer: ActiveCalendarPointer,
    clientX: number,
    clientY: number,
  ) => {
    const sheet = latestCronogramaSheetRef.current;

    if (!sheet) {
      return null;
    }

    const currentRowIndex = sheet.rows.findIndex(
      (row) => getCronogramaRowId(sheet, row) === pointer.blockId,
    );

    if (currentRowIndex < 0) {
      return null;
    }

    const currentBlock = buildCalendarEventBlocks(sheet).find(
      (block) => block.id === pointer.blockId,
    );

    if (!currentBlock) {
      return null;
    }

    const target = getCalendarPointerTarget(pointer, clientX, clientY);
    const currentDuration = Math.max(
      CRONOGRAMA_MIN_DURATION_MINUTES,
      currentBlock.endMinutes - currentBlock.startMinutes,
    );
    let nextStart = currentBlock.startMinutes;
    let nextEnd = currentBlock.endMinutes;
    let nextDateKey = currentBlock.dateKey;

    if (pointer.mode === 'move') {
      nextDateKey = formatDateKey(target.date);
      nextStart = clampNumber(
        target.minutes - pointer.grabbedOffsetMinutes,
        0,
        MINUTES_PER_DAY - CRONOGRAMA_SNAP_MINUTES,
      );
      nextStart = snapMinutes(nextStart);
      nextEnd = nextStart + currentDuration;
    } else if (pointer.mode === 'resize-start') {
      nextStart = clampNumber(
        target.minutes,
        0,
        currentBlock.endMinutes - CRONOGRAMA_MIN_DURATION_MINUTES,
      );
      nextStart = snapMinutes(nextStart);
    } else {
      nextEnd = clampNumber(
        target.minutes,
        currentBlock.startMinutes + CRONOGRAMA_MIN_DURATION_MINUTES,
        MINUTES_PER_DAY,
      );
      nextEnd = snapMinutes(nextEnd);
    }

    const nextRow = getCronogramaRowWithBlockValues(
      sheet,
      sheet.rows[currentRowIndex],
      {
        id: pointer.blockId,
        turmaName: currentBlock.turma,
        dateKey: nextDateKey,
        startMinutes: nextStart,
        endMinutes: nextEnd,
      },
    );
    const nextSheet = replaceCronogramaRow(sheet, currentRowIndex, nextRow);

    latestCronogramaSheetRef.current = nextSheet;
    setCronogramaSheet(nextSheet);
    return nextRow;
  };

  const commitCalendarBlockUpdate = async (
    blockId: string,
    originalRowIndex: number,
    originalRow: string[],
    nextRow: string[] | null,
  ) => {
    if (!nextRow) {
      return;
    }

    if (blockHasAttendance(blockId)) {
      const revertedSheet = latestCronogramaSheetRef.current
        ? replaceCronogramaRow(
            latestCronogramaSheetRef.current,
            originalRowIndex,
            originalRow,
          )
        : null;

      if (revertedSheet) {
        latestCronogramaSheetRef.current = revertedSheet;
        setCronogramaSheet(revertedSheet);
      }

      warnBlockedEventWithAttendance('movido');
      return;
    }

    const sheet = latestCronogramaSheetRef.current;

    if (!sheet) {
      return;
    }

    const currentRowIndex = sheet.rows.findIndex(
      (row) => getCronogramaRowId(sheet, row) === blockId,
    );

    if (currentRowIndex < 0) {
      return;
    }

    const currentRow = sheet.rows[currentRowIndex];

    if (currentRow.join('\u0000') === originalRow.join('\u0000')) {
      return;
    }

    const savedSheet = await saveCronogramaSheetToSourceFile(sheet);

    if (!savedSheet) {
      const revertedSheet = replaceCronogramaRow(
        sheet,
        currentRowIndex,
        originalRow,
      );

      latestCronogramaSheetRef.current = revertedSheet;
      setCronogramaSheet(revertedSheet);
      showWarningToast('Não foi possível mover o evento.');
      return;
    }

    latestCronogramaSheetRef.current = savedSheet;
    setCronogramaSheet(savedSheet);
    await persistCronogramaDataIndex(savedSheet);
    markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
    pushGlobalUndoEntry({
      originTab: 'calendario',
      kind: 'cronograma-update',
      itemRef: blockId,
      itemLabel:
        getCellValue(savedSheet, savedSheet.rows[currentRowIndex], CRONOGRAMA_LESSON_COLUMN) ||
        blockId,
      rowIndex: currentRowIndex,
      previousRowValues: originalRow,
      nextRowValues: currentRow,
    });
    window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
  };

  const startCalendarBlockPointer = (
    event: PointerEvent<HTMLElement>,
    block: CalendarEventSegment,
    mode: CalendarPointerMode,
  ) => {
    if (event.button !== 0) {
      return;
    }

    if (activeCalendarFieldEditorRef.current) {
      return;
    }

    if (blockHasAttendance(block.id)) {
      event.preventDefault();
      event.stopPropagation();
      warnBlockedEventWithAttendance('movido');
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const grid = calendarGridRef.current;
    const sheet = latestCronogramaSheetRef.current;

    if (!grid || !sheet) {
      return;
    }

    const currentRowIndex = sheet.rows.findIndex(
      (row) => getCronogramaRowId(sheet, row) === block.id,
    );

    if (currentRowIndex < 0) {
      return;
    }

    const rowHeight = Number.parseFloat(
      window.getComputedStyle(grid).getPropertyValue('--calendario-row-height'),
    );
    const blockRect = event.currentTarget.getBoundingClientRect();
    const grabbedOffsetMinutes =
      mode === 'move'
        ? clampNumber(
            ((event.clientY - blockRect.top) /
              (Number.isFinite(rowHeight) ? rowHeight : 22)) *
              SLOT_MINUTES,
            0,
            Math.max(CRONOGRAMA_MIN_DURATION_MINUTES, block.endMinutes - block.startMinutes),
          )
        : 0;

    activeCalendarPointerRef.current = {
      blockId: block.id,
      mode,
      originalRow: [...sheet.rows[currentRowIndex]],
      originalRowIndex: currentRowIndex,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
      didMove: false,
      grabbedOffsetMinutes,
      rowHeight: Number.isFinite(rowHeight) ? rowHeight : 22,
      timeColumnWidth: 62,
      grid,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const isCronogramaUndoEntry = (
    entry: GlobalUndoEntry,
  ): entry is GlobalUndoEntry & {
    kind: 'cronograma-insert' | 'cronograma-update' | 'cronograma-delete';
    rowIndex: number;
  } =>
    (entry.kind === 'cronograma-insert' ||
      entry.kind === 'cronograma-update' ||
      entry.kind === 'cronograma-delete') &&
      typeof entry.rowIndex === 'number';

  const normalizeUndoSheetSnapshot = (value: unknown): SheetTable | null => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as SheetTable).columns) ||
      !Array.isArray((value as SheetTable).rows)
    ) {
      return null;
    }

    return cloneSheetSnapshot({
      fileName:
        typeof (value as SheetTable).fileName === 'string'
          ? (value as SheetTable).fileName
          : 'DadosElevar.xlsx',
      sheetName:
        typeof (value as SheetTable).sheetName === 'string'
          ? (value as SheetTable).sheetName
          : '',
      importedAt:
        typeof (value as SheetTable).importedAt === 'string'
          ? (value as SheetTable).importedAt
          : new Date().toISOString(),
      columns: (value as SheetTable).columns.map((column) =>
        String(column ?? ''),
      ),
      rows: (value as SheetTable).rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
      ),
    });
  };

  const normalizeAttendanceUndoSnapshot = (
    value: unknown,
  ): AcademicAttendanceUndoSnapshot | null => {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const snapshot = value as Partial<AcademicAttendanceUndoSnapshot>;
    const presencasSnapshot = normalizeUndoSheetSnapshot(
      snapshot.presencasSheet,
    );
    const horasSnapshot = normalizeUndoSheetSnapshot(
      snapshot.horasAplicadasSheet,
    );
    const progressoSnapshot = normalizeUndoSheetSnapshot(
      snapshot.planoProgressoSheet,
    );

    if (!presencasSnapshot || !horasSnapshot || !progressoSnapshot) {
      return null;
    }

    return {
      presencasSheet: presencasSnapshot,
      horasAplicadasSheet: horasSnapshot,
      planoProgressoSheet: progressoSnapshot,
    };
  };

  const isAttendanceUndoEntry = (
    entry: GlobalUndoEntry,
  ): entry is GlobalUndoEntry & {
    kind: 'attendance-save';
    previousAcademicSheets: AcademicAttendanceUndoSnapshot;
    nextAcademicSheets: AcademicAttendanceUndoSnapshot;
  } =>
    entry.kind === 'attendance-save' &&
    Boolean(normalizeAttendanceUndoSnapshot(entry.previousAcademicSheets)) &&
    Boolean(normalizeAttendanceUndoSnapshot(entry.nextAcademicSheets));

  const refreshOpenAttendanceDraftFromSnapshot = () => {
    const panel = activeAttendancePanelRef.current;

    if (!panel) {
      return;
    }

    const activeBlock = buildCalendarEventBlocks(
      latestCronogramaSheetRef.current,
    ).find((block) => block.id === panel.blockId);

    if (!activeBlock) {
      setActiveAttendancePanel(null);
      return;
    }

    setAttendanceDraft(getAttendanceDraftForBlock(activeBlock));
  };

  const restoreAttendanceSnapshot = async (
    snapshot: AcademicAttendanceUndoSnapshot,
  ) => {
    try {
      const savedFile = await saveWorkbookSheets([
        cloneSheetSnapshot(snapshot.presencasSheet),
        cloneSheetSnapshot(snapshot.horasAplicadasSheet),
        cloneSheetSnapshot(snapshot.planoProgressoSheet),
      ]);

      latestPresencasSheetRef.current = cloneSheetSnapshot(snapshot.presencasSheet);
      setPresencasSheet(latestPresencasSheetRef.current);
      latestHorasAplicadasSheetRef.current = cloneSheetSnapshot(
        snapshot.horasAplicadasSheet,
      );
      setHorasAplicadasSheet(latestHorasAplicadasSheetRef.current);
      latestPlanoProgressoSheetRef.current = cloneSheetSnapshot(
        snapshot.planoProgressoSheet,
      );
      setPlanoProgressoSheet(latestPlanoProgressoSheetRef.current);

      if (savedFile) {
        await persistManagedWorkbookDataIndexes(savedFile);
        window.dispatchEvent(
          new CustomEvent(GLOBAL_DATA_CHANGED_EVENT, {
            detail: {
              file: savedFile,
              fileName: savedFile.name,
              reason: 'attendance-restore',
              force: true,
            },
          }),
        );
      } else {
        await persistManagedWorkbookDataIndexes(null);
        window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
      }

      refreshOpenAttendanceDraftFromSnapshot();
      await fetchRecoveryInfo();
      return true;
    } catch {
      showWarningToast('Não foi possível restaurar a presença.');
      return false;
    }
  };

  const saveCronogramaHistorySheet = async (nextSheet: SheetTable) => {
    latestCronogramaSheetRef.current = nextSheet;
    setCronogramaSheet(nextSheet);
    const savedSheet = await saveCronogramaSheetToSourceFile(nextSheet);

    if (!savedSheet) {
      return false;
    }

    latestCronogramaSheetRef.current = savedSheet;
    setCronogramaSheet(savedSheet);
    await persistCronogramaDataIndex(savedSheet);
    markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
    window.dispatchEvent(new Event(GLOBAL_DATA_CHANGED_EVENT));
    return true;
  };

  const undoCronogramaActionAndSave = async (entry: GlobalUndoEntry) => {
    if (isAttendanceUndoEntry(entry)) {
      const snapshot = normalizeAttendanceUndoSnapshot(
        entry.previousAcademicSheets,
      );

      return snapshot ? restoreAttendanceSnapshot(snapshot) : false;
    }

    if (!isCronogramaUndoEntry(entry)) {
      return false;
    }

    const currentSheet = latestCronogramaSheetRef.current;

    if (!currentSheet) {
      return false;
    }

    if (entry.kind === 'cronograma-insert') {
      const rowValues = Array.isArray(entry.rowValues) ? entry.rowValues : [];
      const rowId = getCronogramaRowId(currentSheet, rowValues);
      const nextSheet = {
        ...currentSheet,
        rows: currentSheet.rows.filter(
          (row, rowIndex) =>
            rowIndex !== entry.rowIndex &&
            getCronogramaRowId(currentSheet, row) !== rowId,
        ),
      };

      return saveCronogramaHistorySheet(nextSheet);
    }

    if (entry.kind === 'cronograma-delete') {
      const rowValues = Array.isArray(entry.rowValues) ? entry.rowValues : null;

      if (!rowValues) {
        return false;
      }

      const nextRows = [...currentSheet.rows];
      nextRows.splice(entry.rowIndex, 0, rowValues);

      return saveCronogramaHistorySheet({
        ...currentSheet,
        rows: nextRows,
      });
    }

    if (!Array.isArray(entry.previousRowValues)) {
      return false;
    }

    return saveCronogramaHistorySheet(
      replaceCronogramaRow(currentSheet, entry.rowIndex, entry.previousRowValues),
    );
  };

  const redoCronogramaActionAndSave = async (entry: GlobalUndoEntry) => {
    if (isAttendanceUndoEntry(entry)) {
      const snapshot = normalizeAttendanceUndoSnapshot(entry.nextAcademicSheets);

      return snapshot ? restoreAttendanceSnapshot(snapshot) : false;
    }

    if (!isCronogramaUndoEntry(entry)) {
      return false;
    }

    const currentSheet = latestCronogramaSheetRef.current;

    if (!currentSheet) {
      return false;
    }

    if (entry.kind === 'cronograma-insert') {
      const rowValues = Array.isArray(entry.rowValues) ? entry.rowValues : null;

      if (!rowValues) {
        return false;
      }

      const nextRows = [...currentSheet.rows];
      nextRows.splice(entry.rowIndex, 0, rowValues);

      return saveCronogramaHistorySheet({
        ...currentSheet,
        rows: nextRows,
      });
    }

    if (entry.kind === 'cronograma-delete') {
      const rowValues = Array.isArray(entry.rowValues) ? entry.rowValues : [];
      const rowId = getCronogramaRowId(currentSheet, rowValues);
      const nextSheet = {
        ...currentSheet,
        rows: currentSheet.rows.filter(
          (row, rowIndex) =>
            rowIndex !== entry.rowIndex &&
            getCronogramaRowId(currentSheet, row) !== rowId,
        ),
      };

      return saveCronogramaHistorySheet(nextSheet);
    }

    if (!Array.isArray(entry.nextRowValues)) {
      return false;
    }

    return saveCronogramaHistorySheet(
      replaceCronogramaRow(currentSheet, entry.rowIndex, entry.nextRowValues),
    );
  };

  useEffect(
    () =>
      registerGlobalUndoController('calendario', {
        undo: undoCronogramaActionAndSave,
        redo: redoCronogramaActionAndSave,
      }),
    [],
  );

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const pointer = activeCalendarPointerRef.current;

      if (!pointer) {
        return;
      }

      const moveDistance = Math.hypot(
        event.clientX - pointer.initialClientX,
        event.clientY - pointer.initialClientY,
      );

      if (!pointer.didMove && moveDistance < 3) {
        return;
      }

      pointer.didMove = true;
      previewCalendarBlockRow(pointer, event.clientX, event.clientY);
    };

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const pointer = activeCalendarPointerRef.current;

      if (!pointer) {
        return;
      }

      const nextRow = previewCalendarBlockRow(
        pointer,
        event.clientX,
        event.clientY,
      );

      activeCalendarPointerRef.current = null;
      if (!pointer.didMove) {
        return;
      }

      void commitCalendarBlockUpdate(
        pointer.blockId,
        pointer.originalRowIndex,
        pointer.originalRow,
        nextRow,
      );
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [weekDates]);

  useLayoutEffect(() => {
    if (!activeCalendarFieldEditor) {
      return;
    }

    updateCalendarFieldEditorStyle(
      activeCalendarFieldEditor.blockId,
      activeCalendarFieldEditor.field,
    );

    window.requestAnimationFrame(() => {
      const input = calendarFieldInputRef.current;

      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }, [
    activeCalendarFieldEditor?.blockId,
    activeCalendarFieldEditor?.field,
  ]);

  useEffect(() => {
    if (!activeCalendarFieldEditor) {
      return;
    }

    const closeCalendarEditorOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.closest('.turma-schedule-field-editor')) {
        return;
      }

      const editor = activeCalendarFieldEditorRef.current;

      if (!editor) {
        return;
      }

      const targetFieldAnchor = target?.closest<HTMLElement>(
        '[data-schedule-field-anchor]',
      );

      if (
        targetFieldAnchor?.dataset.scheduleFieldAnchor ===
        `${editor.blockId}-${editor.field}`
      ) {
        return;
      }

      if (editor.field === 'lesson') {
        cancelCalendarFieldEditor();
        return;
      }

      void commitCalendarFieldEditor(editor);
    };

    window.addEventListener('mousedown', closeCalendarEditorOnOutsideClick);

    return () => {
      window.removeEventListener('mousedown', closeCalendarEditorOnOutsideClick);
    };
  }, [activeCalendarFieldEditor]);

  return (
    <section
      className="feature-page calendario-page"
      aria-labelledby={titleId}
      data-active={isActive ? 'true' : 'false'}
    >
      <h1 className="visually-hidden" id={titleId}>
        Calendário
      </h1>

      {shouldShowImportState && <EmptyWorkbookImportState />}

      {shouldShowCalendar && (
        <div className="data-table-panel calendario-data-panel">
          <div
            ref={calendarGridRef}
            className="calendario-week-grid"
            role="grid"
            aria-label="Cronograma semanal"
            style={gridStyle}
          >
            <div className="calendario-week-corner">
              <MonthYearPicker
                label={monthLabel}
                value={weekStart}
                ariaLabel="Selecionar mes do calendario"
                onSelectMonth={selectCalendarMonth}
              />
            </div>
            {weekDates.map((date, dateIndex) => (
              <div
                className={
                  dateIndex === weekDates.length - 1
                    ? 'calendario-week-day-header last'
                    : 'calendario-week-day-header'
                }
                key={formatDateKey(date)}
                role="columnheader"
              >
                {dateIndex === 0 && (
                  <button
                    className="calendario-week-nav-button calendario-week-nav-button-previous"
                    type="button"
                    aria-label="Semana anterior"
                    onClick={() => moveWeek(-1)}
                  >
                    <ChevronIcon />
                  </button>
                )}
                <span>
                  {WEEK_DAY_LABELS[dateIndex]} - {formatCalendarDateLabel(date)}
                </span>
                {dateIndex === weekDates.length - 1 && (
                  <button
                    className="calendario-week-nav-button calendario-week-nav-button-next"
                    type="button"
                    aria-label="Próxima semana"
                    onClick={() => moveWeek(1)}
                  >
                    <ChevronIcon />
                  </button>
                )}
              </div>
            ))}

            {timeSlots.map((slotMinutes, slotIndex) => {
              const isMajorSlot = slotMinutes % 30 === 0;
              const isQuarterSlot = !isMajorSlot;
              const isFooterSlot = slotMinutes === MINUTES_PER_DAY;
              const lineClass = isMajorSlot
                ? 'major'
                : isQuarterSlot
                  ? 'quarter'
                  : '';
              const timeLabelClass = [
                'calendario-week-time-label',
                lineClass,
                slotIndex === 0 ? 'first-slot' : '',
                isFooterSlot ? 'footer-time' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div className="calendario-week-row" key={slotMinutes}>
                  <div className={timeLabelClass}>
                    {isMajorSlot ? <span>{formatTimeLabel(slotMinutes)}</span> : null}
                  </div>
                  {weekDates.map((date, dateIndex) => (
                    (() => {
                      const dateKey = formatDateKey(date);
                      const slotSegments =
                        eventSegmentsByDateAndSlot.get(`${dateKey}-${slotMinutes}`) ??
                        [];

                      return (
                        <div
                          className={[
                            'calendario-week-slot',
                            lineClass,
                            slotIndex === 0 ? 'first-slot' : '',
                            isFooterSlot ? 'footer-slot' : '',
                            dateIndex === weekDates.length - 1 ? 'last' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          key={`${dateKey}-${slotMinutes}`}
                          data-slot-minutes={slotMinutes}
                        >
                          {!isFooterSlot ? (
                            <button
                              className="turma-schedule-slot-add calendario-slot-add"
                              type="button"
                              onClick={() =>
                                void createCalendarBlock(date, slotMinutes)
                              }
                            >
                              <PlusIcon />
                              <span>Adicionar aula</span>
                            </button>
                          ) : null}
                        {slotSegments.map((segment) => {
                          const displaySegment = resolveLiveAulaForUnconfirmedBlock(
                            segment,
                            aulaCatalogOptions,
                            blockHasAttendance(segment.id),
                          );
                          const activeBlockField =
                            activeCalendarFieldEditor?.blockId === displaySegment.id
                              ? activeCalendarFieldEditor.field
                              : null;

                          return (
                              <CronogramaEventBlock
                                activeDraftValue={
                                  activeBlockField && activeCalendarFieldEditor
                                    ? activeCalendarFieldEditor.draftValue
                                    : ''
                                }
                                activeField={activeBlockField}
                                block={{
                                  id: displaySegment.id,
                                  lesson: displaySegment.lesson,
                                  type: displaySegment.type,
                                  turma: displaySegment.turma,
                                  instructor: displaySegment.instructor,
                                  room: displaySegment.room,
                                  startLabel: formatTimeLabel(
                                    displaySegment.startMinutes,
                                  ),
                                  endLabel: formatTimeLabel(displaySegment.endMinutes),
                                  dateLabel: formatCalendarDateLabel(
                                    parseDateKey(displaySegment.dateKey) ?? new Date(),
                                  ),
                                }}
                                className="calendario-event-block"
                                heightRowUnits={displaySegment.heightRowUnits}
                                inputRef={calendarFieldInputRef}
                                key={displaySegment.segmentId}
                                style={
                                  {
                                    '--brand-primary': displaySegment.color,
                                    '--schedule-block-top': `calc(var(--calendario-row-height, 22px) * ${displaySegment.topRowUnits})`,
                                    '--schedule-block-height': `calc(var(--calendario-row-height, 22px) * ${displaySegment.heightRowUnits})`,
                                    '--calendar-event-lane': displaySegment.lane,
                                    '--calendar-event-lane-count':
                                      displaySegment.laneCount,
                                  } as CSSProperties
                                }
                                onCancelField={cancelCalendarFieldEditor}
                                onCommitField={(field, draftValue) => {
                                  const editor =
                                    activeCalendarFieldEditorRef.current;

                                  if (!editor) {
                                    return;
                                  }

                                  if (field === 'lesson') {
                                    const aulaOptions =
                                      getFilteredCalendarAulaOptions(draftValue);

                                    if (aulaOptions.length === 1) {
                                      void selectCalendarAula(
                                        {
                                          ...editor,
                                          draftValue,
                                        },
                                        aulaOptions[0],
                                      );
                                    }
                                    return;
                                  }

                                  void commitCalendarFieldEditor({
                                    ...editor,
                                    draftValue,
                                  });
                                }}
                                onDelete={() => void deleteCalendarBlock(displaySegment)}
                                onDraftChange={updateCalendarFieldEditorDraft}
                                onOpenAttendance={() => openAttendancePanel(displaySegment)}
                                onOpenField={(field) =>
                                  openCalendarFieldEditor(displaySegment, field)
                                }
                                onPointerDown={(event) =>
                                  startCalendarBlockPointer(
                                    event,
                                    displaySegment,
                                    'move',
                                  )
                                }
                                onResizeEnd={(event) =>
                                  startCalendarBlockPointer(
                                    event,
                                    displaySegment,
                                    'resize-end',
                                  )
                                }
                                onResizeStart={(event) =>
                                  startCalendarBlockPointer(
                                    event,
                                    displaySegment,
                                    'resize-start',
                                  )
                                }
                              />
                            );
                          })}
                        </div>
                      );
                    })()
                  ))}
                </div>
              );
            })}
          </div>
          {activeCalendarFieldEditor && (
            <div
              className={
                activeCalendarFieldEditor.field === 'lesson'
                  ? 'turma-schedule-field-editor lesson-options'
                  : 'turma-schedule-field-editor'
              }
              style={activeCalendarFieldEditor.style}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {activeCalendarFieldEditor.field === 'lesson' ? (
                <div className="turma-schedule-field-options">
                  {(() => {
                    const filteredOptions = getFilteredCalendarAulaOptions(
                      activeCalendarFieldEditor.draftValue,
                    );

                    return filteredOptions.length > 0 ? (
                      filteredOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            void selectCalendarAula(
                              activeCalendarFieldEditor,
                              option,
                            )
                          }
                        >
                          <span>{option.name}</span>
                        </button>
                      ))
                    ) : (
                      <div className="turma-schedule-field-empty">
                        {aulaCatalogOptions.length > 0
                          ? 'Nenhuma aula encontrada'
                          : 'Nenhuma aula cadastrada'}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="turma-schedule-field-options">
                  {(() => {
                    const filteredOptions = getFilteredCalendarValueOptions(
                      activeCalendarFieldEditor.field,
                      activeCalendarFieldEditor.draftValue,
                    );

                    return filteredOptions.length > 0 ? (
                      filteredOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateCalendarFieldEditorDraft(option);
                            void commitCalendarFieldEditor({
                              ...activeCalendarFieldEditor,
                              draftValue: option,
                            });
                          }}
                        >
                          <span>{option}</span>
                        </button>
                      ))
                    ) : (
                      <div className="turma-schedule-field-empty">
                        Nenhuma opcao cadastrada
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
          {activeAttendancePanel &&
            (() => {
              const baseActiveBlock = cronogramaBlocks.find(
                (block) => block.id === activeAttendancePanel.blockId,
              );
              const activeBlock = baseActiveBlock
                ? resolveLiveAulaForUnconfirmedBlock(
                    baseActiveBlock,
                    aulaCatalogOptions,
                    blockHasAttendance(baseActiveBlock.id),
                  )
                : null;
              const attendanceStudents = activeBlock
                ? getAttendanceStudentsForBlock(activeBlock)
                : [];

              if (!activeBlock) {
                return null;
              }

              return (
                <div
                  className="turma-attendance-panel"
                  style={activeAttendancePanel.style}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="turma-attendance-panel-header">
                    <div>
                      <strong>Presença</strong>
                      <span>{activeBlock.lesson || 'Selecionar aula'}</span>
                    </div>
                    <button
                      type="button"
                      aria-label="Fechar presença"
                      onClick={() => setActiveAttendancePanel(null)}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  <div className="turma-attendance-list">
                    {attendanceStudents.length > 0 ? (
                      attendanceStudents.map((student) => (
                        <label
                          className="turma-attendance-row"
                          key={student.aprendizId}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(attendanceDraft[student.aprendizId])}
                            disabled={isSavingAttendance}
                            onChange={(event) => {
                              const isChecked = event.currentTarget.checked;
                              const nextDraft = {
                                ...attendanceDraft,
                                [student.aprendizId]: isChecked,
                              };

                              setAttendanceDraft(nextDraft);
                              void saveAttendanceForBlock(activeBlock, nextDraft);
                            }}
                          />
                          <span>{student.aprendiz}</span>
                          <small>
                            {attendanceDraft[student.aprendizId]
                              ? 'Presente'
                              : 'Ausente'}
                          </small>
                        </label>
                      ))
                    ) : (
                      <div className="turma-attendance-empty">
                        Nenhum aprendiz nesta turma.
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
        </div>
      )}
      {warningToast && (
        <div className="app-warning-toast" role="status" aria-live="polite">
          {warningToast}
        </div>
      )}
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6 -6 6" />
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
