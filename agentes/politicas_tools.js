function aplicarPoliticaArgumentos(nome, argumentos, contexto = {}) {
  const normalizados = { ...(argumentos || {}) };
  if (/^(consultar|agregar)_(gold|silver|bronze)$/.test(nome)) {
    if (normalizados.combinacao_filtros === 'e') normalizados.combinacao_filtros = 'todos';
    if (normalizados.combinacao_filtros === 'ou') normalizados.combinacao_filtros = 'qualquer';
  }
  if (
    nome === 'consultar_bloqueios_sem_estoque' &&
    contexto.decisao?.intencao === 'enriquecer'
  ) {
    normalizados.operacao = 'listar_itens';
    const pedidos = contexto.referenciasAnteriores?.marketplace_pedido || [];
    if (pedidos.length && !normalizados.marketplace_pedido && !normalizados.marketplace_pedidos?.length) {
      normalizados.marketplace_pedidos = [...pedidos];
    }
  }
  const temporal = contexto.temporal;
  if (nome === 'analisar_influencias' && temporal?.tipo === 'comparacao_periodos') {
    normalizados.data_inicial = temporal.inicio;
    normalizados.data_final = temporal.fim;
    normalizados.data_inicial_anterior = temporal.periodoAnterior.inicio;
    normalizados.data_final_anterior = temporal.periodoAnterior.fim;
    return normalizados;
  }
  if (nome !== 'analisar_indicadores') return normalizados;

  if (!temporal) return normalizados;

  normalizados.data_inicial = temporal.inicio;
  normalizados.data_final = temporal.fim;
  if (temporal.tipo === 'comparacao_periodos') {
    normalizados.data_inicial_anterior = temporal.periodoAnterior.inicio;
    normalizados.data_final_anterior = temporal.periodoAnterior.fim;
  }
  normalizados.recencia = null;
  if (
    temporal.inicio === temporal.fim &&
    !['comparar', 'tendencia'].includes(normalizados.operacao)
  ) {
    normalizados.operacao = 'painel';
  }
  return normalizados;
}

function validarPoliticaExecucao(nome, contexto = {}) {
  if (nome !== 'consultar_bloqueios_sem_estoque' || !contexto.temporal) return;
  const { inicio, fim } = contexto.temporal;
  const referencia = contexto.dataReferencia;
  if (inicio && fim && referencia && (inicio !== referencia || fim !== referencia)) {
    const erro = new Error(
      'A fachada de bloqueios sem estoque comprova somente a visao atual; ' +
      'ela nao pode responder uma data historica como se fosse o estado daquele dia.'
    );
    erro.codigo = 'CAPACIDADE_TEMPORAL_NAO_SUPORTADA';
    throw erro;
  }
}

module.exports = { aplicarPoliticaArgumentos, validarPoliticaExecucao };
