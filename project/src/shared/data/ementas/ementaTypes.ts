export const EMENTA_PARSER_VERSION = 'ementa-elevar-v1';
export const EMENTAS_FOLDER_NAME = 'ementas';

export type ParsedDisciplina = {
  id: string;
  name: string;
  module: 'Inicial' | 'Básico' | 'Específico';
  arco: string;
  hours: string;
};

export type ParsedEmenta = {
  id: string;
  parser: typeof EMENTA_PARSER_VERSION;
  originalFileName: string;
  storedFileName?: string;
  arco: string;
  disciplines: ParsedDisciplina[];
};

export class EmentaParseError extends Error {
  constructor(message = 'ementa-parse-failed') {
    super(message);
    this.name = 'EmentaParseError';
  }
}
