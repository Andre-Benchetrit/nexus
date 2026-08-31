const { obterCapacidade } = require('./capacidades');

const MODOS_ESCALONAMENTO = Object.freeze(['off', 'shadow', 'v1']);
const FAIXAS_SEMANTICAS = Object.freeze(['deterministica', 'basica', 'assistida', 'avancada']);
const TRANSFORMACOES_SIMPLES = Object.freeze(new Set([
  'agrupar', 'ordenar', 'destacar', 'resumir', 'formatar_tabela', 'remover_repeticoes'
]));
const TRANSFORMACOES_ASSISTIDAS = Object.freeze(new Set([
  'comparar_periodos', 'calcular_derivacao', 'explicar_variacao', 'combinar_evidencias'
]));
const CAMADAS_TECNICAS = Object.freeze(new Set(['gold', 'silver', 'bronze']));
const FERRAMENTAS_AUXILIARES = Object.freeze(new Set(['resolver_produto']));
const POLITICAS_DOMINIO = Object.freeze({
  vendas: Object.freeze({
    basicas: ['listar', 'resumir', 'ranquear', 'localizar', 'agregar'],
    assistidas: ['comparar', 'explicar', 'diagnosticar']
  }),
  indicadores: Object.freeze({
    basicas: ['listar', 'resumir'],
    assistidas: ['comparar', 'explicar']
  }),
  desempenho: Object.freeze({
    basicas: ['listar', 'resumir', 'ranquear'],
    assistidas: ['comparar', 'explicar']
  }),
  estoque: Object.freeze({
    basicas: ['listar', 'resumir', 'ranquear'],
    assistidas: ['comparar', 'diagnosticar', 'explicar']
  }),
  reposicoes: Object.freeze({
    basicas: ['listar', 'resumir', 'detalhar', 'agregar'],
    assistidas: ['comparar', 'diagnosticar', 'explicar']
  }),
  bloqueios_estoque: Object.freeze({
    basicas: ['listar', 'resumir', 'detalhar', 'enriquecer', 'agregar'],
    assistidas: ['diagnosticar', 'explicar']
  }),
  frete: Object.freeze({
    basicas: ['listar', 'resumir', 'ranquear'],
    assistidas: ['comparar', 'explicar']
  }),
  operacao: Object.freeze({
    basicas: ['listar', 'resumir', 'ranquear'],
    assistidas: ['comparar', 'diagnosticar', 'explicar']
  }),
  catalogo: Object.freeze({
    basicas: ['listar', 'resumir', 'detalhar', 'ranquear'],
    assistidas: ['comparar', 'explicar']
  }),
  pessoas: Object.freeze({
    basicas: ['listar', 'resumir', 'detalhar'],
    assistidas: ['comparar', 'explicar']
  }),
  documentacao: Object.freeze({
    basicas: ['listar', 'localizar', 'detalhar', 'resumir'],
    assistidas: ['explicar', 'comparar']
  })
});

function resolverModoEscalonamento(valor = process.env.NEXUS_SEMANTIC_ESCALATION_MODE || 'shadow') {
  const modo = String(valor || '').toLowerCase();
  if (!MODOS_ESCALONAMENTO.includes(modo)) {
    throw new Error(
      `NEXUS_SEMANTIC_ESCALATION_MODE invalido: ${modo}. Use ${MODOS_ESCALONAMENTO.join(', ')}.`
    );
  }
  return modo;
}

function resolverModoDadosGemini(valor = process.env.NEXUS_GEMINI_USAGE_MODE || 'disabled') {
  const modo = String(valor || '').toLowerCase();
  if (!['disabled', 'free_public', 'paid'].includes(modo)) {
    throw new Error(
      `NEXUS_GEMINI_USAGE_MODE invalido: ${modo}. Use disabled, free_public ou paid.`
    );
  }
  return modo;
}

function normalizarConfianca(valor) {
  if (Number.isFinite(Number(valor))) return Number(valor);
  if (valor === 'alta' || valor === 'explicita') return 0.95;
  if (valor === 'media') return 0.75;
  if (valor === 'baixa') return 0.4;
  return 0.7;
}

function normalizarTransformacoes(decisao = {}) {
  const recebidas = decisao.transformacoesSolicitadas || decisao.transformacoes_solicitadas || [];
  const transformacoes = new Set(recebidas.map((item) => String(item).toLowerCase()));
  if (decisao.intencao === 'agregar') transformacoes.add('agrupar');
  if (decisao.intencao === 'ranquear') transformacoes.add('ordenar');
  if (decisao.intencao === 'comparar') transformacoes.add('comparar_periodos');
  return [...transformacoes].filter(Boolean);
}

