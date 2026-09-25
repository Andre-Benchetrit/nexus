function normalizar(texto) {
  return String(texto || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const ENTIDADES_CORPORATIVAS =
  /\b(pedidos?|vendas?|faturamentos?|estoques?|produtos?|notas?(?: fiscais?)?|agendamentos?|reposicoes?|fretes?|clientes?|funcionarios?|colaboradores?|pessoas?|margens?|bloqueios?|rupturas?|indicadores?|paineis?|dashboards?|relatorios? executivos?|procedimentos?|politicas? internas?|manuais?|processos? internos?)\b/;
const ACAO_OPERACIONAL =
  /\b(hoje|ontem|este mes|nesse mes|agora|atual|ultimo|ultima|quantos|quanto|quais|listar|liste|mostre|temos|verifique|verificar|consulte|consultar|analise|analisar|acompanhe|acompanhar|ranking|ranqueie|top|receita|faturou|vendeu|vendidos?)\b/;
const REFERENCIA_CONTINUIDADE =
  /\b(esse|essa|esses|essas|isso|ele|ela|eles|elas|deles|delas|anterior|anteriores|mesmos?|mesmas?|novamente|de novo|tambem|outros?|outras?|agora|periodo|relatorio|comparacao|compare|comparar|versus|filtro|coluna|codigo auxiliar|sku)\b/;
const RESPOSTA_AFIRMATIVA = /^(sim|pode|claro|isso|correto|confirmo|por favor)[.! ]*$/;
const AJUSTE_TEMPORAL_CURTO = /^(?:(?:e\s+)?(?:de fato|na verdade|correto|corretamente|quis dizer|corrigindo)\s+)?(?:o\s+ano\s+)?(?:19|20)\d{2}[.! ]*$/;

function exigeFonteCorporativa(pergunta, contexto = {}) {
  if (contexto.tarefaAtiva) {
    return { obrigatoria: true, motivo: 'tarefa_corporativa_ativa' };
  }
  const texto = normalizar(pergunta);
  const identificador = /\b\d{7,14}\b|\b\d{3}-\d{7}-\d{7}\b|\b(?=[A-Z0-9_]*\d)[A-Z0-9]{8,}(?:_[A-Z0-9]+)?\b/i.test(pergunta);
  const posseCorporativa = /\b(meu|minha|meus|minhas|nosso|nossa|nossos|nossas)\b/.test(texto) &&
    ENTIDADES_CORPORATIVAS.test(texto);
  const fatoOperacional = (
    ACAO_OPERACIONAL.test(texto) ||
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(texto)
  ) && ENTIDADES_CORPORATIVAS.test(texto);
  const ultimaPergunta = normalizar(contexto.ultimaPergunta);
  const ultimaResposta = normalizar(contexto.ultimaResposta);
  const contextoCorporativo = ['dados_nexus', 'misto'].includes(contexto.ultimaProveniencia) ||
    ENTIDADES_CORPORATIVAS.test(ultimaPergunta) ||
    /\b(consultar|reconsultar|reconsulte|consulte) (?:o )?nexus\b/.test(ultimaResposta);
  const possuiReferencia = REFERENCIA_CONTINUIDADE.test(texto) ||
    RESPOSTA_AFIRMATIVA.test(texto.trim()) ||
    AJUSTE_TEMPORAL_CURTO.test(texto.trim());
  const continuidadeCorporativa = contextoCorporativo && possuiReferencia && (
    ENTIDADES_CORPORATIVAS.test(texto) ||
    ENTIDADES_CORPORATIVAS.test(ultimaPergunta) ||
    /\bnexus\b/.test(ultimaResposta)
  );
  const sqlCorporativo = /\b(sql|query|select)\b/.test(texto) &&
    ENTIDADES_CORPORATIVAS.test(texto);
  const documentacaoCorporativa = /\b(procedimento|politica interna|manual|processo interno|instrucao de trabalho|passo a passo)\b/.test(texto) ||
    /\bcomo (?:devo|faco|realizo|executar)\b/.test(texto) && /\b(?:processo|empresa|setor|interno)\b/.test(texto) ||
    /\b(?:como|onde)\b.{0,60}\b(?:desbloque|liber|cadast|solicit|abr|alter|corrij|resolv|execut|realiz|acess)\w*/.test(texto) &&
      ENTIDADES_CORPORATIVAS.test(texto);
  if (identificador) return { obrigatoria: true, motivo: 'identificador_corporativo' };
  if (posseCorporativa) return { obrigatoria: true, motivo: 'posse_corporativa' };
  if (fatoOperacional) return { obrigatoria: true, motivo: 'fato_operacional_mutavel' };
  if (continuidadeCorporativa) return { obrigatoria: true, motivo: 'continuacao_corporativa' };
  if (sqlCorporativo) return { obrigatoria: true, motivo: 'sql_corporativo' };
  if (documentacaoCorporativa) return { obrigatoria: true, motivo: 'documentacao_corporativa' };
  return { obrigatoria: false, motivo: 'decisao_generalista' };
}

module.exports = { exigeFonteCorporativa };
