const { randomUUID } = require('node:crypto');
const { comTransacao } = require('./db');

const METRICAS_TOKEN = Object.freeze({
  input_tokens: 'uncachedInputTokens',
  output_tokens: 'outputTokens',
  cache_read_tokens: 'cacheReadTokens',
  cache_write_tokens: 'cacheWriteTokens'
});
const CHAVE_SENSIVEL = /prompt|message|mensagem|content|conteudo|document|resultado|sql|token|secret|senha|password|credential|api.?key/i;

function codigoErro(erro) {
  const valor = erro?.codigo || erro?.code || erro?.status || erro?.name;
  if (valor && /^[A-Za-z0-9_-]{2,80}$/.test(String(valor))) return String(valor).toUpperCase();
  return erro ? 'ERRO_LLM' : null;
}

function sanitizarMetadados(valor) {
  if (Array.isArray(valor)) return valor.map(sanitizarMetadados);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.entries(valor)
    .filter(([chave]) => !CHAVE_SENSIVEL.test(chave))
    .map(([chave, item]) => [chave, sanitizarMetadados(item)]));
}

function sanitizarComposicao(valor = {}) {
  const permitidas = new Set([
    'instrucoes', 'historico', 'usuario', 'schemas_capabilities',
    'resultados_tools', 'nao_atribuido'
  ]);
  return {
    ...Object.fromEntries(Object.entries(valor)
      .filter(([chave, item]) => permitidas.has(chave) && Number.isFinite(Number(item)))
      .map(([chave, item]) => [chave, Math.max(0, Math.round(Number(item)))])),
    metodo: String(valor.metodo || 'nao_informado').slice(0, 80)
  };
}

function modoPoliticaUso(valor = process.env.NEXUS_USAGE_POLICY_MODE || 'observe') {
  const modo = String(valor).toLowerCase();
  if (!['observe', 'enforce'].includes(modo)) {
    throw new Error(`NEXUS_USAGE_POLICY_MODE invalido: ${modo}.`);
  }
  return modo;
}

async function resolverContexto(pool, { principalSlug = 'legacy-cli', sessao = 'padrao', departamentoSlug = null }) {
  const principal = (await pool.query(
    'SELECT id FROM nexus.principals WHERE slug=$1 AND ativo=true', [principalSlug]
  )).rows[0];
  if (!principal) throw new Error(`Principal ativo nao encontrado: ${principalSlug}`);
  const conversa = (await pool.query(`
    INSERT INTO nexus.conversations (principal_id, chave_sessao)
    VALUES ($1,$2)
    ON CONFLICT (principal_id, chave_sessao)
    DO UPDATE SET atualizada_em=now()
    RETURNING id
  `, [principal.id, sessao])).rows[0];
  let departamentoId = null;
  if (departamentoSlug) {
    const departamento = (await pool.query(`
      SELECT d.id FROM nexus.departments d
      JOIN nexus.principal_departments pd ON pd.department_id=d.id
      WHERE d.slug=$1 AND d.ativo=true AND pd.principal_id=$2
    `, [departamentoSlug, principal.id])).rows[0];
    if (!departamento) throw new Error(`Setor ativo nao encontrado: ${departamentoSlug}`);
    departamentoId = departamento.id;
  }
  return { principalId: principal.id, conversationId: conversa.id, departamentoId };
}