function resultadoPossuiSinal(valor, chaves) {
  if (!valor || typeof valor !== 'object') return false;
  if (Array.isArray(valor)) return valor.some((item) => resultadoPossuiSinal(item, chaves));
  for (const [chave, item] of Object.entries(valor)) {
    if (chaves.has(chave) && item === true) return true;
    if (resultadoPossuiSinal(item, chaves)) return true;
  }
  return false;
}

function faixaPorPontos(pontos, limites = {}) {
  const maxBasica = Number(limites.maxBasica ?? process.env.NEXUS_SEMANTIC_BASIC_MAX_SCORE ?? 1);
  const maxAssistida = Number(
    limites.maxAssistida ?? process.env.NEXUS_SEMANTIC_ASSISTED_MAX_SCORE ?? 3
  );
  if (pontos <= maxBasica) return 'basica';
  if (pontos <= maxAssistida) return 'assistida';
  return 'avancada';
}

function maiorFaixa(a, b) {
  return FAIXAS_SEMANTICAS.indexOf(a) >= FAIXAS_SEMANTICAS.indexOf(b) ? a : b;
}

function avaliarFaixaSemantica({
  decisao = {},
  plano = {},
  ferramentasExecutadas = [],
  resultadosTools = [],
  aprofundamento = null,
  recuperacao = null,
  limites = {},
  faixaForcada = 'auto'
} = {}) {
  const ferramentasPlanejadas = plano.ferramentas || [];
  const ferramentas = [...new Set([...ferramentasPlanejadas, ...ferramentasExecutadas])]
    .filter(Boolean);
  const ferramentasDeEvidencia = ferramentas.filter((nome) => !FERRAMENTAS_AUXILIARES.has(nome));
  const dominiosDeEvidencia = ferramentasDeEvidencia
    .map((nome) => obterCapacidade(nome)?.dominio)
    .filter(Boolean);
  const dominios = [...new Set(
    dominiosDeEvidencia.length ? dominiosDeEvidencia : [decisao.dominioPrimario].filter(Boolean)
  )];
  const transformacoes = normalizarTransformacoes(decisao);
  const motivos = [];
  let pontos = 0;

  const simples = transformacoes.filter((item) => TRANSFORMACOES_SIMPLES.has(item));
  const assistidas = transformacoes.filter((item) => TRANSFORMACOES_ASSISTIDAS.has(item));
  if (simples.length) {
    pontos += 1;
    motivos.push('transformacao_simples');
  }
  if (assistidas.length) {
    pontos += 2;
    motivos.push('transformacao_assistida');
  }
  const politicaDominio = POLITICAS_DOMINIO[decisao.dominioPrimario];
  if (politicaDominio?.assistidas.includes(decisao.intencao) && pontos < 2) {
    pontos = 2;
    motivos.push(`intencao_assistida:${decisao.dominioPrimario}`);
  }
  if (ferramentasDeEvidencia.length >= 2) {
    pontos += 2;
    motivos.push('multiplas_tools');
  }
  if (dominios.length >= 2) {
    pontos += 2;
    motivos.push('multiplos_dominios');
  }
  const confianca = normalizarConfianca(decisao.confianca);
  if (confianca < 0.6) {
    pontos += 2;
    motivos.push('confianca_baixa');
  }
  if ((plano.rejeitadas || []).length || (plano.filtrosRejeitados || []).length) {
    pontos += 2;
    motivos.push('plano_parcialmente_rejeitado');
  }
  if ((plano.capacidadesAusentes || decisao.capacidadesAusentes || []).length) {
    pontos += 3;
    motivos.push('capacidade_ausente');
  }
  if (ferramentas.some((nome) => /_(gold|silver|bronze)$/.test(nome))) {
    pontos += 3;
    motivos.push('camada_tecnica');
  }
  if (aprofundamento) {
    pontos += 3;
    motivos.push(`aprofundamento_${aprofundamento.camada}`);
  }
  if (recuperacao) {
    pontos += 3;
    motivos.push('rota_recuperada');
  }
  if (resultadoPossuiSinal(
    resultadosTools.map((item) => item.resultado ?? item),
    new Set(['resultado_truncado', 'truncado', 'divergencia', 'status_conflitante'])
  )) {
    pontos += 2;
    motivos.push('evidencia_exige_interpretacao');
  }

  const risco = decisao.riscoSemantico || decisao.risco_semantico || 'baixo';
  const intervencao = Boolean(
    decisao.necessidadeIntervencao ?? decisao.necessidade_intervencao
  );
  const lacunaConfirmada = (plano.capacidadesAusentes || []).length > 0 ||
    (plano.rejeitadas || []).length > 0 || (plano.filtrosRejeitados || []).length > 0;
  if (intervencao && (risco === 'alto' || lacunaConfirmada)) {
    pontos += risco === 'alto' ? 4 : 2;
    motivos.push('intervencao_sugerida_router');
  } else if (intervencao) {
    motivos.push('intervencao_sugerida_sem_elevacao');
  }

  const regraAvancada = (
    ['auditar', 'validar'].includes(decisao.intencao) ||
    decisao.dominioPrimario === 'sql' ||
    CAMADAS_TECNICAS.has(decisao.dominioPrimario) ||
    (plano.capacidadesAusentes || []).length > 0 ||
    (plano.rejeitadas || []).length > 0 ||
    risco === 'alto' ||
    confianca < 0.6
  );
  let faixa = faixaPorPontos(pontos, limites);
  if (regraAvancada) {
    faixa = 'avancada';
    motivos.push('regra_avancada');
  }
  const sugerida = decisao.complexidadeSugerida || decisao.complexidade_sugerida || null;
  if (sugerida === 'assistida' && faixa === 'basica' && (risco === 'alto' || lacunaConfirmada)) {
    faixa = 'assistida';
  }
  if (sugerida === 'avancada' && (risco === 'alto' || lacunaConfirmada)) faixa = 'avancada';
  if (faixaForcada && faixaForcada !== 'auto') {
    if (!FAIXAS_SEMANTICAS.includes(faixaForcada)) {
      throw new Error(`Faixa semantica invalida: ${faixaForcada}.`);
    }
    const elevada = maiorFaixa(faixa, faixaForcada);
    if (elevada !== faixa) motivos.push('faixa_elevada_explicitamente');
    faixa = elevada;
  }

  return {
    faixa,
    pontos,
    confianca,
    motivos: [...new Set(motivos)],
    transformacoes,
    dominios,
    ferramentas,
    sugerida,
    risco
  };
}

