function normalizar(texto) {
  return String(texto || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function exigeFonteCorporativa(pergunta, contexto = {}) {
  if (contexto.tarefaAtiva) {
    return { obrigatoria: true, motivo: 'tarefa_corporativa_ativa' };
  }
  const texto = normalizar(pergunta);
  const identificador = /\b\d{7,14}\b|\b\d{3}-\d{7}-\d{7}\b|\b(?=[A-Z0-9_]*\d)[A-Z0-9]{8,}(?:_[A-Z0-9]+)?\b/i.test(pergunta);
  const posseCorporativa = /\b(meu|minha|meus|minhas|nosso|nossa|nossos|nossas)\b/.test(texto) &&
    /\b(pedidos?|vendas?|faturamentos?|estoques?|produtos?|notas?|agendamentos?|reposicoes?|fretes?|clientes?|funcionarios?|margens?)\b/.test(texto);
  const fatoOperacional = /\b(hoje|ontem|este mes|nesse mes|agora|atual|ultimo|ultima|quantos|quanto|listar|mostre)\b/.test(texto) &&
    /\b(pedidos?|vendas?|faturamentos?|estoques?|bloqueios?|rupturas?|agendamentos?|reposicoes?|notas? fiscais?|fretes?)\b/.test(texto);
  const sqlCorporativo = /\b(sql|query|select)\b/.test(texto) &&
    /\b(pedidos?|vendas?|faturamentos?|estoques?|produtos?|notas?|agendamentos?|reposicoes?|fretes?|clientes?|funcionarios?)\b/.test(texto);
  if (identificador) return { obrigatoria: true, motivo: 'identificador_corporativo' };
  if (posseCorporativa) return { obrigatoria: true, motivo: 'posse_corporativa' };
  if (fatoOperacional) return { obrigatoria: true, motivo: 'fato_operacional_mutavel' };
  if (sqlCorporativo) return { obrigatoria: true, motivo: 'sql_corporativo' };
  return { obrigatoria: false, motivo: 'decisao_generalista' };
}

module.exports = { exigeFonteCorporativa };
