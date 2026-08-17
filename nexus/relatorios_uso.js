const FILTROS = Object.freeze({
  provider: 'lc.provider', modelo: 'lc.modelo', stage: 'lc.stage', finalidade: 't.finalidade',
  principal: 'p.slug', setor: 'd.slug', sessao: 'c.chave_sessao'
});

function construirFiltros(opcoes = {}) {
  const condicoes = [];
  const valores = [];
  if (opcoes.de) { valores.push(opcoes.de); condicoes.push(`t.criado_em >= $${valores.length}::timestamptz`); }
  if (opcoes.ate) { valores.push(opcoes.ate); condicoes.push(`t.criado_em < $${valores.length}::timestamptz`); }
  for (const [chave, coluna] of Object.entries(FILTROS)) {
    if (opcoes[chave]) { valores.push(opcoes[chave]); condicoes.push(`${coluna} = $${valores.length}`); }
  }
  return { sql: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '', valores };
}

async function relatorioExecutivo(pool, opcoes = {}) {
  const filtro = construirFiltros(opcoes);
  const joins = `
    FROM nexus.ai_turns t
    LEFT JOIN nexus.llm_calls lc ON lc.turn_id=t.id
    LEFT JOIN nexus.principals p ON p.id=t.principal_id
    LEFT JOIN nexus.departments d ON d.id=t.department_id
    LEFT JOIN nexus.conversations c ON c.id=t.conversation_id`;
  const resumo = (await pool.query(`
    SELECT count(DISTINCT t.id)::int AS turnos, count(lc.id)::int AS chamadas_llm,
      COALESCE(sum(lc.input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(lc.output_tokens),0)::bigint AS output_tokens,
      COALESCE(sum(lc.cache_read_tokens),0)::bigint AS cache_read_tokens,
      COALESCE(sum(lc.cache_write_tokens),0)::bigint AS cache_write_tokens,
      sum(lc.estimated_cost_usd) AS custo_usd,
      sum(lc.estimated_cost_brl) AS custo_brl,
      round(avg(lc.duracao_ms),2) AS latencia_media_ms,
      count(*) FILTER (WHERE lc.status='erro')::int AS erros,
      count(*) FILTER (WHERE lc.status='sucesso' AND lc.pricing_complete)::int AS chamadas_precificadas,
      count(*) FILTER (WHERE lc.status='sucesso' AND NOT lc.pricing_complete)::int AS chamadas_sem_preco
    ${joins} ${filtro.sql}
  `, filtro.valores)).rows[0];
  const porModelo = (await pool.query(`
    SELECT lc.provider, lc.modelo, lc.stage, count(*)::int AS chamadas,
      COALESCE(sum(lc.input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(lc.output_tokens),0)::bigint AS output_tokens,
      sum(lc.estimated_cost_usd) AS custo_usd,
      sum(lc.estimated_cost_brl) AS custo_brl
    ${joins} ${filtro.sql ? `${filtro.sql} AND` : 'WHERE'} lc.id IS NOT NULL
    GROUP BY lc.provider, lc.modelo, lc.stage ORDER BY custo_usd DESC NULLS LAST, chamadas DESC
  `, filtro.valores)).rows;
  const porAtribuicao = (await pool.query(`
    SELECT p.slug AS principal, COALESCE(d.slug, 'sem_setor') AS setor,
      count(DISTINCT t.id)::int AS turnos, count(lc.id)::int AS chamadas,
      COALESCE(sum(lc.input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(lc.output_tokens),0)::bigint AS output_tokens,
      sum(lc.estimated_cost_usd) AS custo_usd,
      sum(lc.estimated_cost_brl) AS custo_brl
    ${joins} ${filtro.sql}
    GROUP BY p.slug, COALESCE(d.slug, 'sem_setor')
    ORDER BY custo_usd DESC NULLS LAST, chamadas DESC
  `, filtro.valores)).rows;
  const porFinalidade = (await pool.query(`
    SELECT t.finalidade, count(DISTINCT t.id)::int AS turnos, count(lc.id)::int AS chamadas,
      COALESCE(sum(lc.input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(lc.output_tokens),0)::bigint AS output_tokens,
      sum(lc.estimated_cost_usd) AS custo_usd,
      sum(lc.estimated_cost_brl) AS custo_brl
    ${joins} ${filtro.sql}
    GROUP BY t.finalidade ORDER BY custo_usd DESC NULLS LAST, chamadas DESC
  `, filtro.valores)).rows;
  return { resumo, porModelo, porAtribuicao, porFinalidade };
}

async function relatorioTrace(pool, traceId) {
  const turno = (await pool.query(`
    SELECT t.*, p.slug AS principal, d.slug AS setor, c.chave_sessao AS sessao
    FROM nexus.ai_turns t
    LEFT JOIN nexus.principals p ON p.id=t.principal_id
    LEFT JOIN nexus.departments d ON d.id=t.department_id
    LEFT JOIN nexus.conversations c ON c.id=t.conversation_id
    WHERE t.trace_id=$1
  `, [traceId])).rows[0];
  if (!turno) throw new Error(`Trace nao encontrado: ${traceId}`);
  const chamadas = (await pool.query(`
    SELECT id AS call_id, parent_call_id, 'llm' AS tipo, stage, purpose,
      provider, modelo, status, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, composicao_input_estimada,
      estimated_cost_usd, estimated_cost_brl, duracao_ms, erro_codigo, criada_em
    FROM nexus.llm_calls WHERE trace_id=$1
    UNION ALL
    SELECT COALESCE(call_id,id) AS call_id, parent_call_id, 'tool' AS tipo,
      stage, purpose, provider, modelo, status, NULL, NULL, NULL, NULL,
      '{}'::jsonb, NULL, NULL, duracao_ms, erro_codigo, criada_em
    FROM nexus.tool_executions WHERE trace_id=$1
    ORDER BY criada_em, call_id
  `, [traceId])).rows;
  return { turno, chamadas };
}

module.exports = { construirFiltros, relatorioExecutivo, relatorioTrace };
