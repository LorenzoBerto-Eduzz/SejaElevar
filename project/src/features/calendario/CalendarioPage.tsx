import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { GLOBAL_DATA_CHANGED_EVENT } from '../../shared/data/events';
import { getBaseWorkbookSheetByEntity } from '../../shared/data/baseWorkbook';
import { CRONOGRAMA_ENTITY_ID, type SheetTable } from '../../shared/data/dataIndex';
import { CRONOGRAMA_REQUIRED_COLUMNS, normalizeFieldLabel } from '../../shared/data/schemas';
import {
  ensureActiveWorkbookManagedSheets,
  fetchBaseWorkbookFileWithRetry,
  fetchRecoveryInfo,
  readWorkbookSheetFile,
} from '../../shared/data/workspaceData';
import {
  markGlobalWorkbookAvailable,
  useGlobalWorkbookState,
} from '../../shared/ui/GlobalWorkbookToolbar';
import { EmptyWorkbookImportState } from '../../shared/ui/EmptyWorkbookImportState';
import { MonthYearPicker } from '../../shared/ui/MonthYearPicker';

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
const CRONOGRAMA_WORKBOOK_SHEET =
  getBaseWorkbookSheetByEntity(CRONOGRAMA_ENTITY_ID)?.sheetName ?? 'Cronograma';
const TURMA_COLUMN = 'Turma';
const CRONOGRAMA_DATE_COLUMN = 'Data';
const CRONOGRAMA_START_COLUMN = 'Início';
const CRONOGRAMA_END_COLUMN = 'Fim';
const CRONOGRAMA_TYPE_COLUMN = 'Tipo';
const CRONOGRAMA_LESSON_COLUMN = 'Aula';
const TURMA_INSTRUCTOR_COLUMN = 'Instrutor';
const TURMA_ROOM_COLUMN = 'Sala';
const CRONOGRAMA_COLOR_COLUMN = 'Cor';
const CRONOGRAMA_ID_COLUMN = 'ID';
const DEFAULT_CRONOGRAMA_BLOCK_COLOR = '#2069df';
const DEFAULT_CRONOGRAMA_BLOCK_TYPE = 'Aula';

const padTimePart = (value: number) => String(value).padStart(2, '0');

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
  turma: string;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  type: string;
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
        turma,
        dateKey,
        startMinutes,
        endMinutes,
        type: getCellValue(sheet, row, CRONOGRAMA_TYPE_COLUMN) || DEFAULT_CRONOGRAMA_BLOCK_TYPE,
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

export function CalendarioPage({
  canInitialize = true,
  isActive = true,
}: CalendarioPageProps) {
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const [hasActiveWorkbook, setHasActiveWorkbook] = useState(false);
  const [hasCheckedWorkbook, setHasCheckedWorkbook] = useState(false);
  const [cronogramaSheet, setCronogramaSheet] = useState<SheetTable | null>(null);
  const [weekStart, setWeekStart] = useState(getStoredWeekStart);
  const globalWorkbookState = useGlobalWorkbookState();

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

        const nextCronogramaSheet = file
          ? await readCronogramaSheetFromFile(file)
          : null;

        if (!isMounted) {
          return;
        }

        setHasActiveWorkbook(Boolean(file) || globalWorkbookState.hasWorkbook);
        setCronogramaSheet(nextCronogramaSheet);
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
                          {slotSegments.map((segment) => (
                            <article
                              className="calendario-event-block"
                              key={segment.segmentId}
                              style={
                                {
                                  '--calendar-event-color': segment.color,
                                  '--calendar-event-top': `calc(var(--calendario-row-height, 22px) * ${segment.topRowUnits})`,
                                  '--calendar-event-height': `calc(var(--calendario-row-height, 22px) * ${segment.heightRowUnits})`,
                                  '--calendar-event-lane': segment.lane,
                                  '--calendar-event-lane-count': segment.laneCount,
                                } as CSSProperties
                              }
                            >
                              <div className="calendario-event-line calendario-event-main-line">
                                <span>{segment.lesson || segment.type}</span>
                              </div>
                              <div className="calendario-event-line">
                                <span>{segment.turma || '-'}</span>
                              </div>
                              <div className="calendario-event-line">
                                <span>
                                  {formatTimeLabel(segment.startMinutes)} -{' '}
                                  {formatTimeLabel(segment.endMinutes)}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      );
                    })()
                  ))}
                </div>
              );
            })}
          </div>
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
