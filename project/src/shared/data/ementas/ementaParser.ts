import { normalizeFieldLabel } from '../schemas';
import {
  EMENTA_PARSER_VERSION,
  EmentaParseError,
  type ParsedDisciplina,
  type ParsedEmenta,
} from './ementaTypes';

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

type LineColumns = {
  page: number;
  y: number;
  left: string;
  middle: string;
  right: string;
  text: string;
  hasDisciplineColumnAnchor: boolean;
};

type CurrentDisciplina = {
  nameParts: string[];
  module: ParsedDisciplina['module'];
  hours: string;
};

const MODULE_ALIASES: Array<{
  key: ParsedDisciplina['module'];
  pattern: RegExp;
}> = [
  { key: 'Inicial', pattern: /modulo\s+inicial/i },
  { key: 'Básico', pattern: /modulo\s+basico/i },
  { key: 'Específico', pattern: /modulo\s+especifico/i },
];

const normalizeText = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();

const normalizeIdText = (value: string) =>
  normalizeFieldLabel(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const createEmentaId = async (file: File, arco: string) => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest))
    .slice(0, 5)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const arcoKey = normalizeIdText(arco);

  return arcoKey ? `ementa_${arcoKey}_${hash}` : `ementa_${hash}`;
};

const createDisciplinaId = (
  moduleName: string,
  arcoName: string,
  disciplineName: string,
) =>
  `disc_${normalizeIdText(moduleName)}_${normalizeIdText(arcoName)}_${normalizeIdText(
    disciplineName,
  )}`;

const getModuleFromLine = (line: string) => {
  const normalized = normalizeFieldLabel(line);
  return MODULE_ALIASES.find(({ pattern }) => pattern.test(normalized))?.key ?? null;
};

const isHeaderLine = (line: LineColumns) => {
  const normalizedLeft = normalizeFieldLabel(line.left);
  const normalizedRight = normalizeFieldLabel(line.right);
  const normalizedText = normalizeFieldLabel(line.text);

  return (
    normalizedLeft === 'disciplina' ||
    normalizedRight === 'carga horaria' ||
    normalizedText === 'disciplina objetivo carga horaria' ||
    normalizedText === 'disciplina conteudos abordados carga horaria'
  );
};

const isStandaloneContentsSectionHeading = (line: LineColumns) => {
  const normalizedText = normalizeFieldLabel(line.text);
  const isUppercaseHeading = line.text === line.text.toLocaleUpperCase('pt-BR');

  return normalizedText === 'conteudos abordados' && isUppercaseHeading;
};

const extractHours = (value: string) => {
  const match = normalizeText(value).match(/^(\d+)\s*(?:h|horas?)/i);
  return match ? `${match[1]} horas` : '';
};

const extractHoursFromLine = (value: string) => {
  const match = normalizeText(value).match(/\b(\d+)\s*(?:h|horas?)\b/i);
  return match ? `${match[1]} horas` : '';
};

const extractArcoName = (lines: readonly LineColumns[]) => {
  const allText = lines.map((line) => line.text).join('\n');
  const directMatch = allText.match(
    /T[íi]tulo\s+do\s+curso:\s*Arco\s+Ocupacional\s+(.+)/i,
  );

  if (!directMatch) {
    return '';
  }

  return normalizeText(directMatch[1].split('\n')[0] ?? '');
};

const flushDisciplina = (
  disciplines: ParsedDisciplina[],
  current: CurrentDisciplina | null,
  arco: string,
) => {
  if (!current) {
    return null;
  }

  const name = normalizeText(current.nameParts.join(' '));

  if (!name || !current.hours) {
    return null;
  }

  const disciplineArco =
    current.module === 'Específico' ? arco : 'Todos';

  disciplines.push({
    id: createDisciplinaId(current.module, disciplineArco, name),
    name,
    module: current.module,
    arco: disciplineArco,
    hours: current.hours,
  });

  return null;
};

