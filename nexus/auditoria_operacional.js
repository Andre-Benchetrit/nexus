const CATALOGO_AUDITORIA = Object.freeze({
  versao: '2026-10-09',
  capabilities: Object.freeze({
    consultar_nexus: ['Consultar dados do Sysemp', 'Coordena uma consulta corporativa autorizada e seleciona as operações necessárias.'],
    analisar_indicadores: ['Indicadores executivos', 'Consulta indicadores consolidados do Sysemp.'],
    analisar_vendas: ['Consultar vendas', 'Consulta pedidos, notas e itens de venda.'],
    analisar_desempenho: ['Desempenho de vendas', 'Compara e ranqueia o desempenho comercial.'],
    analisar_catalogo: ['Consultar catálogo', 'Localiza e compara produtos cadastrados no Sysemp.'],
    analisar_frete: ['Analisar frete', 'Consulta informações autorizadas relacionadas a frete.'],
    analisar_influencias: ['Analisar influências', 'Verifica fatores relacionados ao desempenho operacional.'],
    analisar_operacao: ['Analisar operação', 'Consulta informações operacionais autorizadas.'],
    analisar_pessoas: ['Consultar pessoas e parceiros', 'Consulta cadastros corporativos autorizados.'],
    analisar_evolucao_produto: ['Evolução de produtos', 'Acompanha os mesmos produtos ao longo do tempo.'],
    diagnosticar_produto_360: ['Diagnóstico 360° do produto', 'Combina desempenho, canais, estoque atual e reposição.'],
    detectar_excecoes_produto: ['Alertas de produtos', 'Aplica regras locais para localizar produtos que precisam de atenção.'],
    comparar_canais_produto: ['Comparar canais do produto', 'Compara o produto entre plataformas do Sysemp.'],
    analisar_rupturas: ['Risco de ruptura', 'Consulta estoque, cobertura e risco de ruptura.'],
    analisar_giro_estoque: ['Giro de estoque', 'Compara estoque atual com o movimento de venda.'],
    analisar_reposicoes: ['Reposições', 'Consulta pedidos de compra, previsões e atrasos.'],
    consultar_bloqueios_sem_estoque: ['Bloqueios sem estoque', 'Localiza pedidos ou itens bloqueados por ausência de estoque.'],
    diagnosticar_bloqueio_sem_estoque: ['Diagnosticar bloqueio', 'Investiga as causas de um bloqueio relacionado ao estoque.'],
    resolver_produto: ['Identificar produto', 'Resolve uma descrição, SKU, EAN ou código interno para o produto correto.'],
    solicitar_aprofundamento: ['Aprofundar análise', 'Solicita uma etapa adicional quando a primeira consulta não é suficiente.'],
    agregar_gold: ['Calcular dados analíticos', 'Agrupa e calcula métricas sobre dados analíticos preparados.'],
    agregar_silver: ['Calcular dados detalhados', 'Agrupa e calcula métricas sobre dados corporativos detalhados.'],
    agregar_bronze: ['Calcular dados de origem', 'Agrupa dados brutos autorizados para uma verificação técnica.'],
    consultar_gold: ['Consultar dados analíticos', 'Lê dados analíticos preparados e autorizados.'],
    consultar_silver: ['Consultar dados detalhados', 'Lê dados corporativos detalhados e autorizados.'],
    consultar_bronze: ['Consultar dados de origem', 'Lê dados brutos autorizados para uma verificação técnica.'],
    construir_sql: ['Preparar consulta', 'Monta uma consulta estruturada dentro do catálogo e das regras autorizadas.'],
    consultar_documentacao: ['Base de conhecimento', 'Consulta procedimentos, políticas e manuais autorizados.'],
    validar_politicas: ['Validar políticas internas', 'Verifica políticas obrigatórias sem expor o conteúdo da conversa.'],
    pesquisar_web: ['Pesquisa na internet', 'Pesquisa fontes públicas para apoiar a resposta.'],
    analisar_arquivo: ['Analisar anexo', 'Extrai evidências de um arquivo enviado na conversa.'],
    consultar_evidencia_anexo: ['Consultar evidência do anexo', 'Recupera trechos, células ou cálculos exatos de um anexo já analisado.'],
    processar_imagem_local: ['Ler imagem localmente', 'Extrai metadados, textos e códigos de uma imagem sem pesquisa externa.'],
    interpretar_imagem: ['Interpretar imagem', 'Interpreta visualmente uma imagem autorizada quando a análise local não é suficiente.'],
    gerar_arquivo: ['Gerar arquivo', 'Cria um documento ou planilha a partir de evidências autorizadas.'],
    exportar_resultado: ['Exportar resultado', 'Transforma um resultado persistido em arquivo para download.'],
    consultar_conjunto_nexus: ['Consultar resultado persistido', 'Recupera linhas autorizadas de um resultado privado da conversa.'],
    consultar_resultado_nexus: ['Transformar resultado anterior', 'Filtra, ordena, agrupa ou resume localmente um resultado já autorizado.'],
    gerar_grafico: ['Gerar gráfico', 'Cria uma visualização calculada localmente a partir de um resultado autorizado.'],
    gerar_imagem: ['Criar imagem', 'Cria uma imagem privada na conversa.'],
    editar_imagem: ['Editar imagem', 'Cria uma nova versão de uma imagem existente.'],
    solicitar_revisao_memoria: ['Propor aprendizado', 'Encaminha um possível aprendizado para revisão governada; não o aprova automaticamente.'],
    semantic_router: ['Identificar a intenção', 'Escolhe as capacidades adequadas para a pergunta.'],
    mcp_consultar_item_laboratorio: ['Teste de conector MCP', 'Consulta o catálogo estático do laboratório administrativo.'],
    ia_conversar: ['Responder no chat', 'Autoriza o uso do assistente na conversa.']
  }),
  modes: Object.freeze({
    automatico: ['Automático', 'O Nexus escolhe a fonte adequada.'],
    geral: ['Conhecimento geral', 'Responde sem consultar Sysemp, web ou documentação opcional.'],
    dados: ['Consultar dados', 'Prioriza consultas autorizadas ao Sysemp.'],
    documentacao: ['Verificar documentação', 'Prioriza a base interna de conhecimento.'],
    web: ['Pesquisar na web', 'Prioriza fontes públicas.'],
    imagem: ['Criar imagem', 'Habilita geração e edição de imagens.']
  }),
  statuses: Object.freeze({
    iniciado: ['Em andamento', 'O processamento foi iniciado.'],
    sucesso: ['Concluído', 'A etapa terminou normalmente.'],
    erro: ['Erro', 'A etapa terminou com uma falha sanitizada.'],
    bloqueada: ['Acesso bloqueado', 'O usuário não possuía acesso à fonte solicitada.'],
    allow: ['Autorizado', 'A política de acesso permitiu a operação.'],
    deny: ['Negado', 'A política de acesso negou a operação.'],
    would_deny: ['Negação em auditoria', 'A política registrou uma futura negação sem bloquear o ambiente atual.'],
    fallback: ['Modelo alternativo', 'Um modelo alternativo foi utilizado para concluir a etapa.']
  }),
  terms: Object.freeze({
    capability: ['Capability', 'Uma ação específica que o Nexus sabe executar.'],
    trace: ['Trace', 'Identificador da sequência operacional de uma resposta.'],
    source_mode: ['Modo da mensagem', 'Fonte escolhida pelo usuário ou pelo modo automático.'],
    result_ref: ['Resultado persistido', 'Conjunto privado preservado para continuidade e exportação.'],
    tool: ['Ferramenta', 'Operação controlada usada para consultar ou processar uma fonte.'],
    fallback: ['Fallback', 'Modelo alternativo usado quando o principal não concluiu a etapa.']
  })
});

