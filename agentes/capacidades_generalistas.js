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
    executor: 'provider_native', permissao: 'ia.imagem.analisar', modalidades: ['imagem', 'texto']
  }),
  'ia.web.pesquisar': capacidade({
    executor: 'provider_native', permissao: 'ia.web.pesquisar',
    unidadesFaturaveis: ['input_tokens', 'output_tokens', 'web_search_requests']
  }),
  'ia.imagem.gerar': capacidade({
    executor: 'nexus_local', permissao: 'ia.imagem.gerar', modalidades: ['texto', 'imagem'],
    unidadesFaturaveis: ['image_generation_requests']
  }),
  'ia.planilha.criar': capacidade({
    executor: 'nexus_local', permissao: 'ia.planilha.criar', modalidades: ['texto', 'arquivo']
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
