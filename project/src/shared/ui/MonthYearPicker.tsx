import { useEffect, useRef, useState } from 'react';

type MonthYearPickerProps = {
  label: string;
  value: Date;
  ariaLabel: string;
  onSelectMonth: (month: Date) => void;
};

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

export function MonthYearPicker({
  label,
  value,
  ariaLabel,
  onSelectMonth,
}: MonthYearPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [displayYear, setDisplayYear] = useState(value.getFullYear());

  useEffect(() => {
    if (isOpen) {
      setDisplayYear(value.getFullYear());
    }
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="month-year-picker" ref={rootRef}>
      <button
        className="month-year-picker-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{label}</span>
      </button>

      {isOpen ? (
        <div
          className="month-year-picker-popover"
          role="dialog"
          aria-label={ariaLabel}
        >
          <div className="month-year-picker-header">
            <button
              className="month-year-picker-year-button"
              type="button"
              aria-label="Ano anterior"
              onClick={() => setDisplayYear((current) => current - 1)}
            >
              <ChevronIcon direction="previous" />
            </button>
            <span>{displayYear}</span>
            <button
              className="month-year-picker-year-button"
              type="button"
              aria-label="Proximo ano"
              onClick={() => setDisplayYear((current) => current + 1)}
            >
              <ChevronIcon direction="next" />
            </button>
          </div>
          <div className="month-year-picker-months">
            {MONTH_LABELS.map((monthLabel, monthIndex) => {
              const isSelected =
                value.getFullYear() === displayYear &&
                value.getMonth() === monthIndex;

              return (
                <button
                  className={
                    isSelected
                      ? 'month-year-picker-month selected'
                      : 'month-year-picker-month'
                  }
                  type="button"
                  key={monthLabel}
                  onClick={() => {
                    onSelectMonth(new Date(displayYear, monthIndex, 1));
                    setIsOpen(false);
                  }}
                >
                  {monthLabel}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={direction === 'previous' ? 'previous' : undefined}
    >
      <path d="m9 6 6 6 -6 6" />
    </svg>
  );
}