function rotuloCapability(nome) {
  const catalogado = CATALOGO_AUDITORIA.capabilities[nome];
  return catalogado ? { nome: catalogado[0], finalidade: catalogado[1], conhecida: true }
    : { nome: `Operação técnica (${String(nome || 'sem código')})`,
      finalidade: 'Operação ainda sem descrição amigável no catálogo desta versão.', conhecida: false };
}

function intervalo(filtros = {}) {
  const ate = filtros.to ? new Date(String(filtros.to)) : new Date();
  const desde = filtros.from ? new Date(String(filtros.from)) : new Date(ate.getTime() - 7 * 86400000);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(ate.getTime()) || desde > ate) {
    const erro = new Error('Período de auditoria inválido.'); erro.codigo = 'AUDIT_PERIOD_INVALID'; throw erro;
  }
  return { from: desde.toISOString(), to: ate.toISOString() };
}

function decodificarCursor(valor) {
  if (!valor) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(valor), 'base64url').toString('utf8'));
    return cursor?.criadoEm && cursor?.id ? cursor : null;
  } catch (_) { return null; }
}

function codificarCursor(linha) {
  if (!linha) return null;
  return Buffer.from(JSON.stringify({ criadoEm: linha.criado_em, id: linha.id })).toString('base64url');
}