const buildLinesFromTextItems = (
  pageNumber: number,
  items: readonly PdfTextItem[],
) => {
  const buckets = new Map<number, PdfTextItem[]>();

  items.forEach((item) => {
    const text = normalizeText(item.str ?? '');
    const transform = item.transform;

    if (!text || !transform || transform.length < 6) {
      return;
    }

    const y = Math.round(transform[5] / 2) * 2;
    const bucket = buckets.get(y) ?? [];
    bucket.push(item);
    buckets.set(y, bucket);
  });

  return [...buckets.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([y, bucket]) => {
      const parts = bucket
        .map((item) => ({
          text: normalizeText(item.str ?? ''),
          x: item.transform?.[4] ?? 0,
        }))
        .sort((left, right) => left.x - right.x);
      const left = parts
        .filter((part) => part.x < 215)
        .map((part) => part.text)
        .join(' ');
      const middle = parts
        .filter((part) => part.x >= 215 && part.x < 490)
        .map((part) => part.text)
        .join(' ');
      const right = parts
        .filter((part) => part.x >= 490)
        .map((part) => part.text)
        .join(' ');
      const hasDisciplineColumnAnchor = parts.some((part) => part.x < 70);

      return {
        page: pageNumber,
        y,
        left: normalizeText(left),
        middle: normalizeText(middle),
        right: normalizeText(right),
        text: normalizeText(parts.map((part) => part.text).join(' ')),
        hasDisciplineColumnAnchor,
      } satisfies LineColumns;
    });
};

export const parseEmentaPdf = async (file: File): Promise<ParsedEmenta> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();
  const documentTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const pdf = await documentTask.promise;
  const lines: LineColumns[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    lines.push(
      ...buildLinesFromTextItems(pageNumber, textContent.items as PdfTextItem[]),
    );
  }

  const arco = extractArcoName(lines);

  if (!arco) {
    throw new EmentaParseError('arco-not-found');
  }

  const disciplines: ParsedDisciplina[] = [];
  let currentModule: ParsedDisciplina['module'] | null = null;
  let currentDiscipline: CurrentDisciplina | null = null;
  let isInsideCurriculumTable = false;

  lines.forEach((line) => {
    if (isStandaloneContentsSectionHeading(line)) {
      currentDiscipline = flushDisciplina(
        disciplines,
        currentDiscipline,
        arco,
      );
      currentModule = null;
      isInsideCurriculumTable = false;
      return;
    }

    const moduleName = getModuleFromLine(line.text);

    if (moduleName) {
      currentDiscipline = flushDisciplina(
        disciplines,
        currentDiscipline,
        arco,
      );
      currentModule = moduleName;
      isInsideCurriculumTable = true;
      return;
    }

    if (!currentModule || !isInsideCurriculumTable || isHeaderLine(line)) {
      return;
    }

    const hours = extractHours(line.right) || extractHoursFromLine(line.text);

    if (hours) {
      currentDiscipline = flushDisciplina(
        disciplines,
        currentDiscipline,
        arco,
      );

      if (line.left && line.hasDisciplineColumnAnchor) {
        currentDiscipline = {
          nameParts: [line.left],
          module: currentModule,
          hours,
        };
      }

      return;
    }

    if (currentDiscipline && line.left && line.hasDisciplineColumnAnchor) {
      currentDiscipline.nameParts.push(line.left);
    }
  });

  flushDisciplina(disciplines, currentDiscipline, arco);

  if (disciplines.length === 0) {
    throw new EmentaParseError('disciplines-not-found');
  }

  if (
    !disciplines.some(
      (discipline) => normalizeFieldLabel(discipline.module) === 'especifico',
    )
  ) {
    throw new EmentaParseError('specific-disciplines-not-found');
  }

  return {
    id: await createEmentaId(file, arco),
    parser: EMENTA_PARSER_VERSION,
    originalFileName: file.name,
    arco,
    disciplines,
  };
};
