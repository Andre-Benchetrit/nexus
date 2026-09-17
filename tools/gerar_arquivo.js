const definicaoGerarArquivo = Object.freeze({
  type: 'function', name: 'gerar_arquivo', strict: true,
  description: 'Gera um XLSX, DOCX ou PDF profissional e privado nesta conversa a partir de uma especificação estruturada.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      formato: { type: 'string', enum: ['xlsx', 'docx', 'pdf'] },
      titulo: { type: 'string', minLength: 1, maxLength: 180 },
      modelo: { type: 'string', enum: ['relatorio', 'memorando', 'procedimento', 'livre', 'dados'] },
      secoes: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false,
        properties: { titulo: { type: 'string' }, conteudo: { type: 'string' }, itens: { type: 'array', items: { type: 'string' } } },
        required: ['titulo', 'conteudo', 'itens'] } },
      tabelas: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false,
        properties: { titulo: { type: 'string' }, colunas: { type: 'array', items: { type: 'string' } },
          linhas: { type: 'array', items: { type: 'array', items: {} } } }, required: ['titulo', 'colunas', 'linhas'] } },
      graficos: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false,
        properties: { titulo: { type: 'string' }, tipo: { type: 'string', enum: ['barra', 'linha'] },
          categorias: { type: 'array', items: { type: 'string' } }, valores: { type: 'array', items: { type: 'number' } } },
        required: ['titulo', 'tipo', 'categorias', 'valores'] } },
      fontes: { type: 'array', maxItems: 100, items: { type: 'string' } },
      identidadeVisual: { type: 'boolean' }
    },
    required: ['formato', 'titulo', 'modelo', 'secoes', 'tabelas', 'graficos', 'fontes', 'identidadeVisual']
  }
});

async function executarGerarArquivo(argumentos, dependencias = {}) {
  if (!dependencias.servicoArtefatos || !dependencias.conversationId || !dependencias.turnoIA?.id) {
    const erro = new Error('O serviço de artefatos não está disponível neste turno.');
    erro.codigo = 'ARTIFACT_SERVICE_UNAVAILABLE'; throw erro;
  }
  return dependencias.servicoArtefatos.gerar(dependencias.conversationId,
    dependencias.turnoIA.id, argumentos, {
      departmentId: dependencias.departamentoId || null,
      classification: dependencias.artifactClassification || 'conversa_privada',
      lineage: dependencias.artifactLineage || []
    });
}

module.exports = { definicaoGerarArquivo, executarGerarArquivo };
