export const APRENDIZES_REQUIRED_COLUMNS = [
  'Nome',
  'Sexo',
  'Data de Nascimento',
  'Idade',
  'Contato',
  'E-mail',
  'RG',
  'CPF',
  'Endereço',
  'Instituição de Ensino',
  'Responsável',
  'Contato do Responsável',
  'E-mail do Responsável',
  'Data de Admissão',
  'Data do Término',
  'Arco de Aprendizagem',
  'Função',
  'Turma',
  'Empresa',
] as const;

export const TURMAS_REQUIRED_COLUMNS = [
  'Turma',
  'Dia',
  'Período',
  'Instrutor',
  'Sala',
] as const;

export const ARCOS_REQUIRED_COLUMNS = [
  'Arco',
  'Módulo',
  'Disciplina',
  'Carga Horária',
] as const;

export const DISCIPLINAS_REQUIRED_COLUMNS = [
  'Disciplina',
  'Módulo',
  'Tipo',
  'Arco',
  'Carga Horária',
] as const;

export const AULAS_REQUIRED_COLUMNS = [
  'Aula',
  'Disciplinas',
] as const;

export const normalizeFieldLabel = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeColumnsForSchema = (
  columns: string[],
  requiredColumns: readonly string[],
) => {
  const requiredByKey = new Map(
    requiredColumns.map((column) => [normalizeFieldLabel(column), column]),
  );
  const availableKeys = new Set(
    columns.map((column) => normalizeFieldLabel(column)),
  );
  const missingColumns = requiredColumns.filter(
    (column) => !availableKeys.has(normalizeFieldLabel(column)),
  );
  const normalizedColumns = columns.map(
    (column) => requiredByKey.get(normalizeFieldLabel(column)) ?? column,
  );

  return {
    missingColumns,
    normalizedColumns,
  };
};
