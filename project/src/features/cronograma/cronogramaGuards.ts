import { normalizeFieldLabel } from '../../shared/data/schemas';

export type CronogramaBlockedAction = 'alterado' | 'deletado' | 'movido';

export const CRONOGRAMA_PRESENT_STATUS = 'Presente';
export const CRONOGRAMA_ABSENT_STATUS = 'Ausente';

export const CRONOGRAMA_MISSING_AULA_FOR_ATTENDANCE_MESSAGE =
  'Selecione uma aula antes de registrar presença.';
export const CRONOGRAMA_MISSING_TURMA_FOR_ATTENDANCE_MESSAGE =
  'Selecione uma turma antes de registrar presença.';
export const CRONOGRAMA_INVALID_TURMA_SELECTION_MESSAGE =
  'Selecione uma turma cadastrada para vincular este evento.';

export const isPresentAttendanceStatus = (status: string) =>
  normalizeFieldLabel(status) === normalizeFieldLabel(CRONOGRAMA_PRESENT_STATUS);

export const hasPresentAttendanceStatus = (statuses: Iterable<string>) =>
  Array.from(statuses).some(isPresentAttendanceStatus);

export const hasActivePresenceDraft = (draft: Record<string, boolean>) =>
  Object.values(draft).some(Boolean);

export const getBlockedEventWithAttendanceMessage = (
  action: CronogramaBlockedAction,
) =>
  `Este evento já possui presença registrada e não pode ser ${action} sem uma revisão.`;

export type CronogramaLiveAulaOption = {
  id: string;
  name: string;
  color: string;
};

export type CronogramaLiveAulaBlock = {
  lessonId: string;
  lesson: string;
  color: string;
};

export const resolveLiveAulaForUnconfirmedBlock = <
  T extends CronogramaLiveAulaBlock,
>(
  block: T,
  aulaCatalogOptions: CronogramaLiveAulaOption[],
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