function criarServicoAuditoriaIA(opcoes = {}) {
  const { pool } = opcoes;
  if (!pool) throw new Error('Pool PostgreSQL obrigatorio para auditoria de IA.');
  const contextoBase = {
    principalSlug: opcoes.principalSlug || 'legacy-cli',
    sessao: opcoes.sessao || 'padrao',
    departamentoSlug: opcoes.departamentoSlug || null,
    principalId: opcoes.principalId || null,
    conversationId: opcoes.conversationId || null,
    departamentoId: opcoes.departamentoId || null
  };
  const modo = modoPoliticaUso(opcoes.modo);
  let contextoResolvido;

  async function contexto() {
    contextoResolvido ||= contextoBase.principalId && contextoBase.conversationId
      ? Promise.resolve({
        principalId: contextoBase.principalId,
        conversationId: contextoBase.conversationId,
        departamentoId: contextoBase.departamentoId
      })
      : resolverContexto(pool, contextoBase);
    return contextoResolvido;
  }

  async function beforeModelCall() {
    return { allowed: true, mode: modo };
  }

  async function iniciarTurno({ finalidade = 'corporate_query', traceId = randomUUID() } = {}) {
    const base = await contexto();
    const turno = (await pool.query(`
      INSERT INTO nexus.ai_turns
        (trace_id, principal_id, conversation_id, department_id, finalidade)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, trace_id, criado_em
    `, [traceId, base.principalId, base.conversationId, base.departamentoId, finalidade])).rows[0];
    return {
      id: turno.id,
      traceId: turno.trace_id,
      iniciadoEm: turno.criado_em,
      ...base,
      finalidade
    };
  }

  function paraTelemetria(turno, padroes = {}) {
    return {
      turno,
      ultimoCallId: padroes.parentCallId || null,
      async iniciarChamada(dados) {
        await beforeModelCall({ ...dados, turno });
        const id = randomUUID();
        await pool.query(`
          INSERT INTO nexus.llm_calls
            (id, turn_id, trace_id, parent_call_id, fallback_from_call_id,
             principal_id, conversation_id, stage, purpose, provider, modelo,
             composicao_input_estimada, semantic_tier)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
        `, [id, turno.id, turno.traceId, dados.parentCallId || this.ultimoCallId || null,
          dados.fallbackFromCallId || null, turno.principalId, turno.conversationId,
          dados.stage || padroes.stage || 'business_reasoning',
          dados.purpose || padroes.purpose || turno.finalidade,
          dados.provider, dados.modelo, JSON.stringify(sanitizarComposicao(dados.composicao || {})),
          dados.semanticTier || this.semanticTier || padroes.semanticTier || null]);
        return { id };
      },
      async concluirChamada(id, resultado) {
        return concluirChamada(turno, id, resultado);
      },
      async atualizarEstagio(id, stage) {
        await pool.query('UPDATE nexus.llm_calls SET stage=$2 WHERE id=$1 AND status=\'sucesso\'', [id, stage]);
      }
    };
  }

  async function buscarPreco(cliente, { provider, servico, modelo, metrica, data }) {
    return (await cliente.query(`
      SELECT * FROM nexus.pricing_rates
      WHERE provider=$1 AND servico=$2 AND modelo=$3 AND metrica=$4
        AND vigente_desde <= $5::date
        AND (vigente_ate IS NULL OR vigente_ate >= $5::date)
      ORDER BY vigente_desde DESC LIMIT 1
    `, [provider, servico, modelo, metrica, data])).rows[0] || null;
  }

  async function buscarCambio(cliente, data) {
    return (await cliente.query(`
      SELECT * FROM nexus.exchange_rates
      WHERE moeda_origem='USD' AND moeda_destino='BRL'
        AND competencia=date_trunc('month',$1::timestamptz)::date
      LIMIT 1
    `, [data])).rows[0] || null;
  }

  async function registrarUsoServico(turno, dados = {}) {
    const quantidade = Number(dados.quantidade || 0);
    if (!turno?.id || !dados.callId || !(quantidade >= 0)) return null;
    return comTransacao(pool, async (cliente) => {
      const data = dados.data || new Date();
      const preco = await buscarPreco(cliente, {
        provider: dados.provider || 'nexus', servico: dados.servico,
        modelo: dados.modelo || 'local', metrica: dados.metrica, data
      });
      const cambio = await buscarCambio(cliente, data);
      const usd = preco ? quantidade / Number(preco.tamanho_unidade) * Number(preco.preco_usd) : null;
      const brl = usd != null && cambio ? usd * Number(cambio.taxa) : null;
      const status = !preco ? 'pricing_missing' : cambio ? 'priced' : 'missing_exchange_rate';
      const linha = (await cliente.query(`
        INSERT INTO nexus.usage_line_items
          (turn_id, call_id, tipo_chamada, provider, servico, modelo, metrica,
           quantidade, pricing_rate_id, exchange_rate_id, custo_usd, custo_brl, pricing_status)
        VALUES ($1,$2,'service',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id
      `, [turno.id, dados.callId, dados.provider || 'nexus', dados.servico,
        dados.modelo || 'local', dados.metrica, quantidade, preco?.id || null,
        cambio?.id || null, usd, brl, status])).rows[0];
      return { id: linha.id, pricingStatus: status, costUsd: usd, costBrl: brl };
    });
  }

  async function concluirChamada(turno, id, resultado = {}) {
    return comTransacao(pool, async (cliente) => {
      const chamada = (await cliente.query(
        'SELECT * FROM nexus.llm_calls WHERE id=$1 FOR UPDATE', [id]
      )).rows[0];
      if (!chamada) throw new Error(`Chamada LLM nao encontrada: ${id}`);
      if (chamada.status !== 'iniciada') return chamada;
      const usage = resultado.usage || {};
      const composicao = chamada.composicao_input_estimada || {};
      const somaEstimada = Object.entries(composicao)
        .filter(([chave, valor]) => chave !== 'nao_atribuido' && Number.isFinite(Number(valor)))
        .reduce((total, [, valor]) => total + Number(valor), 0);
      composicao.nao_atribuido = usage.inputTokens == null
        ? 0 : Math.max(0, Number(usage.inputTokens) - somaEstimada);
      const itens = [];
      if (resultado.sucesso !== false) {
        for (const [metrica, campo] of Object.entries(METRICAS_TOKEN)) {
          const quantidade = usage[campo];
          if (quantidade == null || Number(quantidade) <= 0) continue;
          itens.push({ servico: 'llm', metrica, quantidade: Number(quantidade) });
        }
        for (const [metrica, quantidade] of Object.entries(usage.serviceUsage || {})) {
          if (Number(quantidade) > 0) itens.push({ servico: metrica, metrica: 'requests', quantidade: Number(quantidade) });
        }
      }
      const cambio = await buscarCambio(cliente, chamada.criada_em);
      const precos = itens.length ? (await cliente.query(`
        SELECT solicitadas.servico AS consulta_servico,
          solicitadas.metrica AS consulta_metrica,
          preco.id, preco.tamanho_unidade, preco.preco_usd
        FROM unnest($4::text[], $5::text[]) AS solicitadas(servico,metrica)
        LEFT JOIN LATERAL (
          SELECT id,tamanho_unidade,preco_usd
          FROM nexus.pricing_rates
          WHERE provider=$1 AND servico=solicitadas.servico AND modelo=$2
            AND metrica=solicitadas.metrica
            AND vigente_desde<=$3::date
            AND (vigente_ate IS NULL OR vigente_ate>=$3::date)
          ORDER BY vigente_desde DESC LIMIT 1
        ) preco ON true
      `, [chamada.provider, chamada.modelo, chamada.criada_em,
        itens.map((item) => item.servico), itens.map((item) => item.metrica)])).rows : [];
      const precosPorItem = new Map(precos.map((item) => [
        `${item.consulta_servico}:${item.consulta_metrica}`, item.id ? item : null
      ]));
      let custoUsd = 0;
      let custoBrl = 0;
      let precosCompletos = itens.length > 0;
      const linhasUso = [];
      for (const item of itens) {
        const preco = precosPorItem.get(`${item.servico}:${item.metrica}`) || null;
        const usd = preco ? item.quantidade / Number(preco.tamanho_unidade) * Number(preco.preco_usd) : null;
        const brl = usd != null && cambio ? usd * Number(cambio.taxa) : null;
        if (!preco) precosCompletos = false;
        if (usd != null) custoUsd += usd;
        if (brl != null) custoBrl += brl;
        linhasUso.push({ ...item, precoId: preco?.id || null, usd, brl,
          status: !preco ? 'pricing_missing' : cambio ? 'priced' : 'missing_exchange_rate' });
      }
      if (linhasUso.length) {
        await cliente.query(`
          INSERT INTO nexus.usage_line_items
            (turn_id,call_id,tipo_chamada,provider,servico,modelo,metrica,
             quantidade,pricing_rate_id,exchange_rate_id,custo_usd,custo_brl,pricing_status)
          SELECT $1,$2,'llm',$3,uso.servico,$4,uso.metrica,uso.quantidade,
            uso.pricing_rate_id,$5,uso.custo_usd,uso.custo_brl,uso.pricing_status
          FROM unnest($6::text[],$7::text[],$8::numeric[],$9::uuid[],
            $10::numeric[],$11::numeric[],$12::text[])
            AS uso(servico,metrica,quantidade,pricing_rate_id,custo_usd,custo_brl,pricing_status)
        `, [turno.id, id, chamada.provider, chamada.modelo, cambio?.id || null,
          linhasUso.map((item) => item.servico), linhasUso.map((item) => item.metrica),
          linhasUso.map((item) => item.quantidade), linhasUso.map((item) => item.precoId),
          linhasUso.map((item) => item.usd), linhasUso.map((item) => item.brl),
          linhasUso.map((item) => item.status)]);
      }
      await cliente.query(`
        UPDATE nexus.llm_calls SET
          status=$2, input_tokens=$3, output_tokens=$4, cache_read_tokens=$5,
          cache_write_tokens=$6, usage_provider=$7::jsonb, response_id=$8,
          stop_reason=$9, duracao_ms=$10, erro_codigo=$11,
          estimated_cost_usd=$12, estimated_cost_brl=$13,
          pricing_complete=$14, pricing_usd_complete=$15, pricing_brl_complete=$16,
          composicao_input_estimada=$17::jsonb, concluida_em=now()
        WHERE id=$1
      `, [id, resultado.sucesso === false ? 'erro' : 'sucesso',
        usage.inputTokens ?? null, usage.outputTokens ?? null,
        usage.cacheReadTokens ?? null, usage.cacheWriteTokens ?? null,
        JSON.stringify(usage.raw || {}), resultado.responseId || null,
        resultado.stopReason || null, Math.max(0, Math.round(resultado.duracaoMs || 0)),
        codigoErro(resultado.erro), precosCompletos ? custoUsd : null,
        precosCompletos && cambio ? custoBrl : null, precosCompletos && Boolean(cambio),
        precosCompletos, precosCompletos && Boolean(cambio), JSON.stringify(composicao)]);
      return {
        id,
        pricingComplete: precosCompletos && Boolean(cambio),
        pricingUsdComplete: precosCompletos,
        pricingBrlComplete: precosCompletos && Boolean(cambio),
        costUsd: precosCompletos ? custoUsd : null,
        costBrl: precosCompletos && cambio ? custoBrl : null
      };
    });
  }

  async function registrarMensagem(turno, { papel, conteudo, proveniencia = null }) {
    if (!['user', 'assistant'].includes(papel)) throw new Error('Papel de mensagem invalido.');
    await pool.query(`
      INSERT INTO nexus.conversation_messages
        (conversation_id, turn_id, trace_id, papel, conteudo, proveniencia)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [turno.conversationId, turno.id, turno.traceId, papel, String(conteudo), proveniencia]);
  }

  async function registrarEvento(turno, { tipo, recurso = null, resultado = null, metadados = {} }) {
    await pool.query(`
      INSERT INTO nexus.audit_events
        (principal_id, conversation_id, tipo, recurso, resultado, metadados,
         trace_id,turn_id,call_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
    `, [turno.principalId, turno.conversationId, tipo, recurso, resultado,
      JSON.stringify(sanitizarMetadados(metadados)), turno.traceId, turno.id,
      metadados.call_id || null]);
  }

  async function registrarFaixaSemantica(turno, decisao = {}) {
    const fase = decisao.fase === 'final' ? 'final' : 'inicial';
    const faixa = String(decisao.faixa || 'basica');
    const pontos = Math.max(0, Math.round(Number(decisao.pontos || 0)));
    const motivos = [...new Set((decisao.motivos || []).map((item) => String(item).slice(0, 80)))];
    if (fase === 'inicial') {
      await pool.query(`
        UPDATE nexus.ai_turns SET
          semantic_tier_initial=$2,
          semantic_score_initial=$3,
          semantic_tier_final=COALESCE(semantic_tier_final,$2),
          semantic_score_final=COALESCE(semantic_score_final,$3),
          semantic_escalation_reasons=$4::jsonb
        WHERE id=$1
      `, [turno.id, faixa, pontos, JSON.stringify(motivos)]);
    } else {
      await pool.query(`
        UPDATE nexus.ai_turns SET
          semantic_tier_final=$2,
          semantic_score_final=$3,
          semantic_escalation_reasons=$4::jsonb
        WHERE id=$1
      `, [turno.id, faixa, pontos, JSON.stringify(motivos)]);
    }
    await registrarEvento(turno, {
      tipo: 'semantic_tier_decision', recurso: fase, resultado: faixa,
      metadados: {
        semantic_score: pontos,
        motivos,
        modo: decisao.modo || null,
        provider_recomendado: decisao.providerSelecionado || null
      }
    });
  }

  async function listarMensagens(limite = Number(process.env.NEXUS_GENERALIST_HISTORY_MESSAGES || 20)) {
    const base = await contexto();
    const linhas = (await pool.query(`
      SELECT m.papel, m.conteudo, m.proveniencia, m.criado_em
      FROM nexus.conversation_messages m
      JOIN nexus.ai_turns t ON t.id=m.turn_id AND t.status='sucesso'
      WHERE m.conversation_id=$1
      ORDER BY m.criado_em DESC, m.id DESC LIMIT $2
    `, [base.conversationId, limite])).rows.reverse();
    return linhas.map((item) => ({
      role: item.papel, content: item.conteudo, provenance: item.proveniencia,
      createdAt: item.criado_em
    }));
  }

  async function excluirConversa() {
    const base = await contexto();
    return comTransacao(pool, async (cliente) => {
      await cliente.query('DELETE FROM nexus.conversation_messages WHERE conversation_id=$1', [base.conversationId]);
      await cliente.query('DELETE FROM nexus.interaction_tasks WHERE conversation_id=$1', [base.conversationId]);
      await cliente.query('DELETE FROM nexus.interactions WHERE conversation_id=$1', [base.conversationId]);
    });
  }

  async function concluirTurno(turno, { sucesso = true, proveniencia = null, erro = null } = {}) {
    const resumo = (await pool.query(`
      SELECT
        (SELECT count(*)::int FROM nexus.llm_calls WHERE turn_id=$1) AS provider_calls,
        (SELECT COALESCE(sum(input_tokens),0)::bigint FROM nexus.llm_calls WHERE turn_id=$1) AS input_tokens,
        (SELECT COALESCE(sum(output_tokens),0)::bigint FROM nexus.llm_calls WHERE turn_id=$1) AS output_tokens,
        (SELECT COALESCE(sum(cache_read_tokens),0)::bigint FROM nexus.llm_calls WHERE turn_id=$1) AS cache_read_tokens,
        (SELECT COALESCE(sum(cache_write_tokens),0)::bigint FROM nexus.llm_calls WHERE turn_id=$1) AS cache_write_tokens,
        (SELECT count(*)::int FROM nexus.tool_executions WHERE turn_id=$1) AS tool_calls,
        (SELECT count(*)::int FROM nexus.usage_line_items WHERE turn_id=$1) AS usage_total,
        (SELECT bool_and(pricing_rate_id IS NOT NULL) FROM nexus.usage_line_items WHERE turn_id=$1) AS usd_completo,
        (SELECT bool_and(pricing_rate_id IS NOT NULL AND exchange_rate_id IS NOT NULL)
          FROM nexus.usage_line_items WHERE turn_id=$1) AS brl_completo,
        (SELECT sum(custo_usd) FROM nexus.usage_line_items WHERE turn_id=$1) AS custo_usd,
        (SELECT sum(custo_brl) FROM nexus.usage_line_items WHERE turn_id=$1) AS custo_brl
    `, [turno.id])).rows[0];
    const usdCompleto = Number(resumo.usage_total) > 0 && Boolean(resumo.usd_completo);
    const brlCompleto = Number(resumo.usage_total) > 0 && Boolean(resumo.brl_completo);
    const tools = resumo.tool_calls;
    const duracao = Date.now() - new Date(turno.iniciadoEm).getTime();
    const metadadosResumo = JSON.stringify({
      turn_id: turno.id, provider_calls: resumo.provider_calls, tool_calls: tools,
      input_tokens: String(resumo.input_tokens), output_tokens: String(resumo.output_tokens),
      cache_read_tokens: String(resumo.cache_read_tokens), cache_write_tokens: String(resumo.cache_write_tokens),
      pricing_usd_complete: usdCompleto,
      pricing_brl_complete: brlCompleto,
      pricing_complete: Boolean(usdCompleto && brlCompleto), duracao_ms: duracao,
      erro_codigo: codigoErro(erro)
    });
    await pool.query(`
      WITH turno_atualizado AS (
        UPDATE nexus.ai_turns SET
        status=$2, proveniencia=$3, provider_calls=$4, tool_calls=$5,
        input_tokens_total=$6, output_tokens_total=$7,
        cache_read_tokens_total=$8, cache_write_tokens_total=$9,
        estimated_cost_usd=$10, estimated_cost_brl=$11,
        pricing_complete=$12, pricing_usd_complete=$13, pricing_brl_complete=$14,
        duracao_ms=$15, erro_codigo=$16, concluido_em=now()
        WHERE id=$1 RETURNING id
      )
      INSERT INTO nexus.audit_events
        (principal_id, conversation_id, tipo, recurso, resultado, metadados)
      SELECT $17,$18,'turn_summary',$19,$20,$21::jsonb
      FROM turno_atualizado
    `, [turno.id, sucesso ? 'sucesso' : 'erro', proveniencia,
      resumo.provider_calls, tools, resumo.input_tokens, resumo.output_tokens,
      resumo.cache_read_tokens, resumo.cache_write_tokens,
      usdCompleto ? resumo.custo_usd : null,
      brlCompleto ? resumo.custo_brl : null,
      Boolean(usdCompleto && brlCompleto), usdCompleto, brlCompleto,
      duracao, codigoErro(erro), turno.principalId, turno.conversationId,
      turno.traceId, sucesso ? 'sucesso' : 'erro', metadadosResumo]);
    return {
      ...resumo,
      custo_usd: usdCompleto ? resumo.custo_usd : null,
      custo_brl: brlCompleto ? resumo.custo_brl : null,
      pricing_usd_complete: usdCompleto,
      pricing_brl_complete: brlCompleto,
      pricing_complete: Boolean(usdCompleto && brlCompleto),
      costUsd: usdCompleto ? resumo.custo_usd : null,
      costBrl: brlCompleto ? resumo.custo_brl : null,
      toolCalls: tools,
      durationMs: duracao
    };
  }

  return {
    beforeModelCall,
    concluirChamada,
    concluirTurno,
    contexto,
    excluirConversa,
    iniciarTurno,
    listarMensagens,
    modo,
    paraTelemetria,
    registrarUsoServico,
    registrarFaixaSemantica,
    registrarEvento,
    registrarMensagem
  };
}

module.exports = {
  codigoErro,
  criarServicoAuditoriaIA,
  modoPoliticaUso,
  sanitizarMetadados
};
