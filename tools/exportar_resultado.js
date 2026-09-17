const definicaoExportarResultado = Object.freeze({
  type: 'function', name: 'exportar_resultado', strict: true,
  description: 'Exporta um result_ref ou dataset_ref autorizado sem enviar suas linhas ao modelo.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      result_ref: { type: 'string' },
      formato: { type: 'string', enum: ['xlsx', 'docx', 'pdf'] },
      titulo: { type: 'string', minLength: 1, maxLength: 180 },
      colunas: { type: 'array', maxItems: 100, items: { type: 'string' } },
      identidadeVisual: { type: 'boolean' }
    },
    required: ['result_ref', 'formato', 'titulo', 'colunas', 'identidadeVisual']
  }
});

async function executarExportarResultado(argumentos, dependencias = {}) {
  if (!dependencias.servicoArtefatos || !dependencias.servicoDatasets ||
      !dependencias.conversationId || !dependencias.turnoIA?.id) {
    const erro = new Error('Os serviços de resultados e artefatos não estão disponíveis neste turno.');
    erro.codigo = 'RESULT_EXPORT_UNAVAILABLE'; throw erro;
  }
  return dependencias.servicoArtefatos.gerarDeDataset(
    dependencias.conversationId, dependencias.turnoIA.id, argumentos, {
      departmentId: dependencias.departamentoId || null,
      servicoDatasets: dependencias.servicoDatasets,
      mode: dependencias.artifactsMode
    }
  );
}

module.exports = { definicaoExportarResultado, executarExportarResultado };
