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
  'Aula',
  'Arco',
  'Módulo',
  'Disciplina',
  'Aula ID',
  'Disciplina ID',
  'ID',
] as const;

export const CRONOGRAMA_REQUIRED_COLUMNS = [
  'Turma',
  'Data',
  'Início',
  'Fim',
  'Tipo',
  'Aula',
  'Instrutor',
  'Sala',
  'Cor',
  'Aula ID',
  'ID',
] as const;

export const PLANO_ENSINO_REQUIRED_COLUMNS = [
  'Aprendiz',
  'Arco',
  'Módulo',
  'Disciplina',
  'Carga Horária Total',
  'Aprendiz ID',
  'Arco ID',
  'Disciplina ID',
  'ID',
] as const;

export const PRESENCAS_REQUIRED_COLUMNS = [
  'Aprendiz',
  'Status Presença',
  'Turma',
  'Data',
  'Início',
  'Fim',
  'Aula',
  'Instrutor',
  'Sala',
  'Evento ID',
  'Aula ID',
  'Aprendiz ID',
  'Turma ID',
  'ID',
] as const;

export const HORAS_APLICADAS_REQUIRED_COLUMNS = [
  'Aprendiz',
  'Arco',
  'Módulo',
  'Disciplina',
  'Minutos Aplicados',
  'Data',
  'Aula',
  'Evento ID',
  'Presença ID',
  'Aprendiz ID',
  'Disciplina ID',
  'Aula ID',
  'ID',
] as const;

export const PLANO_PROGRESSO_REQUIRED_COLUMNS = [
  'Aprendiz',
  'Arco',
  'Módulo',
  'Disciplina',
  'Carga Horária Total',
  'Carga Horária Cumprida',
  'Excedente',
  'Aprendiz ID',
  'Disciplina ID',
  'ID',
] as const;

const repairKnownMojibakeLabel = (value: string) =>
  value
    .replace(/\u00c3\u0192\u00c2\u00a1/g, 'á')
    .replace(/\u00c3\u0192\u00c2\u00a9/g, 'é')
    .replace(/\u00c3\u0192\u00c2\u00ad/g, 'í')
    .replace(/\u00c3\u0192\u00c2\u00b3/g, 'ó')
    .replace(/\u00c3\u0192\u00c2\u00ba/g, 'ú')
    .replace(/\u00c3\u0192\u00c2\u00a3/g, 'ã')
    .replace(/\u00c3\u0192\u00c2\u00a7/g, 'ç')
    .replace(/\u00c3\u00a1/g, 'á')
    .replace(/\u00c3\u00a9/g, 'é')
    .replace(/\u00c3\u00ad/g, 'í')
    .replace(/\u00c3\u00b3/g, 'ó')
    .replace(/\u00c3\u00ba/g, 'ú')
    .replace(/\u00c3\u00a3/g, 'ã')
    .replace(/\u00c3\u00a7/g, 'ç');

export const normalizeFieldLabel = (value: string) =>
  repairKnownMojibakeLabel(value)
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