function configuracaoFaixa(faixa, dependencias = {}) {
  const prefixo = faixa === 'basica' ? 'BASIC' : faixa === 'assistida' ? 'ASSISTED' : 'ADVANCED';
  const chaves = {
    basica: ['basicProviderNome', 'basicModelo'],
    assistida: ['assistedProviderNome', 'assistedModelo'],
    avancada: ['advancedProviderNome', 'advancedModelo']
  }[faixa] || [];
  const provider = dependencias[chaves[0]] || process.env[`NEXUS_MODEL_TIER_${prefixo}_PROVIDER`] || '';
  const modelo = dependencias[chaves[1]] || process.env[`NEXUS_MODEL_TIER_${prefixo}_MODEL`] || '';
  return { provider: String(provider).toLowerCase(), modelo: String(modelo), faixa };
}

function validarProviderParaDados(provider, classificacaoDados, dependencias = {}) {
  if (String(provider).toLowerCase() !== 'gemini') {
    return { permitido: true, motivo: 'provider_sem_restricao_especifica' };
  }
  const modoGemini = resolverModoDadosGemini(dependencias.geminiUsageMode);
  if (modoGemini === 'disabled') {
    return { permitido: false, motivo: 'gemini_desativado', modoGemini };
  }
  const corporativo = !['publico', 'conhecimento_geral'].includes(classificacaoDados);
  if (corporativo && modoGemini !== 'paid') {
    return { permitido: false, motivo: 'gemini_gratuito_nao_autorizado_para_dados_internos', modoGemini };
  }
  return { permitido: true, motivo: 'politica_dados_atendida', modoGemini };
}

function selecionarProviderDaFaixa(faixa, dependencias = {}, classificacaoDados = 'dados_corporativos') {
  const configuracao = configuracaoFaixa(faixa, dependencias);
  if (!configuracao.provider || !configuracao.modelo) {
    return { ...configuracao, usarAtual: true, permitido: true, motivo: 'faixa_sem_override' };
  }
  const politica = validarProviderParaDados(
    configuracao.provider,
    classificacaoDados,
    dependencias
  );
  return {
    ...configuracao,
    ...politica,
    usarAtual: !politica.permitido
  };
}

module.exports = {
  FAIXAS_SEMANTICAS,
  MODOS_ESCALONAMENTO,
  POLITICAS_DOMINIO,
  avaliarFaixaSemantica,
  configuracaoFaixa,
  faixaPorPontos,
  maiorFaixa,
  normalizarTransformacoes,
  resolverModoDadosGemini,
  resolverModoEscalonamento,
  selecionarProviderDaFaixa,
  validarProviderParaDados
};
