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
  'Arquivo Ementa',
  'ID',
  'Ementa ID',
] as const;

export const DISCIPLINAS_REQUIRED_COLUMNS = [
  'Disciplina',
  'Módulo',
  'Arco',
  'Carga Horária',
  'ID',
  'Ementa ID',
] as const;

export const AULAS_REQUIRED_COLUMNS = [
  'Aula',
  'Cor',
  'Instrutor Padrão',
  'Sala Padrão',
  'ID',
] as const;

export const AULAS_DISCIPLINAS_REQUIRED_COLUMNS = [
  'Aula ID',
  'Aula',
  'Arco',
  'Módulo',
  'Disciplina',
  'Disciplina ID',
  'ID',
] as const;

export const CRONOGRAMA_REQUIRED_COLUMNS = [
  'Turma',
  'Data',
  'Início',
  'Fim',
  'Tipo',
  'Aula ID',
  'Aula',
  'Instrutor',
  'Sala',
  'Cor',
  'ID',
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

export const findSchemaHeaderRowIndex = (
  rows: readonly unknown[][],
  requiredColumns: readonly string[],
) => {
  const requiredKeys = new Set(requiredColumns.map(normalizeFieldLabel));
  let bestIndex = -1;
  let bestScore = 0;
  let firstNonEmptyIndex = -1;

  rows.forEach((row, rowIndex) => {
    const columns = row.map((cell) => String(cell ?? '').trim());

    if (firstNonEmptyIndex < 0 && columns.some((column) => column !== '')) {
      firstNonEmptyIndex = rowIndex;
    }

    const availableKeys = new Set(columns.map(normalizeFieldLabel));
    const score = [...requiredKeys].filter((key) => availableKeys.has(key))
      .length;

    if (score > bestScore) {
      bestIndex = rowIndex;
      bestScore = score;
    }
  });

  return bestScore > 0 ? bestIndex : firstNonEmptyIndex;
};
