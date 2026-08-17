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
    departamentoSlug: opcoes.departamentoSlug || null
  };
  const modo = modoPoliticaUso(opcoes.modo);
  let contextoResolvido;

  async function contexto() {
    contextoResolvido ||= resolverContexto(pool, contextoBase);
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
             composicao_input_estimada)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
        `, [id, turno.id, turno.traceId, dados.parentCallId || this.ultimoCallId || null,
          dados.fallbackFromCallId || null, turno.principalId, turno.conversationId,
          dados.stage || padroes.stage || 'business_reasoning',
          dados.purpose || padroes.purpose || turno.finalidade,
          dados.provider, dados.modelo, JSON.stringify(sanitizarComposicao(dados.composicao || {}))]);
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
      let custoUsd = 0;
      let custoBrl = 0;
      let precosCompletos = itens.length > 0;
      for (const item of itens) {
        const preco = await buscarPreco(cliente, {
          provider: chamada.provider, servico: item.servico, modelo: chamada.modelo,
          metrica: item.metrica, data: chamada.criada_em
        });
        const usd = preco ? item.quantidade / Number(preco.tamanho_unidade) * Number(preco.preco_usd) : null;
        const brl = usd != null && cambio ? usd * Number(cambio.taxa) : null;
        if (!preco) precosCompletos = false;
        if (usd != null) custoUsd += usd;
        if (brl != null) custoBrl += brl;
        await cliente.query(`
          INSERT INTO nexus.usage_line_items
            (turn_id, call_id, tipo_chamada, provider, servico, modelo, metrica,
             quantidade, pricing_rate_id, exchange_rate_id, custo_usd, custo_brl, pricing_status)
          VALUES ($1,$2,'llm',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [turno.id, id, chamada.provider, item.servico, chamada.modelo, item.metrica,
          item.quantidade, preco?.id || null, cambio?.id || null, usd, brl,
          preco ? 'priced' : 'pricing_missing']);
      }
      await cliente.query(`
        UPDATE nexus.llm_calls SET
          status=$2, input_tokens=$3, output_tokens=$4, cache_read_tokens=$5,
          cache_write_tokens=$6, usage_provider=$7::jsonb, response_id=$8,
          stop_reason=$9, duracao_ms=$10, erro_codigo=$11,
          estimated_cost_usd=$12, estimated_cost_brl=$13,
          pricing_complete=$14, composicao_input_estimada=$15::jsonb, concluida_em=now()
        WHERE id=$1
      `, [id, resultado.sucesso === false ? 'erro' : 'sucesso',
        usage.inputTokens ?? null, usage.outputTokens ?? null,
        usage.cacheReadTokens ?? null, usage.cacheWriteTokens ?? null,
        JSON.stringify(usage.raw || {}), resultado.responseId || null,
        resultado.stopReason || null, Math.max(0, Math.round(resultado.duracaoMs || 0)),
        codigoErro(resultado.erro), precosCompletos ? custoUsd : null,
        precosCompletos && cambio ? custoBrl : null, precosCompletos && Boolean(cambio),
        JSON.stringify(composicao)]);
      return {
        id,
        pricingComplete: precosCompletos && Boolean(cambio),
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

  async function listarMensagens(limite = Number(process.env.NEXUS_GENERALIST_HISTORY_MESSAGES || 20)) {
    const base = await contexto();
    const linhas = (await pool.query(`
      SELECT papel, conteudo, proveniencia, criado_em
      FROM nexus.conversation_messages WHERE conversation_id=$1
      ORDER BY criado_em DESC, id DESC LIMIT $2
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
        count(*)::int AS provider_calls,
        COALESCE(sum(input_tokens),0)::bigint AS input_tokens,
        COALESCE(sum(output_tokens),0)::bigint AS output_tokens,
        COALESCE(sum(cache_read_tokens),0)::bigint AS cache_read_tokens,
        COALESCE(sum(cache_write_tokens),0)::bigint AS cache_write_tokens,
        bool_and(estimated_cost_usd IS NOT NULL) FILTER (WHERE status='sucesso') AS pricing_usd_complete,
        bool_and(estimated_cost_brl IS NOT NULL) FILTER (WHERE status='sucesso') AS pricing_brl_complete,
        sum(estimated_cost_usd) AS custo_usd,
        sum(estimated_cost_brl) AS custo_brl
      FROM nexus.llm_calls WHERE turn_id=$1
    `, [turno.id])).rows[0];
    const tools = (await pool.query(
      'SELECT count(*)::int AS total FROM nexus.tool_executions WHERE turn_id=$1', [turno.id]
    )).rows[0].total;
    const duracao = Date.now() - new Date(turno.iniciadoEm).getTime();
    await pool.query(`
      UPDATE nexus.ai_turns SET
        status=$2, proveniencia=$3, provider_calls=$4, tool_calls=$5,
        input_tokens_total=$6, output_tokens_total=$7,
        cache_read_tokens_total=$8, cache_write_tokens_total=$9,
        estimated_cost_usd=$10, estimated_cost_brl=$11,
        pricing_complete=$12, duracao_ms=$13, erro_codigo=$14, concluido_em=now()
      WHERE id=$1
    `, [turno.id, sucesso ? 'sucesso' : 'erro', proveniencia,
      resumo.provider_calls, tools, resumo.input_tokens, resumo.output_tokens,
      resumo.cache_read_tokens, resumo.cache_write_tokens,
      resumo.pricing_usd_complete ? resumo.custo_usd : null,
      resumo.pricing_brl_complete ? resumo.custo_brl : null,
      Boolean(resumo.pricing_usd_complete && resumo.pricing_brl_complete), duracao, codigoErro(erro)]);
    await pool.query(`
      INSERT INTO nexus.audit_events
        (principal_id, conversation_id, tipo, recurso, resultado, metadados)
      VALUES ($1,$2,'turn_summary',$3,$4,$5::jsonb)
    `, [turno.principalId, turno.conversationId, turno.traceId,
      sucesso ? 'sucesso' : 'erro', JSON.stringify({
        turn_id: turno.id, provider_calls: resumo.provider_calls, tool_calls: tools,
        input_tokens: String(resumo.input_tokens), output_tokens: String(resumo.output_tokens),
        cache_read_tokens: String(resumo.cache_read_tokens), cache_write_tokens: String(resumo.cache_write_tokens),
        pricing_complete: Boolean(resumo.pricing_usd_complete && resumo.pricing_brl_complete), duracao_ms: duracao,
        erro_codigo: codigoErro(erro)
      })]);
    return { ...resumo, toolCalls: tools, durationMs: duracao };
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
    registrarMensagem
  };
}

module.exports = {
  codigoErro,
  criarServicoAuditoriaIA,
  modoPoliticaUso,
  sanitizarMetadados
};
