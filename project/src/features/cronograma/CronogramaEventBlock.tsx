import type { CSSProperties, PointerEvent, RefObject } from 'react';

export type CronogramaEventField = 'lesson' | 'turma' | 'instructor' | 'room';

export type CronogramaEventBlockData = {
  id: string;
  lesson: string;
  type: string;
  turma: string;
  instructor: string;
  room: string;
  startLabel: string;
  endLabel: string;
  dateLabel: string;
};

type CronogramaEventBlockProps = {
  block: CronogramaEventBlockData;
  className?: string;
  style: CSSProperties;
  heightRowUnits: number;
  activeField?: CronogramaEventField | null;
  activeDraftValue?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onOpenField?: (field: CronogramaEventField) => void;
  onDraftChange?: (value: string) => void;
  onCommitField?: (field: CronogramaEventField, draftValue: string) => void;
  onCancelField?: () => void;
  onOpenAttendance?: () => void;
  onDelete?: () => void;
  onResizeStart?: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizeEnd?: (event: PointerEvent<HTMLButtonElement>) => void;
};

const SCHEDULE_LESSON_PLACEHOLDER = 'Selecionar aula';

export function CronogramaEventBlock({
  block,
  className,
  style,
  heightRowUnits,
  activeField = null,
  activeDraftValue = '',
  inputRef,
  onPointerDown,
  onOpenField,
  onDraftChange,
  onCommitField,
  onCancelField,
  onOpenAttendance,
  onDelete,
  onResizeStart,
  onResizeEnd,
}: CronogramaEventBlockProps) {
  const availableTextLines = Math.max(2, Math.floor(heightRowUnits * 2));
  const shouldShowValueDetails = availableTextLines >= 3;
  const shouldShowTimeDetails = availableTextLines >= 4;
  const visibleLineCount = shouldShowTimeDetails
    ? 4
    : shouldShowValueDetails
      ? 3
      : 2;
  const emptyTextLines = Math.max(0, availableTextLines - visibleLineCount);
  const rootClassName = ['turma-schedule-block', className]
    .filter(Boolean)
    .join(' ');

  const renderField = (
    field: CronogramaEventField,
    value: string,
    placeholder: string,
  ) => {
    const isActive = activeField === field;
    const fieldClassName = [
      'turma-schedule-block-field',
      isActive ? 'active' : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (isActive) {
      return (
        <input
          className={fieldClassName}
          data-schedule-field-anchor={`${block.id}-${field}`}
          ref={inputRef}
          spellCheck={false}
          value={activeDraftValue}
          aria-label={
            field === 'lesson'
              ? 'Selecionar aula'
              : field === 'turma'
                ? 'Turma do evento'
                : field === 'instructor'
                  ? 'Instrutor da aula'
                  : 'Sala da aula'
          }
          placeholder={placeholder}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onDraftChange?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommitField?.(field, activeDraftValue);
              return;
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelField?.();
            }
          }}
        />
      );
    }

    return (
      <button
        className={fieldClassName}
        data-schedule-field-anchor={`${block.id}-${field}`}
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenField?.(field);
        }}
      >
        {value || placeholder}
      </button>
    );
  };

  return (
    <div
      className={rootClassName}
      data-schedule-block-id={block.id}
      style={style}
      onPointerDown={onPointerDown}
    >
      {onResizeStart ? (
        <button
          className="turma-schedule-block-resize turma-schedule-block-resize-top"
          type="button"
          aria-label="Ajustar inicio da aula"
          onPointerDown={onResizeStart}
        />
      ) : null}
      <div className="turma-schedule-block-line turma-schedule-block-line-main">
        {renderField('lesson', block.lesson, SCHEDULE_LESSON_PLACEHOLDER)}
        {onOpenAttendance || onDelete ? (
          <div className="turma-schedule-block-actions">
            {onOpenAttendance ? (
              <button
                className="turma-schedule-block-icon-button"
                type="button"
                aria-label="Registrar presenca"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenAttendance();
                }}
              >
                <CheckIcon />
              </button>
            ) : null}
            {onDelete ? (
              <button
                className="turma-schedule-block-icon-button"
                type="button"
                aria-label="Deletar aula"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="turma-schedule-block-line">
        {renderField('turma', block.turma, '-')}
      </div>
      {shouldShowValueDetails ? (
        <div className="turma-schedule-block-line">
          {renderField('instructor', block.instructor, '-')}
          {renderField('room', block.room, '-')}
        </div>
      ) : null}
      {shouldShowTimeDetails ? (
        <div className="turma-schedule-block-line">
          <span className="turma-schedule-block-field turma-schedule-block-field-static">
            {block.startLabel} - {block.endLabel}
          </span>
          <span className="turma-schedule-block-field turma-schedule-block-field-static">
            {block.dateLabel}
          </span>
        </div>
      ) : null}
      {Array.from({ length: emptyTextLines }).map((_, lineIndex) => (
        <div
          aria-hidden="true"
          className="turma-schedule-block-line"
          key={`${block.id}-empty-${lineIndex}`}
        >
          &nbsp;
        </div>
      ))}
      {onResizeEnd ? (
        <button
          className="turma-schedule-block-resize turma-schedule-block-resize-bottom"
          type="button"
          aria-label="Ajustar fim da aula"
          onPointerDown={onResizeEnd}
        />
      ) : null}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l4 4l10 -10" />
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
