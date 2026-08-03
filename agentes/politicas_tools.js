function aplicarPoliticaArgumentos(nome, argumentos, contexto = {}) {
  const normalizados = { ...(argumentos || {}) };
  if (/^(consultar|agregar)_(gold|silver|bronze)$/.test(nome)) {
    if (normalizados.combinacao_filtros === 'e') normalizados.combinacao_filtros = 'todos';
    if (normalizados.combinacao_filtros === 'ou') normalizados.combinacao_filtros = 'qualquer';
  }
  if (nome !== 'analisar_indicadores') return normalizados;

  const temporal = contexto.temporal;
  if (!temporal) return normalizados;

  normalizados.data_inicial = temporal.inicio;
  normalizados.data_final = temporal.fim;
  normalizados.recencia = null;
  if (
    temporal.inicio === temporal.fim &&
    !['comparar', 'tendencia'].includes(normalizados.operacao)
  ) {
    normalizados.operacao = 'painel';
  }
  return normalizados;
}

module.exports = { aplicarPoliticaArgumentos };
