const definicaoGerarGrafico = Object.freeze({
  type: 'function', name: 'gerar_grafico', strict: true,
  description: 'Gera um gráfico corporativo exato a partir do resultado estruturado mais recente. Os cálculos são locais e o result_ref é escolhido pelo Nexus.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      tipo: { type: 'string', enum: ['linha', 'barra', 'variacao'] },
      titulo: { type: 'string', minLength: 1, maxLength: 120 },
      metrica: { type: 'string', maxLength: 80, description: 'Métrica solicitada ou auto.' },
      dimensao: { type: 'string', enum: ['auto', 'periodo', 'produto', 'canal'] },
      serie: { type: 'string', enum: ['auto', 'produto', 'canal', 'nenhuma'] },
      unidade: { type: 'string', enum: ['auto', 'moeda', 'numero', 'percentual'] },
      limite_series: { type: 'integer', minimum: 1, maximum: 10 }
    },
    required: ['tipo', 'titulo', 'metrica', 'dimensao', 'serie', 'unidade', 'limite_series']
  }
});

async function executarGerarGrafico(argumentos, dependencias = {}) {
  if (!dependencias.servicoArtefatos || !dependencias.servicoDatasets ||
      !dependencias.conversationId || !dependencias.turnoIA?.id || !dependencias.resultRef?.id) {
    const erro = new Error('Não há um resultado estruturado autorizado disponível para gerar o gráfico.');
    erro.codigo = 'CHART_RESULT_REF_REQUIRED'; throw erro;
  }
  return dependencias.servicoArtefatos.gerarGraficoDeDataset(
    dependencias.conversationId, dependencias.turnoIA.id,
    { ...argumentos, result_ref: dependencias.resultRef.id }, {
      servicoDatasets: dependencias.servicoDatasets,
      departmentId: dependencias.departamentoId || null
    });
}

module.exports = { definicaoGerarGrafico, executarGerarGrafico };
