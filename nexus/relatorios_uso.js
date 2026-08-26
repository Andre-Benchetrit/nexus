const FILTROS = Object.freeze({
  provider: 'lc.provider', modelo: 'lc.modelo', stage: 'lc.stage', finalidade: 't.finalidade',
  principal: 'p.slug', setor: 'd.slug', sessao: 'c.chave_sessao',
  faixa: 't.semantic_tier_final'
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
      count(*) FILTER (WHERE lc.status='sucesso' AND lc.pricing_usd_complete)::int AS chamadas_precificadas_usd,
      count(*) FILTER (WHERE lc.status='sucesso' AND NOT lc.pricing_usd_complete)::int AS chamadas_sem_preco,
      count(*) FILTER (WHERE lc.status='sucesso' AND lc.pricing_usd_complete
        AND NOT lc.pricing_brl_complete)::int AS chamadas_sem_cambio
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
  const porFaixa = (await pool.query(`
    SELECT COALESCE(t.semantic_tier_final,'nao_classificada') AS faixa,
      count(DISTINCT t.id)::int AS turnos, count(lc.id)::int AS chamadas,
      COALESCE(sum(lc.input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(lc.output_tokens),0)::bigint AS output_tokens,
      sum(lc.estimated_cost_usd) AS custo_usd,
      sum(lc.estimated_cost_brl) AS custo_brl
    ${joins} ${filtro.sql}
    GROUP BY COALESCE(t.semantic_tier_final,'nao_classificada')
    ORDER BY custo_usd DESC NULLS LAST, chamadas DESC
  `, filtro.valores)).rows;
  const valoresServico = [];
  const condicoesServico = ["u.tipo_chamada='service'"];
  if (opcoes.de) { valoresServico.push(opcoes.de); condicoesServico.push(`t.criado_em >= $${valoresServico.length}::timestamptz`); }
  if (opcoes.ate) { valoresServico.push(opcoes.ate); condicoesServico.push(`t.criado_em < $${valoresServico.length}::timestamptz`); }
  if (opcoes.principal) { valoresServico.push(opcoes.principal); condicoesServico.push(`p.slug=$${valoresServico.length}`); }
  if (opcoes.setor) { valoresServico.push(opcoes.setor); condicoesServico.push(`d.slug=$${valoresServico.length}`); }
  if (opcoes.sessao) { valoresServico.push(opcoes.sessao); condicoesServico.push(`c.chave_sessao=$${valoresServico.length}`); }
  const porServico = (await pool.query(`
    SELECT u.provider,u.servico,u.modelo,u.metrica,count(*)::int AS registros,
      sum(u.quantidade) AS quantidade,sum(u.custo_usd) AS custo_usd,sum(u.custo_brl) AS custo_brl,
      count(*) FILTER (WHERE u.pricing_status='pricing_missing')::int AS sem_preco
    FROM nexus.usage_line_items u JOIN nexus.ai_turns t ON t.id=u.turn_id
    LEFT JOIN nexus.principals p ON p.id=t.principal_id
    LEFT JOIN nexus.departments d ON d.id=t.department_id
    LEFT JOIN nexus.conversations c ON c.id=t.conversation_id
    WHERE ${condicoesServico.join(' AND ')}
    GROUP BY u.provider,u.servico,u.modelo,u.metrica
    ORDER BY custo_usd DESC NULLS LAST,quantidade DESC
  `, valoresServico)).rows;
  const servicosUsd = porServico.reduce((total, item) => total + Number(item.custo_usd || 0), 0);
  const servicosBrl = porServico.reduce((total, item) => total + Number(item.custo_brl || 0), 0);
  resumo.chamadas_servico = porServico.reduce((total, item) => total + Number(item.registros || 0), 0);
  if (servicosUsd) resumo.custo_usd = Number(resumo.custo_usd || 0) + servicosUsd;
  if (servicosBrl) resumo.custo_brl = Number(resumo.custo_brl || 0) + servicosBrl;
  return { resumo, porModelo, porServico, porAtribuicao, porFinalidade, porFaixa };
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
    SELECT id AS call_id, parent_call_id, fallback_from_call_id, 'llm' AS tipo, stage, purpose,
      provider, modelo, semantic_tier, status, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, composicao_input_estimada,
      estimated_cost_usd, estimated_cost_brl, pricing_usd_complete, pricing_brl_complete,
      duracao_ms, erro_codigo, criada_em
    FROM nexus.llm_calls WHERE trace_id=$1
    UNION ALL
    SELECT COALESCE(call_id,id) AS call_id, parent_call_id, NULL::uuid AS fallback_from_call_id, 'tool' AS tipo,
      stage, purpose, provider, modelo, NULL::text AS semantic_tier, status, NULL, NULL, NULL, NULL,
      '{}'::jsonb, NULL, NULL, NULL, NULL, duracao_ms, erro_codigo, criada_em
    FROM nexus.tool_executions WHERE trace_id=$1
    ORDER BY criada_em, call_id
  `, [traceId])).rows;
  const eventos = (await pool.query(`
    SELECT tipo,recurso,resultado,metadados,call_id,criado_em
    FROM nexus.audit_events WHERE trace_id=$1
      AND tipo IN (
        'provider_handoff','memory_review_signal','memory_assessment','memory_candidate',
        'semantic_tier_decision','corporate_evidence','synthesis_validation',
        'tool_arguments_normalized','web_synthesis_validation','web_search_shadow'
      )
    ORDER BY criado_em,id
  `, [traceId])).rows;
  const consumoServicos = (await pool.query(`
    SELECT call_id,provider,servico,modelo,metrica,quantidade,custo_usd,custo_brl,pricing_status,criado_em
    FROM nexus.usage_line_items WHERE turn_id=$1 AND tipo_chamada='service'
    ORDER BY criado_em,id
  `, [turno.id])).rows;
  return { turno, chamadas, eventos, consumoServicos };
}

async function relatorioComparativo(pool, opcoes = {}) {
  const sessoes = [...new Set((Array.isArray(opcoes.sessoes) ? opcoes.sessoes :
    String(opcoes.sessoes || '').split(',')).map((item) => String(item).trim()).filter(Boolean))];
  if (sessoes.length < 2) throw new Error('Informe ao menos duas sessoes para comparar.');
  const parametros = [sessoes];
  const periodo = [];
  if (opcoes.de) { parametros.push(opcoes.de); periodo.push(`t.criado_em >= $${parametros.length}::timestamptz`); }
  if (opcoes.ate) { parametros.push(opcoes.ate); periodo.push(`t.criado_em < $${parametros.length}::timestamptz`); }
  const filtroPeriodo = periodo.length ? `AND ${periodo.join(' AND ')}` : '';
  const linhas = (await pool.query(`
    WITH turnos AS (
      SELECT t.id, t.trace_id, t.status, t.duracao_ms, c.chave_sessao AS composicao
      FROM nexus.ai_turns t
      JOIN nexus.conversations c ON c.id=t.conversation_id
      WHERE c.chave_sessao = ANY($1::text[]) ${filtroPeriodo}
    ), chamadas AS (
      SELECT tt.composicao,
        count(lc.id)::int AS chamadas,
        count(*) FILTER (WHERE lc.status='erro')::int AS chamadas_erro,
        count(*) FILTER (WHERE lc.fallback_from_call_id IS NOT NULL)::int AS fallbacks,
        COALESCE(sum(lc.input_tokens),0)::bigint AS input_tokens,
        COALESCE(sum(lc.output_tokens),0)::bigint AS output_tokens,
        sum(lc.estimated_cost_usd) AS custo_usd,
        sum(lc.estimated_cost_brl) AS custo_brl,
        round(avg(lc.duracao_ms),2) AS latencia_llm_media_ms
      FROM turnos tt LEFT JOIN nexus.llm_calls lc ON lc.turn_id=tt.id
      GROUP BY tt.composicao
    ), tools_por_turno AS (
      SELECT tt.composicao, te.turn_id, te.tool_name, te.argument_keys,
        count(*) FILTER (WHERE te.status='sucesso')::int AS execucoes
      FROM turnos tt JOIN nexus.tool_executions te ON te.turn_id=tt.id
      GROUP BY tt.composicao, te.turn_id, te.tool_name, te.argument_keys
    ), tools AS (
      SELECT composicao, sum(execucoes)::int AS tools,
        COALESCE(sum(GREATEST(execucoes - 1, 0)),0)::int AS possiveis_tools_duplicadas
      FROM tools_por_turno GROUP BY composicao
    ), evidencias AS (
      SELECT tt.composicao,
        count(DISTINCT tt.id) FILTER (WHERE ae.tipo='corporate_evidence'
          AND ae.resultado IN ('complete','empty'))::int AS turnos_evidencia_integra,
        count(*) FILTER (WHERE ae.tipo='synthesis_validation'
          AND ae.resultado='corporate_fallback')::int AS perdas_evidencia_corrigidas,
        count(*) FILTER (WHERE ae.tipo='tool_arguments_normalized')::int AS argumentos_normalizados
      FROM turnos tt LEFT JOIN nexus.audit_events ae ON ae.turn_id=tt.id
      GROUP BY tt.composicao
    )
    SELECT tt.composicao,
      count(*)::int AS turnos,
      count(*) FILTER (WHERE tt.status='sucesso')::int AS turnos_sucesso,
      round(avg(tt.duracao_ms),2) AS latencia_turno_media_ms,
      c.chamadas, c.chamadas_erro, c.fallbacks, c.input_tokens, c.output_tokens,
      c.custo_usd, c.custo_brl, c.latencia_llm_media_ms,
      COALESCE(tools.tools,0) AS tools,
      COALESCE(tools.possiveis_tools_duplicadas,0) AS possiveis_tools_duplicadas,
      e.turnos_evidencia_integra, e.perdas_evidencia_corrigidas, e.argumentos_normalizados
    FROM turnos tt
    JOIN chamadas c ON c.composicao=tt.composicao
    LEFT JOIN tools ON tools.composicao=tt.composicao
    JOIN evidencias e ON e.composicao=tt.composicao
    GROUP BY tt.composicao, c.chamadas, c.chamadas_erro, c.fallbacks, c.input_tokens,
      c.output_tokens, c.custo_usd, c.custo_brl, c.latencia_llm_media_ms,
      tools.tools, tools.possiveis_tools_duplicadas, e.turnos_evidencia_integra,
      e.perdas_evidencia_corrigidas, e.argumentos_normalizados
    ORDER BY tt.composicao
  `, parametros)).rows;
  return {
    criterioAcerto: 'proxy: turno concluido com evidencia corporativa complete/empty',
    avisoDuplicidade: 'possiveis_tools_duplicadas compara tool e chaves; confirme no trace antes de concluir duplicacao',
    composicoes: linhas.map((item) => ({
      ...item,
      acerto_funcional_observado_pct: item.turnos
        ? Number((100 * Number(item.turnos_evidencia_integra || 0) / Number(item.turnos)).toFixed(2))
        : 0,
      chamadas_por_turno: item.turnos
        ? Number((Number(item.chamadas || 0) / Number(item.turnos)).toFixed(2)) : 0,
      custo_usd_por_turno: item.custo_usd == null || !item.turnos
        ? null : Number(item.custo_usd) / Number(item.turnos)
    }))
  };
}

module.exports = { construirFiltros, relatorioComparativo, relatorioExecutivo, relatorioTrace };