function construirFiltro(filtros, escopo, alias = 't') {
  const faixa = intervalo(filtros);
  const valores = [faixa.from, faixa.to];
  const where = [`${alias}.criado_em >= $1`, `${alias}.criado_em <= $2`];
  const adicionar = (sql, valor) => { valores.push(valor); where.push(sql.replace('?', `$${valores.length}`)); };
  if (!escopo.global) {
    valores.push(escopo.departmentIds);
    where.push(`${alias}.department_id = ANY($${valores.length}::uuid[])`);
  }
  if (filtros.departmentId) adicionar(`${alias}.department_id = ?::uuid`, filtros.departmentId);
  if (filtros.principalId) adicionar(`${alias}.principal_id = ?::uuid`, filtros.principalId);
  if (filtros.sourceMode) adicionar(`${alias}.source_mode = ?`, filtros.sourceMode);
  if (filtros.capability) adicionar(`EXISTS (SELECT 1 FROM nexus.tool_executions tef
    WHERE tef.turn_id=${alias}.id AND tef.tool_name=?)`, filtros.capability);
  if (filtros.status === 'bloqueada') where.push(`EXISTS (SELECT 1 FROM nexus.tool_executions teb
    WHERE teb.turn_id=${alias}.id AND teb.status='bloqueada')`);
  else if (filtros.status) adicionar(`${alias}.status = ?`, filtros.status);
  if (String(filtros.onlyProblems || '') === 'true') where.push(`(${alias}.status='erro' OR EXISTS (
    SELECT 1 FROM nexus.tool_executions tep WHERE tep.turn_id=${alias}.id AND tep.status IN ('erro','bloqueada')))`);
  return { where: where.join(' AND '), valores, faixa };
}

async function overview(pool, filtros, escopo) {
  const base = construirFiltro(filtros, escopo);
  const resumo = (await pool.query(`SELECT count(*)::int AS turnos,
      count(DISTINCT t.principal_id)::int AS usuarios_ativos,
      count(*) FILTER (WHERE t.status='sucesso')::int AS sucessos,
      count(*) FILTER (WHERE t.status='erro')::int AS erros,
      coalesce(round(avg(t.duracao_ms))::bigint,0)::bigint AS duracao_media_ms,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM nexus.tool_executions teb
        WHERE teb.turn_id=t.id AND teb.status='bloqueada'))::int AS bloqueios
    FROM nexus.ai_turns t WHERE ${base.where}`, base.valores)).rows[0];
  const turnos = Number(resumo.turnos || 0);
  resumo.taxa_sucesso = turnos ? Number((100 * Number(resumo.sucessos || 0) / turnos).toFixed(2)) : 0;
  const usuarios = (await pool.query(`SELECT p.id AS principal_id,p.nome AS usuario,
      count(DISTINCT t.id)::int AS turnos,
      count(DISTINCT t.id) FILTER (WHERE t.status='sucesso')::int AS sucessos,
      count(DISTINCT t.id) FILTER (WHERE t.status='erro')::int AS erros,
      max(t.criado_em) AS ultima_atividade,
      array_remove(array_agg(DISTINCT t.source_mode),NULL) AS modos,
      array_remove(array_agg(DISTINCT te.tool_name),NULL) AS capabilities
    FROM nexus.ai_turns t
    LEFT JOIN nexus.principals p ON p.id=t.principal_id
    LEFT JOIN nexus.tool_executions te ON te.turn_id=t.id
    WHERE ${base.where} GROUP BY p.id,p.nome ORDER BY turnos DESC,ultima_atividade DESC`, base.valores)).rows;
  const capabilities = (await pool.query(`SELECT te.tool_name AS capability,
      count(DISTINCT te.principal_id)::int AS usuarios,
      count(DISTINCT coalesce(te.call_id,te.id))::int AS execucoes,
      count(DISTINCT coalesce(te.call_id,te.id)) FILTER (WHERE te.status='sucesso')::int AS sucessos,
      count(DISTINCT coalesce(te.call_id,te.id)) FILTER (WHERE te.status='erro')::int AS erros,
      count(DISTINCT coalesce(te.call_id,te.id)) FILTER (WHERE te.status='bloqueada')::int AS bloqueios
    FROM nexus.tool_executions te JOIN nexus.ai_turns t ON t.id=te.turn_id
    WHERE ${base.where} GROUP BY te.tool_name ORDER BY execucoes DESC,te.tool_name`, base.valores)).rows
    .map((item) => ({ ...item, ...rotuloCapability(item.capability) }));
  const usuariosRotulados = usuarios.map((item) => ({ ...item,
    capabilities: [...new Set((item.capabilities || []).map((nome) => rotuloCapability(nome).nome))] }));
  return { period: base.faixa, summary: resumo, users: usuariosRotulados, capabilities };
}

