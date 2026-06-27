import type { DragEventHandler, ReactNode } from 'react';
import { GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT } from '../data/events';

type EmptyWorkbookImportStateProps = {
  ariaLabel?: string;
  children?: ReactNode;
  isDragging?: boolean;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
};

export function EmptyWorkbookImportState({
  ariaLabel = 'Importar dados',
  children,
  isDragging = false,
  onDragLeave,
  onDragOver,
  onDrop,
}: EmptyWorkbookImportStateProps) {
  return (
    <div
      className={
        isDragging
          ? 'empty-data-state empty-tool-state dragging'
          : 'empty-data-state empty-tool-state'
      }
      role="region"
      aria-label={ariaLabel}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        className="primary-action import-empty-action"
        type="button"
        onClick={() =>
          window.dispatchEvent(new Event(GLOBAL_WORKBOOK_IMPORT_REQUEST_EVENT))
        }
      >
        <ImportWorkbookIcon />
        Importar .xlsx
      </button>
      {children}
    </div>
  );
}

function ImportWorkbookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5 -5" />
      <path d="M5 21h14" />
    </svg>
  );
}
