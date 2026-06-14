import { normalizeFieldLabel } from './schemas';

type WorkbookLike<TWorksheet = unknown> = {
  SheetNames: string[];
  Sheets: Record<string, TWorksheet>;
};

export const findWorkbookSheetName = (
  workbook: WorkbookLike,
  preferredSheetName: string,
) => {
  const preferredKey = normalizeFieldLabel(preferredSheetName);

  return (
    workbook.SheetNames.find(
      (sheetName) => normalizeFieldLabel(sheetName) === preferredKey,
    ) ??
    workbook.SheetNames[0] ??
    null
  );
};

export const hasWorkbookSheet = (
  workbook: WorkbookLike,
  preferredSheetName: string,
) =>
  workbook.SheetNames.some(
    (sheetName) =>
      normalizeFieldLabel(sheetName) === normalizeFieldLabel(preferredSheetName),
  );

export const getWorkbookSheet = <TWorksheet>(
  workbook: WorkbookLike<TWorksheet>,
  preferredSheetName: string,
) => {
  const sheetName = findWorkbookSheetName(workbook, preferredSheetName);

  if (!sheetName) {
    return {
      sheetName: null,
      worksheet: null,
    };
  }

  return {
    sheetName,
    worksheet: workbook.Sheets[sheetName] ?? null,
  };
};
