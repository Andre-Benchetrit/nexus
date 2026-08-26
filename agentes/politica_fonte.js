function normalizar(texto) {
  return String(texto || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const ENTIDADES_CORPORATIVAS =
  /\b(pedidos?|vendas?|faturamentos?|estoques?|produtos?|notas?(?: fiscais?)?|agendamentos?|reposicoes?|fretes?|clientes?|funcionarios?|colaboradores?|pessoas?|margens?|bloqueios?|rupturas?)\b/;
const ACAO_OPERACIONAL =
  /\b(hoje|ontem|este mes|nesse mes|agora|atual|ultimo|ultima|quantos|quanto|quais|listar|liste|mostre|temos|verifique|verificar|consulte|consultar|analise|analisar|acompanhe|acompanhar)\b/;
const REFERENCIA_CONTINUIDADE =
  /\b(esse|essa|esses|essas|deles|delas|mesmos?|mesmas?|novamente|de novo|tambem|outros?|outras?|agora)\b/;

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
  const continuidadeCorporativa = ['dados_nexus', 'misto'].includes(contexto.ultimaProveniencia) &&
    REFERENCIA_CONTINUIDADE.test(texto) && ENTIDADES_CORPORATIVAS.test(texto);
  const sqlCorporativo = /\b(sql|query|select)\b/.test(texto) &&
    ENTIDADES_CORPORATIVAS.test(texto);
  if (identificador) return { obrigatoria: true, motivo: 'identificador_corporativo' };
  if (posseCorporativa) return { obrigatoria: true, motivo: 'posse_corporativa' };
  if (fatoOperacional) return { obrigatoria: true, motivo: 'fato_operacional_mutavel' };
  if (continuidadeCorporativa) return { obrigatoria: true, motivo: 'continuacao_corporativa' };
  if (sqlCorporativo) return { obrigatoria: true, motivo: 'sql_corporativo' };
  return { obrigatoria: false, motivo: 'decisao_generalista' };
}

module.exports = { exigeFonteCorporativa };
