function capacidade(definicao) {
  return Object.freeze({
    habilitada: false,
    modalidades: ['texto'],
    classificacaoDados: 'interno',
    unidadesFaturaveis: ['input_tokens', 'output_tokens'],
    efeito: 'leitura',
    idempotencia: true,
    politicaReutilizacao: 'mesmo_turno',
    extratorEvidenciaHandoff: (resultado) => resultado,
    ...definicao
  });
}

const CAPACIDADES_GENERALISTAS = Object.freeze({
  'ia.conversar': capacidade({
    habilitada: true,
    executor: 'provider_native',
    permissao: 'ia.conversar',
    classificacaoDados: 'conversa_corporativa'
  }),
  'ia.nexus.consultar': capacidade({
    habilitada: true,
    executor: 'corporate_router',
    permissao: 'ia.nexus.consultar',
    classificacaoDados: 'dados_corporativos'
  }),
  'ia.memoria.revisar': capacidade({
    habilitada: true,
    executor: 'nexus_local',
    permissao: 'memoria.candidatar',
    classificacaoDados: 'sinal_efemero',
    unidadesFaturaveis: []
  }),
  'ia.imagem.analisar': capacidade({
    habilitada: ['local', 'v1'].includes(String(process.env.NEXUS_IMAGE_MODE || 'off').toLowerCase()),
    executor: 'nexus_local', permissao: 'ia.imagem.processar_local', modalidades: ['imagem', 'texto']
  }),
  'ia.imagem.processar_local': capacidade({
    habilitada: ['local', 'v1'].includes(String(process.env.NEXUS_IMAGE_MODE || 'off').toLowerCase()),
    executor: 'nexus_local', permissao: 'ia.imagem.processar_local', modalidades: ['imagem', 'texto'],
    unidadesFaturaveis: ['images', 'megapixels', 'ocr_seconds']
  }),
  'ia.imagem.interpretar': capacidade({
    habilitada: String(process.env.NEXUS_IMAGE_MODE || 'off').toLowerCase() === 'v1',
    executor: 'provider_native', permissao: 'ia.imagem.interpretar', modalidades: ['imagem', 'texto']
  }),
  'ia.web.pesquisar': capacidade({
    habilitada: String(process.env.NEXUS_WEB_MODE || 'off').toLowerCase() === 'v1',
    executor: 'nexus_local', permissao: 'ia.web.pesquisar',
    unidadesFaturaveis: ['web_search_credits']
  }),
  'ia.arquivo.processar_local': capacidade({
    habilitada: ['read', 'v1'].includes(String(process.env.NEXUS_FILES_MODE || 'off').toLowerCase()),
    executor: 'nexus_local', permissao: 'ia.arquivo.processar_local', modalidades: ['arquivo', 'texto'],
    unidadesFaturaveis: ['files', 'pages', 'sheets', 'cells', 'ocr_pages']
  }),
  'ia.arquivo.analisar': capacidade({
    habilitada: String(process.env.NEXUS_FILES_MODE || 'off').toLowerCase() === 'v1',
    executor: 'provider_native', permissao: 'ia.arquivo.analisar', modalidades: ['arquivo', 'texto']
  }),
  'ia.arquivo.evidencia.consultar': capacidade({
    habilitada: String(process.env.NEXUS_FILES_MODE || 'off').toLowerCase() === 'v1',
    executor: 'nexus_local', permissao: 'ia.arquivo.analisar', modalidades: ['arquivo', 'texto'],
    unidadesFaturaveis: [], politicaReutilizacao: 'mesma_analise'
  }),
  'ia.arquivo.gerar': capacidade({
    habilitada: String(process.env.NEXUS_ARTIFACTS_MODE || 'off').toLowerCase() === 'v1',
    executor: 'nexus_local', permissao: 'ia.arquivo.gerar', modalidades: ['texto', 'arquivo'],
    efeito: 'escrita', idempotencia: false, politicaReutilizacao: 'nunca',
    unidadesFaturaveis: ['artifacts', 'artifact_bytes']
  }),
  'ia.imagem.gerar': capacidade({
    executor: 'nexus_local', permissao: 'ia.imagem.gerar', modalidades: ['texto', 'imagem'],
    unidadesFaturaveis: ['image_generation_requests']
  }),
  'ia.planilha.criar': capacidade({
    habilitada: String(process.env.NEXUS_ARTIFACTS_MODE || 'off').toLowerCase() === 'v1',
    executor: 'nexus_local', permissao: 'ia.arquivo.gerar', modalidades: ['texto', 'arquivo'],
    efeito: 'escrita', idempotencia: false, politicaReutilizacao: 'nunca'
  })
});

function obterCapacidadeGeneralista(id) {
  return CAPACIDADES_GENERALISTAS[id] || null;
}

function capacidadesGeneralistasHabilitadas() {
  return Object.entries(CAPACIDADES_GENERALISTAS)
    .filter(([, item]) => item.habilitada)
    .map(([id, item]) => ({ id, ...item }));
}

module.exports = {
  CAPACIDADES_GENERALISTAS,
  capacidadesGeneralistasHabilitadas,
  obterCapacidadeGeneralista
};