async function activity(pool, filtros, escopo) {
  const base = construirFiltro(filtros, escopo);
  const limite = Math.min(100, Math.max(1, Number(filtros.limit || filtros.limite || 50)));
  const cursor = decodificarCursor(filtros.cursor);
  if (cursor) {
    base.valores.push(cursor.criadoEm, cursor.id);
    base.where += ` AND (t.criado_em,t.id) < ($${base.valores.length - 1}::timestamptz,$${base.valores.length}::uuid)`;
  }
  base.valores.push(limite + 1);
  const linhas = (await pool.query(`SELECT t.id,t.trace_id,t.principal_id,t.department_id,
      p.nome AS usuario,d.nome AS setor,t.source_mode,t.status,t.finalidade,t.duracao_ms,
      t.erro_codigo,t.criado_em,t.concluido_em,
      array_remove(array_agg(DISTINCT te.tool_name),NULL) AS capabilities,
      count(te.id) FILTER (WHERE te.status='bloqueada')::int AS bloqueios
    FROM nexus.ai_turns t
    LEFT JOIN nexus.principals p ON p.id=t.principal_id
    LEFT JOIN nexus.departments d ON d.id=t.department_id
    LEFT JOIN nexus.tool_executions te ON te.turn_id=t.id
    WHERE ${base.where}
    GROUP BY t.id,p.nome,d.nome ORDER BY t.criado_em DESC,t.id DESC LIMIT $${base.valores.length}`,
  base.valores)).rows;
  const temMais = linhas.length > limite;
  const items = linhas.slice(0, limite).map((linha) => ({ ...linha,
    capabilityLabels: [...new Set((linha.capabilities || []).map((nome) => rotuloCapability(nome).nome))] }));
  return { period: base.faixa, items, nextCursor: temMais ? codificarCursor(items.at(-1)) : null };
}

async function trace(pool, traceId, escopo) {
  const valores = [traceId];
  const escopoSql = escopo.global ? '' : (() => {
    valores.push(escopo.departmentIds); return `AND t.department_id=ANY($2::uuid[])`;
  })();
  const turno = (await pool.query(`SELECT t.id,t.trace_id,t.principal_id,t.department_id,
      p.nome AS usuario,d.nome AS setor,t.source_mode,t.status,t.finalidade,t.duracao_ms,
      t.erro_codigo,t.criado_em,t.concluido_em
    FROM nexus.ai_turns t
    LEFT JOIN nexus.principals p ON p.id=t.principal_id
    LEFT JOIN nexus.departments d ON d.id=t.department_id
    WHERE t.trace_id=$1 ${escopoSql} LIMIT 1`, valores)).rows[0];
  if (!turno) { const erro = new Error('Trace não encontrado ou fora do escopo permitido.');
    erro.codigo = 'TRACE_NOT_ALLOWED'; erro.status = 403; throw erro; }
  const [tools, chamadas] = await Promise.all([
    pool.query(`SELECT coalesce(call_id,id) AS id,tool_name AS capability,
        array_agg(DISTINCT permission_code ORDER BY permission_code) AS permission_codes,
        CASE WHEN bool_or(status='bloqueada') THEN 'bloqueada'
          WHEN bool_or(status='erro') THEN 'erro'
          WHEN bool_and(status='sucesso') THEN 'sucesso' ELSE 'iniciada' END AS status,
        min(camada) AS camada,min(stage) AS stage,min(purpose) AS purpose,
        max(duracao_ms) AS duracao_ms,max(erro_codigo) AS erro_codigo,
        min(criada_em) AS criada_em,max(concluida_em) AS concluida_em
      FROM nexus.tool_executions WHERE turn_id=$1
      GROUP BY coalesce(call_id,id),tool_name ORDER BY criada_em,id`, [turno.id]),
    pool.query(`SELECT id,parent_call_id,fallback_from_call_id,stage,purpose,provider,modelo,status,
        duracao_ms,erro_codigo,criada_em,concluida_em
      FROM nexus.llm_calls WHERE turn_id=$1 ORDER BY criada_em,id`, [turno.id])
  ]);
  const etapas = [
    ...tools.rows.map((item) => ({ tipo: 'capability', ...item, ...rotuloCapability(item.capability) })),
    ...chamadas.rows.map((item) => ({ tipo: item.fallback_from_call_id ? 'fallback' : 'modelo', ...item }))
  ].sort((a, b) => new Date(a.criada_em) - new Date(b.criada_em));
  return { turn: turno, stages: etapas };
}

function glossary() {
  const transformar = (objeto) => Object.entries(objeto).map(([codigo, [nome, descricao]]) => ({ codigo, nome, descricao }));
  return { version: CATALOGO_AUDITORIA.versao,
    capabilities: Object.entries(CATALOGO_AUDITORIA.capabilities).map(([codigo]) => ({ codigo, ...rotuloCapability(codigo) })),
    modes: transformar(CATALOGO_AUDITORIA.modes), statuses: transformar(CATALOGO_AUDITORIA.statuses),
    terms: transformar(CATALOGO_AUDITORIA.terms) };
}

module.exports = { CATALOGO_AUDITORIA, activity, glossary, overview, rotuloCapability, trace };
