const DOMINIOS = Object.freeze([
  'indicadores', 'influencias', 'estoque', 'reposicoes', 'bloqueios_estoque',
  'desempenho', 'frete', 'operacao', 'vendas', 'catalogo', 'pessoas',
  'produto', 'documentacao', 'sql', 'gold', 'silver', 'bronze', 'hibrido'
]);

const INTENCOES = Object.freeze([
  'resumir', 'listar', 'detalhar', 'comparar', 'diagnosticar', 'enriquecer',
  'ranquear', 'localizar', 'agregar', 'auditar', 'explicar', 'descrever',
  'construir', 'validar'
]);

const FERRAMENTAS_AUXILIARES = Object.freeze(new Set([
  'resolver_produto'
]));

function capacidade({
  dominio,
  camada = 'negocio',
  intencoes,
  entidades,
  campos,
  operacoes,
  mutavel = true,
  efeito = 'leitura',
  idempotencia = true,
  politicaReutilizacao = 'mesmo_turno',
  extratorEvidenciaHandoff = (resultado) => resultado,
  transformacoesPermitidas = ['resumir', 'formatar_tabela'],
  derivacoesPermitidas = [],
  granularidades = [],
  volumeMaximoSintese = 100,
  perfilResposta = 'flexivel_com_evidencia'
}) {
  return Object.freeze({
    dominio, camada, intencoes, entidades, campos, operacoes, mutavel,
    efeito, idempotencia, politicaReutilizacao, extratorEvidenciaHandoff,
    transformacoesPermitidas, derivacoesPermitidas, granularidades,
    volumeMaximoSintese, perfilResposta
  });
}

