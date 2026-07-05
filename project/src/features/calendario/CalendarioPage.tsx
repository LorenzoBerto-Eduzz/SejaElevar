import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { GLOBAL_DATA_CHANGED_EVENT } from '../../shared/data/events';
import {
  ensureActiveWorkbookManagedSheets,
  fetchBaseWorkbookFileWithRetry,
  fetchRecoveryInfo,
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

export function CalendarioPage({
  canInitialize = true,
  isActive = true,
}: CalendarioPageProps) {
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const [hasActiveWorkbook, setHasActiveWorkbook] = useState(false);
  const [hasCheckedWorkbook, setHasCheckedWorkbook] = useState(false);
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

        setHasActiveWorkbook(Boolean(file) || globalWorkbookState.hasWorkbook);
        setHasCheckedWorkbook(true);

        if (file || globalWorkbookState.hasWorkbook) {
          markGlobalWorkbookAvailable(await fetchRecoveryInfo().catch(() => null));
        }
      } catch {
        if (!isMounted) {
          return;
        }

        setHasActiveWorkbook(globalWorkbookState.hasWorkbook);
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
                      key={`${formatDateKey(date)}-${slotMinutes}`}
                      data-slot-minutes={slotMinutes}
                    />
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
