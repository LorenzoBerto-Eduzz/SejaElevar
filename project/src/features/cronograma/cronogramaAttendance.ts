import {
  getAcademicCellValue,
  type AcademicEventSnapshot,
  type AcademicAttendanceSelection,
} from '../../shared/data/academicProgress';
import type { SheetTable } from '../../shared/data/dataIndex';
import {
  CRONOGRAMA_ABSENT_STATUS,
  CRONOGRAMA_PRESENT_STATUS,
  isPresentAttendanceStatus,
  resolveLiveAulaForUnconfirmedBlock,
  type CronogramaLiveAulaBlock,
  type CronogramaLiveAulaOption,
} from './cronogramaGuards';

export type CronogramaAttendanceStudent = {
  aprendizId: string;
  aprendiz: string;
  arco: string;
};

export type CronogramaAttendanceSnapshotBlock = CronogramaLiveAulaBlock & {
  id: string;
  turma: string;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  lessonId: string;
  lesson: string;
  instructor: string;
  room: string;
};

export const getCronogramaAttendanceStatusesForBlock = (
  sheet: SheetTable | null,
  blockId: string,
) => {
  const statuses = new Map<string, string>();

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

export const getCronogramaAttendanceDraft = (
  students: CronogramaAttendanceStudent[],
  statuses: Map<string, string>,
) =>
  Object.fromEntries(
    students.map((student) => [
      student.aprendizId,
      isPresentAttendanceStatus(statuses.get(student.aprendizId) ?? ''),
    ]),
  );

export const buildCronogramaAttendanceSelections = (
  students: CronogramaAttendanceStudent[],
  draft: Record<string, boolean>,
): AcademicAttendanceSelection[] =>
  students.map((student) => ({
    ...student,
    status: draft[student.aprendizId]
      ? CRONOGRAMA_PRESENT_STATUS
      : CRONOGRAMA_ABSENT_STATUS,
  }));

export const buildCronogramaEventAttendanceSnapshot = <
  T extends CronogramaAttendanceSnapshotBlock,
>(
  block: T,
  aulaCatalogOptions: CronogramaLiveAulaOption[],
  hasCurrentPresence: boolean,
  getTurmaRecordId: (turmaName: string) => string,
  formatTime: (minutes: number) => string,
): AcademicEventSnapshot => {
  const snapshotBlock = resolveLiveAulaForUnconfirmedBlock(
    block,
    aulaCatalogOptions,
    hasCurrentPresence,
  );

  return {
    id: snapshotBlock.id,
    turma: snapshotBlock.turma,
    turmaId: getTurmaRecordId(snapshotBlock.turma),
    date: snapshotBlock.dateKey,
    start: formatTime(snapshotBlock.startMinutes),
    end: formatTime(snapshotBlock.endMinutes),
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