const REGISTRO_CAPACIDADES = Object.freeze({
  analisar_indicadores: capacidade({
    dominio: 'indicadores', intencoes: ['resumir', 'comparar', 'listar'],
    entidades: ['indicador', 'pedido', 'faturamento', 'estoque'],
    campos: [
      'pedidos_pagos', 'valor_pedidos_pagos', 'faturamento', 'faturamento_emitido',
      'faturamento_total', 'valor_devolucoes', 'faturamento_liquido',
      'rupturas', 'data', 'id_empresa'
    ],
    operacoes: ['resumir', 'painel', 'comparar', 'tendencia'],
    transformacoesPermitidas: ['resumir', 'ordenar', 'destacar', 'comparar_periodos', 'formatar_tabela'],
    derivacoesPermitidas: ['variacao_absoluta', 'variacao_percentual'],
    granularidades: ['dia', 'periodo', 'indicador']
  }),
  analisar_influencias: capacidade({
    dominio: 'influencias', intencoes: ['comparar', 'explicar', 'ranquear'],
    entidades: ['marca', 'produto', 'plataforma'],
    campos: [
      'faturamento', 'diferenca', 'variacao_percentual',
      'plataforma', 'marketplace', 'marca', 'produto'
    ],
    operacoes: ['comparar'],
    transformacoesPermitidas: ['resumir', 'ordenar', 'destacar', 'comparar_periodos', 'formatar_tabela'],
    derivacoesPermitidas: ['variacao_absoluta', 'variacao_percentual', 'participacao_variacao'],
    granularidades: ['marca', 'produto', 'plataforma']
  }),
  analisar_rupturas: capacidade({
    dominio: 'estoque', intencoes: ['resumir', 'listar', 'ranquear', 'diagnosticar'],
    entidades: ['produto', 'marca', 'sku', 'ean'],
    campos: ['estoque', 'cobertura', 'risco', 'sku', 'ean', 'descricao_produto'],
    operacoes: ['resumir', 'listar', 'ranquear_marcas'],
    transformacoesPermitidas: ['resumir', 'agrupar', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: ['contagem_por_classificacao'],
    granularidades: ['produto', 'marca']
  }),
  analisar_giro_estoque: capacidade({
    dominio: 'estoque', intencoes: ['ranquear', 'listar', 'comparar'],
    entidades: ['produto', 'marca', 'sku', 'ean'],
    campos: [
      'estoque_total', 'quantidade_reservada', 'quantidade_vendida_periodo',
      'faturamento_periodo', 'indice_baixo_giro', 'sku', 'ean', 'descricao_produto'
    ],
    operacoes: ['ranquear_menor_giro'],
    transformacoesPermitidas: ['resumir', 'agrupar', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: ['participacao_estoque', 'participacao_vendas'],
    granularidades: ['produto', 'marca']
  }),
  analisar_reposicoes: capacidade({
    dominio: 'reposicoes', intencoes: ['resumir', 'listar', 'detalhar', 'agregar'],
    entidades: [
      'produto', 'sku', 'pedido_compra', 'nota_entrada', 'fornecedor', 'marca',
      'data_prevista', 'status_logistico'
    ],
    campos: [
      'produto', 'descricao_produto', 'sku', 'fornecedor', 'marca',
      'numero_pedido_compra', 'data_prevista', 'data_entrada',
      'quantidade', 'quantidade_pedida', 'quantidade_recebida', 'quantidade_pendente',
      'status_logistico', 'notas_fiscais_entrada'
    ],
    operacoes: ['listar', 'somar_quantidade', 'resumir_status', 'ultimo_recebimento'],
    transformacoesPermitidas: ['resumir', 'agrupar', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: ['saldo_pendente_comprovado'],
    granularidades: ['produto', 'pedido_compra', 'nota_entrada', 'data_entrada']
  }),
  consultar_bloqueios_sem_estoque: capacidade({
    dominio: 'bloqueios_estoque',
    intencoes: ['resumir', 'listar', 'detalhar', 'enriquecer', 'agregar'],
    entidades: ['pedido', 'produto', 'sku', 'ean'],
    campos: [
      'marketplace_pedido', 'id_nota_saida', 'canal_venda', 'sku', 'ean',
      'descricao_produto', 'quantidade_pedida', 'bloqueio'
    ],
    operacoes: ['resumir', 'listar', 'listar_itens', 'detalhar_pedido', 'agrupar_na_resposta'],
    transformacoesPermitidas: [
      'resumir', 'agrupar', 'ordenar', 'destacar', 'remover_repeticoes', 'formatar_tabela'
    ],
    derivacoesPermitidas: ['contagem_por_produto', 'contagem_prazos_vencidos'],
    granularidades: ['pedido', 'produto', 'sku', 'ean']
  }),
  diagnosticar_bloqueio_sem_estoque: capacidade({
    dominio: 'bloqueios_estoque', intencoes: ['diagnosticar', 'explicar', 'detalhar'],
    entidades: ['pedido', 'produto', 'sku'],
    campos: ['marketplace_pedido', 'estoque', 'saldo_cd', 'reposicao', 'classificacao'],
    operacoes: ['diagnosticar'],
    transformacoesPermitidas: ['resumir', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: [],
    granularidades: ['pedido', 'produto']
  }),
  analisar_desempenho: capacidade({
    dominio: 'desempenho', intencoes: ['ranquear', 'listar', 'comparar'],
    entidades: ['produto', 'marca', 'grupo', 'categoria', 'plataforma'],
    campos: [
      'id_produto', 'descricao_produto', 'sku', 'ean',
      'faturamento', 'quantidade', 'margem', 'custo'
    ],
    operacoes: ['ranquear'],
    transformacoesPermitidas: ['resumir', 'agrupar', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: ['participacao_percentual'],
    granularidades: ['produto', 'marca', 'grupo', 'categoria', 'plataforma']
  }),
  analisar_frete: capacidade({
    dominio: 'frete', intencoes: ['resumir', 'listar', 'ranquear', 'comparar'],
    entidades: ['pedido', 'plataforma', 'transportadora', 'regra_transporte'],
    campos: ['frete_cobrado', 'custo_frete', 'resultado_frete'],
    operacoes: ['resumir', 'ranquear'],
    transformacoesPermitidas: ['resumir', 'agrupar', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: ['participacao_percentual'],
    granularidades: ['pedido', 'plataforma', 'transportadora', 'regra_transporte']
  }),
  analisar_operacao: capacidade({
    dominio: 'operacao', intencoes: ['resumir', 'listar', 'ranquear'],
    entidades: ['pedido', 'plataforma'],
    campos: ['status', 'cancelados', 'pendentes', 'devolvidos'],
    operacoes: ['funil', 'ranquear'],
    transformacoesPermitidas: ['resumir', 'agrupar', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: ['taxa_sobre_total'],
    granularidades: ['pedido', 'plataforma', 'status']
  }),
  analisar_vendas: capacidade({
    dominio: 'vendas', intencoes: ['resumir', 'listar', 'ranquear', 'localizar', 'agregar'],
    entidades: ['pedido', 'nota_saida', 'produto', 'marca', 'cliente', 'transportadora'],
    campos: [
      'marketplace_pedido', 'nota_fiscal', 'quantidade', 'valor',
      'faturamento', 'data_pedido', 'plataforma', 'id_empresa',
      'quantidade_pedidos', 'quantidade_notas_fiscais', 'quantidade_itens',
      'quantidade_vendida', 'valor_total', 'valor_total_pedidos',
      'valor_total_vendido', 'faturamento_emitido', 'faturamento_total',
      'valor_devolucoes', 'faturamento_liquido'
    ],
    operacoes: ['resumir', 'listar', 'ranquear', 'localizar_notas'],
    transformacoesPermitidas: [
      'resumir', 'agrupar', 'ordenar', 'destacar', 'remover_repeticoes', 'formatar_tabela'
    ],
    derivacoesPermitidas: ['participacao_percentual', 'variacao_absoluta', 'variacao_percentual'],
    granularidades: ['pedido', 'nota_saida', 'item', 'produto', 'marca', 'transportadora']
  }),
  analisar_catalogo: capacidade({
    dominio: 'catalogo', intencoes: ['resumir', 'listar', 'detalhar', 'ranquear'],
    entidades: ['produto', 'marca', 'grupo', 'categoria', 'sku', 'ean'],
    campos: ['sku', 'ean', 'descricao_produto', 'status', 'marca', 'categoria'],
    operacoes: ['resumir', 'listar', 'ranquear']
  }),
  analisar_pessoas: capacidade({
    dominio: 'pessoas', intencoes: ['resumir', 'listar', 'detalhar'],
    entidades: ['funcionario', 'transportadora'],
    campos: ['nome', 'status', 'empresa'],
    operacoes: ['resumir', 'listar']
  }),
  consultar_documentacao: capacidade({
    dominio: 'documentacao', intencoes: ['listar', 'localizar', 'detalhar', 'explicar', 'resumir'],
    entidades: ['procedimento', 'politica', 'manual', 'processo', 'setor'],
    campos: ['documento_id', 'titulo_documento', 'versao_documento', 'pagina_documento', 'trecho', 'links', 'citacao'],
    operacoes: ['consultar'], mutavel: true,
    transformacoesPermitidas: ['resumir', 'ordenar', 'destacar', 'formatar_tabela'],
    derivacoesPermitidas: [],
    granularidades: ['documento', 'pagina', 'trecho'],
    volumeMaximoSintese: 12,
    perfilResposta: 'instrucao_com_citacoes'
  }),
  resolver_produto: capacidade({
    dominio: 'produto', intencoes: ['localizar', 'detalhar', 'enriquecer'],
    entidades: ['produto', 'sku', 'ean'],
    campos: ['id_produto', 'sku', 'ean', 'descricao_produto'],
    operacoes: ['resolver'], mutavel: false
  }),
  construir_sql: capacidade({
    dominio: 'sql', intencoes: ['construir', 'validar', 'explicar'],
    entidades: [
      'pedido', 'nota_saida', 'item', 'produto', 'tipo_produto', 'estoque', 'movimentacao',
      'bloqueio', 'cliente', 'tipo_pedido', 'plataforma', 'regra_transporte'
    ],
    campos: ['query_spec', 'sql_parametrizado', 'sql_dbeaver', 'explain'],
    operacoes: ['construir'], mutavel: false
  }),
  consultar_gold: capacidade({
    dominio: 'gold', camada: 'gold', intencoes: ['listar', 'descrever'],
    entidades: ['objeto_gold'], campos: ['schema', 'linhas'],
    operacoes: ['listar_objetos', 'descrever_objeto', 'contar', 'consultar']
  }),
  agregar_gold: capacidade({
    dominio: 'gold', camada: 'gold', intencoes: ['agregar', 'ranquear'],
    entidades: ['objeto_gold'], campos: ['metricas'], operacoes: ['agregar']
  }),
  consultar_silver: capacidade({
    dominio: 'silver', camada: 'silver', intencoes: ['listar', 'descrever'],
    entidades: ['objeto_silver'], campos: ['schema', 'linhas'],
    operacoes: ['listar_objetos', 'descrever_objeto', 'contar', 'consultar']
  }),
  agregar_silver: capacidade({
    dominio: 'silver', camada: 'silver', intencoes: ['agregar', 'ranquear'],
    entidades: ['objeto_silver'], campos: ['metricas'], operacoes: ['agregar']
  }),
  consultar_bronze: capacidade({
    dominio: 'bronze', camada: 'bronze', intencoes: ['auditar', 'listar', 'descrever'],
    entidades: ['entidade_bronze'], campos: ['historico', 'registro_bruto'],
    operacoes: ['listar_entidades', 'descrever_entidade', 'consultar']
  }),
  agregar_bronze: capacidade({
    dominio: 'bronze', camada: 'bronze', intencoes: ['auditar', 'agregar'],
    entidades: ['entidade_bronze'], campos: ['historico', 'metricas'], operacoes: ['agregar']
  })
});

const FERRAMENTAS_POR_DOMINIO = Object.freeze(
  Object.entries(REGISTRO_CAPACIDADES).reduce((mapa, [nome, item]) => {
    mapa[item.dominio] ||= [];
    mapa[item.dominio].push(nome);
    return mapa;
  }, {})
);

function dominioCobreSolicitacao(dominio, intencao, campos = []) {
  const capacidades = (FERRAMENTAS_POR_DOMINIO[dominio] || [])
    .map((nome) => REGISTRO_CAPACIDADES[nome]);
  if (!capacidades.length) return false;
  const cobreIntencao = capacidades.some((item) => item.intencoes.includes(intencao));
  const camposDisponiveis = new Set(capacidades.flatMap((item) => item.campos));
  return cobreIntencao && campos.every((campo) => camposDisponiveis.has(campo));
}

const CHAVES_REFERENCIA = Object.freeze(new Set([
  'marketplace_pedido', 'marketplace_pedidos', 'id_nota_saida', 'ids_notas_saida',
  'id_produto', 'ids_produtos', 'sku', 'skus', 'ean', 'eans',
  'nota_fiscal', 'notas_fiscais', 'notas_fiscais_entrada',
  'documento_id', 'documento_ids'
]));

function valoresEscalares(valor) {
  if (Array.isArray(valor)) return valor.flatMap(valoresEscalares);
  if (['string', 'number', 'bigint'].includes(typeof valor)) return [String(valor)];
  return [];
}

function extrairReferenciasResultado(resultado) {
  const referencias = {};
  function visitar(valor) {
    if (!valor || typeof valor !== 'object') return;
    if (Array.isArray(valor)) {
      valor.forEach(visitar);
      return;
    }
    for (const [chave, item] of Object.entries(valor)) {
      if (CHAVES_REFERENCIA.has(chave)) {
        const valores = valoresEscalares(item);
        if (valores.length) {
          referencias[chave] ||= [];
          referencias[chave].push(...valores);
        }
      }
      visitar(item);
    }
  }
  visitar(resultado);
  return Object.fromEntries(Object.entries(referencias).map(([chave, valores]) => [
    chave,
    [...new Set(valores)]
  ]));
}

function obterCapacidade(nome) {
  return REGISTRO_CAPACIDADES[nome] || null;
}

function calcularOrcamentoTecnico(decisao, ferramentas = []) {
  const capacidades = ferramentas.map(obterCapacidade).filter(Boolean);
  const fachadas = capacidades.filter((item) => item.camada === 'negocio');
  const camposPedidos = decisao.camposSolicitados || [];
  const comparacaoCoberta = decisao.intencao === 'comparar' && fachadas.some(
    (item) => item.intencoes.includes('comparar') &&
      camposPedidos.every((campo) => item.campos.includes(campo))
  );
  const dominiosNecessarios = new Set(fachadas.map((item) => item.dominio));
  let consultasFinais = 1;
  if (decisao.intencao === 'comparar' && !comparacaoCoberta) consultasFinais = 2;
  if (dominiosNecessarios.size > 1) consultasFinais = Math.max(
    consultasFinais,
    Math.min(3, dominiosNecessarios.size)
  );
  return Object.freeze({ descoberta: 1, final: consultasFinais, maximoFinal: 3 });
}

function validarPlanoSugerido(decisao) {
  const dominios = new Set([
    decisao.dominioPrimario,
    ...(decisao.dominiosSecundarios || [])
  ].filter(Boolean));
  const contextoDecisao = JSON.stringify({
    pergunta: decisao.perguntaAutonoma,
    campos: decisao.camposSolicitados,
    filtros: decisao.filtros,
    requisitos: decisao.requisitosResposta
  }).toLowerCase();
  const influenciaPorPlataforma = decisao.intencao === 'comparar' &&
    /faturamento/.test(contextoDecisao) && /(marketplace|plataforma|canal)/.test(contextoDecisao);
  const rankingPedidosPagos = decisao.intencao === 'ranquear' &&
    /pedidos?.{0,20}pagos?/.test(contextoDecisao) &&
    /(produto|marca|plataforma|transportadora|cliente|grupo|categoria)/.test(contextoDecisao);
  if (influenciaPorPlataforma) dominios.add('influencias');
  if (rankingPedidosPagos) dominios.add('vendas');
  const aceitas = influenciaPorPlataforma
    ? ['analisar_influencias']
    : rankingPedidosPagos ? ['analisar_vendas'] : [];
  const rejeitadas = [];
  for (const sugestao of decisao.planoSugerido || []) {
    const nome = sugestao.ferramenta;
    if (influenciaPorPlataforma && ['analisar_indicadores', 'analisar_vendas'].includes(nome)) {
      continue;
    }
    if (rankingPedidosPagos && nome === 'analisar_desempenho') continue;
    const item = obterCapacidade(nome);

    if (!item) {
      rejeitadas.push({ ...sugestao, motivo: 'ferramenta_desconhecida' });
      continue;
    }

    if (item.camada === 'bronze' && decisao.intencao !== 'auditar') {
      rejeitadas.push({ ...sugestao, motivo: 'bronze_exige_auditoria' });
      continue;
    }

    if (item.camada === 'negocio' && !dominios.has(item.dominio) && item.dominio !== 'produto') {
      rejeitadas.push({ ...sugestao, motivo: 'dominio_incompativel' });
      continue;
    }

    if (item.camada !== 'negocio' && !dominios.has(item.dominio)) {
      rejeitadas.push({ ...sugestao, motivo: 'camada_nao_autorizada' });
      continue;
    }

    if (
      ['gold', 'silver'].includes(item.camada) &&
      item.dominio !== decisao.dominioPrimario &&
      !(decisao.capacidadesAusentes || []).length
    ) {
      rejeitadas.push({ ...sugestao, motivo: 'camada_sem_capacidade_ausente' });
      continue;
    }

    const ehFerramentaAuxiliar = FERRAMENTAS_AUXILIARES.has(nome);

    if (!ehFerramentaAuxiliar && !item.intencoes.includes(decisao.intencao)) {
      rejeitadas.push({ ...sugestao, motivo: 'intencao_incompativel' });
      continue;
    }

    aceitas.push(nome);
  }

  for (const dominio of dominios) {
    if (influenciaPorPlataforma && dominio === decisao.dominioPrimario && dominio !== 'influencias') {
      continue;
    }
    if (rankingPedidosPagos && dominio === decisao.dominioPrimario && dominio !== 'vendas') {
      continue;
    }
    if (dominio !== decisao.dominioPrimario) continue;
    if (dominio === 'hibrido') continue;
    if (dominio === 'bronze' && decisao.intencao !== 'auditar') continue;
    if (!aceitas.some((nome) => REGISTRO_CAPACIDADES[nome]?.dominio === dominio)) {
      const candidatas = FERRAMENTAS_POR_DOMINIO[dominio] || [];
      const camposPedidos = new Set(decisao.camposSolicitados || []);
      const preferida = [...candidatas]
        .filter((nome) => REGISTRO_CAPACIDADES[nome].intencoes.includes(decisao.intencao))
        .sort((a, b) => {
        function pontuar(nome) {
          const item = REGISTRO_CAPACIDADES[nome];
          return (item.intencoes.includes(decisao.intencao) ? 100 : 0) +
            item.campos.filter((campo) => camposPedidos.has(campo)).length;
        }
        return pontuar(b) - pontuar(a);
        })[0];
      if (preferida) aceitas.push(preferida);
    }
  }

  if (dominios.has('hibrido') && !aceitas.length) {
    aceitas.push(...Object.keys(REGISTRO_CAPACIDADES).filter(
      (nome) => REGISTRO_CAPACIDADES[nome].camada === 'negocio' && nome !== 'resolver_produto'
    ));
  }

  const ferramentas = [...new Set(aceitas)];
  const camposDisponiveis = new Set(ferramentas.flatMap(
    (nome) => REGISTRO_CAPACIDADES[nome]?.campos || []
  ));
  const camposAusentes = (decisao.camposSolicitados || [])
    .filter((campo) => !camposDisponiveis.has(campo));
  const dominiosExigidos = new Set([
    influenciaPorPlataforma ? 'influencias' : rankingPedidosPagos ? 'vendas' : decisao.dominioPrimario
  ]);
  for (const sugestao of decisao.planoSugerido || []) {
    const dominio = REGISTRO_CAPACIDADES[sugestao.ferramenta]?.dominio;
    if (influenciaPorPlataforma && dominio !== 'influencias') continue;
    if (rankingPedidosPagos && dominio !== 'vendas') continue;
    if (dominio && dominios.has(dominio)) dominiosExigidos.add(dominio);
  }
  const dominiosSemFerramenta = [...dominiosExigidos].filter((dominio) => (
    dominio !== 'hibrido' &&
    !ferramentas.some((nome) => REGISTRO_CAPACIDADES[nome]?.dominio === dominio)
  ));
  const filtrosAceitos = [];
  const filtrosRejeitados = [];
  const camposFiltroPermitidos = new Set([
    ...camposDisponiveis,
    ...ferramentas.flatMap((nome) => REGISTRO_CAPACIDADES[nome]?.entidades || []),
    'data_inicial', 'data_final', 'data_inicial_anterior', 'data_final_anterior',
    'periodo', 'periodo_comparacao_data_inicial', 'periodo_comparacao_data_final',
    'empresa', 'id_empresa', 'limite'
  ]);
  for (const filtro of decisao.filtros || []) {
    if (camposFiltroPermitidos.has(filtro.campo)) filtrosAceitos.push(filtro);
    else filtrosRejeitados.push({ ...filtro, motivo: 'campo_de_filtro_nao_coberto' });
  }
  const capacidadesDeclaradasAusentes = (decisao.capacidadesAusentes || []).filter((item) => {
    const nome = String(item).replace(/^campo:/, '');
    return !camposDisponiveis.has(nome);
  });
  return {
    ferramentas,
    rejeitadas,
    filtrosAceitos,
    filtrosRejeitados,
    capacidadesAusentes: [...new Set([
      ...capacidadesDeclaradasAusentes,
      ...camposAusentes.map((campo) => `campo:${campo}`),
      ...dominiosSemFerramenta.map((dominio) => `intencao:${decisao.intencao}@${dominio}`)
    ])],
    orcamentoTecnico: calcularOrcamentoTecnico(decisao, ferramentas)
  };
}

module.exports = {
  DOMINIOS,
  INTENCOES,
  REGISTRO_CAPACIDADES,
  calcularOrcamentoTecnico,
  dominioCobreSolicitacao,
  extrairReferenciasResultado,
  obterCapacidade,
  validarPlanoSugerido
};
