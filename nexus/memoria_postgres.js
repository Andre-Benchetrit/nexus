const {
  LIMITE_TAREFAS_PENDENTES,
  extrairReferenciasTemporais,
  normalizarInteracao,
  normalizarTarefa,
  pontuarConhecimento,
  resumir,
  sanitizarEstrutura,
  validarSessao
} = require('../agentes/memoria');
const { comTransacao, criarPoolNexus } = require('./db');

const LIMITE_RESUMO_PERGUNTA = 180;
const LIMITE_RESUMO_RESPOSTA = 1_000;
const ESTADOS_PENDENTES = ['ativa', 'aguardando_usuario', 'pausada'];

function linhaParaTarefa(linha) {
  return normalizarTarefa({
    id: linha.id,
    tipo: linha.tipo,
    estado: linha.estado,
    slots: linha.slots,
    camposPendentes: linha.campos_pendentes,
    contexto: linha.contexto,
    perguntas: linha.perguntas,
    criadaEm: linha.criada_em?.toISOString?.() || linha.criada_em,
    atualizadaEm: linha.atualizada_em?.toISOString?.() || linha.atualizada_em,
    expiraEm: linha.expira_em?.toISOString?.() || linha.expira_em
  });
}

function criarPostgresMemoryStore(opcoes = {}) {
  const sessao = validarSessao(opcoes.sessao || 'padrao');
  const limiteCurta = Number(
    opcoes.limiteCurta || process.env.NEXUS_SESSION_HISTORY_LIMIT || 10
  );
  if (!Number.isInteger(limiteCurta) || limiteCurta < 1 || limiteCurta > 50) {
    throw new Error('Limite da memoria curta deve ser um inteiro entre 1 e 50.');
  }
  const pool = opcoes.pool || criarPoolNexus(opcoes);
  const principalSlug = opcoes.principalSlug || 'legacy-cli';
  const departamentoSlug = opcoes.departamentoSlug || null;

  async function obterContexto(cliente = pool) {
    const principal = (await cliente.query(
      'SELECT id FROM nexus.principals WHERE slug = $1 AND ativo = true', [principalSlug]
    )).rows[0];
    if (!principal) throw new Error(`Principal ativo nao encontrado: ${principalSlug}`);
    const conversa = (await cliente.query(`
      INSERT INTO nexus.conversations (principal_id, chave_sessao)
      VALUES ($1, $2)
      ON CONFLICT (principal_id, chave_sessao)
      DO UPDATE SET atualizada_em = now()
      RETURNING id, tarefa_ativa_id
    `, [principal.id, sessao])).rows[0];
    let departmentId = null;
    if (departamentoSlug) {
      departmentId = (await cliente.query(`
        SELECT d.id FROM nexus.departments d
        JOIN nexus.principal_departments pd ON pd.department_id=d.id
        WHERE pd.principal_id=$1 AND d.slug=$2 AND d.ativo=true
      `, [principal.id, departamentoSlug])).rows[0]?.id || null;
    }
    return { principalId: principal.id, conversationId: conversa.id,
      tarefaAtivaId: conversa.tarefa_ativa_id, departmentId };
  }

  async function listarCurta() {
    const { conversationId } = await obterContexto();
    const linhas = (await pool.query(`
      SELECT payload FROM nexus.interactions
      WHERE conversation_id = $1
      ORDER BY criada_em DESC, id DESC LIMIT $2
    `, [conversationId, limiteCurta])).rows;
    return linhas.reverse().map((linha) => normalizarInteracao(linha.payload));
  }

  async function registrarInteracao(item, opcoesRegistro = {}) {
    const normalizada = normalizarInteracao({
      ...item,
      pergunta: resumir(item.pergunta, LIMITE_RESUMO_PERGUNTA),
      perguntaAutonoma: resumir(
        item.perguntaAutonoma || item.rota?.perguntaAutonoma || item.pergunta,
        LIMITE_RESUMO_PERGUNTA * 2
      ),
      resposta: resumir(item.resposta, LIMITE_RESUMO_RESPOSTA),
      rota: item.rota ? sanitizarEstrutura(item.rota) : null,
      plano: item.plano ? sanitizarEstrutura(item.plano) : null,
      ferramentas: sanitizarEstrutura(item.ferramentas || []),
      entidades: sanitizarEstrutura(item.entidades || {}),
      periodo: sanitizarEstrutura(item.periodo || item.rota?.periodo || null),
      filtros: sanitizarEstrutura(item.filtros || item.rota?.filtros || []),
      campos: sanitizarEstrutura(item.campos || item.rota?.camposSolicitados || []),
      referencias: sanitizarEstrutura(
        item.referencias || extrairReferenciasTemporais(item.resposta)
      ),
      criadaEm: item.criadaEm || new Date().toISOString()
    });
    const { conversationId } = await obterContexto();
    const sourceKey = opcoesRegistro.sourceKey || null;
    await pool.query(`
      INSERT INTO nexus.interactions (conversation_id, payload, source_key, criada_em)
      VALUES ($1, $2::jsonb, $3, $4)
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL
      DO UPDATE SET payload = EXCLUDED.payload, criada_em = EXCLUDED.criada_em
    `, [conversationId, JSON.stringify(normalizada), sourceKey, normalizada.criadaEm]);
    return normalizada;
  }

  async function expirarTarefas(agora = new Date()) {
    const { conversationId } = await obterContexto();
    return comTransacao(pool, async (cliente) => {
      const resultado = await cliente.query(`
        UPDATE nexus.interaction_tasks SET estado = 'expirada', atualizada_em = $2
        WHERE conversation_id = $1
          AND estado = ANY($3::text[]) AND expira_em <= $2
        RETURNING *
      `, [conversationId, agora, ESTADOS_PENDENTES]);
      await cliente.query(`
        UPDATE nexus.conversations c SET tarefa_ativa_id = NULL, atualizada_em = now()
        WHERE c.id = $1 AND NOT EXISTS (
          SELECT 1 FROM nexus.interaction_tasks t
          WHERE t.id = c.tarefa_ativa_id AND t.estado IN ('ativa','aguardando_usuario')
        )
      `, [conversationId]);
      return resultado.rows.map(linhaParaTarefa);
    });
  }

  async function listarTarefas({ incluirFinalizadas = false } = {}) {
    await expirarTarefas();
    const { conversationId } = await obterContexto();
    const resultado = await pool.query(`
      SELECT * FROM nexus.interaction_tasks WHERE conversation_id = $1
        AND ($2::boolean OR estado = ANY($3::text[]))
      ORDER BY atualizada_em ASC, id ASC
    `, [conversationId, incluirFinalizadas, ESTADOS_PENDENTES]);
    return resultado.rows.map(linhaParaTarefa);
  }

  async function obterTarefaAtiva() {
    await expirarTarefas();
    const { conversationId } = await obterContexto();
    const linha = (await pool.query(`
      SELECT t.* FROM nexus.conversations c
      JOIN nexus.interaction_tasks t ON t.id = c.tarefa_ativa_id
      WHERE c.id = $1 AND t.estado IN ('ativa','aguardando_usuario')
    `, [conversationId])).rows[0];
    return linha ? linhaParaTarefa(linha) : null;
  }

  async function salvarTarefa(tarefa, { ativar = true } = {}) {
    const normalizada = normalizarTarefa({
      ...tarefa,
      atualizadaEm: new Date().toISOString(),
      criadaEm: tarefa.criadaEm || new Date().toISOString()
    });
    return comTransacao(pool, async (cliente) => {
      const { conversationId } = await obterContexto(cliente);
      await cliente.query('SELECT id FROM nexus.conversations WHERE id = $1 FOR UPDATE', [conversationId]);
      if (ativar) {
        await cliente.query(`
          UPDATE nexus.interaction_tasks SET estado = 'pausada', atualizada_em = now()
          WHERE conversation_id = $1 AND id <> $2 AND estado IN ('ativa','aguardando_usuario')
        `, [conversationId, normalizada.id]);
      }
      const linha = (await cliente.query(`
        INSERT INTO nexus.interaction_tasks
          (id, conversation_id, tipo, estado, slots, campos_pendentes, contexto,
           perguntas, criada_em, atualizada_em, expira_em)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET tipo=EXCLUDED.tipo, estado=EXCLUDED.estado,
          slots=EXCLUDED.slots, campos_pendentes=EXCLUDED.campos_pendentes,
          contexto=EXCLUDED.contexto, perguntas=EXCLUDED.perguntas,
          atualizada_em=EXCLUDED.atualizada_em, expira_em=EXCLUDED.expira_em
        RETURNING *
      `, [normalizada.id, conversationId, normalizada.tipo, normalizada.estado,
        JSON.stringify(normalizada.slots), JSON.stringify(normalizada.camposPendentes),
        JSON.stringify(normalizada.contexto), JSON.stringify(normalizada.perguntas),
        normalizada.criadaEm, normalizada.atualizadaEm, normalizada.expiraEm])).rows[0];
      if (ativar) {
        await cliente.query(
          'UPDATE nexus.conversations SET tarefa_ativa_id=$2, atualizada_em=now() WHERE id=$1',
          [conversationId, normalizada.id]
        );
      }
      const excedentes = (await cliente.query(`
        SELECT id FROM nexus.interaction_tasks
        WHERE conversation_id=$1 AND estado = ANY($2::text[]) AND id <> COALESCE($3::uuid, gen_random_uuid())
        ORDER BY atualizada_em DESC OFFSET $4
      `, [conversationId, ESTADOS_PENDENTES, ativar ? normalizada.id : null,
        LIMITE_TAREFAS_PENDENTES - (ativar ? 1 : 0)])).rows.map((item) => item.id);
      if (excedentes.length) {
        await cliente.query('DELETE FROM nexus.interaction_tasks WHERE id = ANY($1::uuid[])', [excedentes]);
      }
      return linhaParaTarefa(linha);
    });
  }

  async function atualizarEstadoTarefa(id, estado) {
    return comTransacao(pool, async (cliente) => {
      const { conversationId } = await obterContexto(cliente);
      await cliente.query('SELECT id FROM nexus.conversations WHERE id=$1 FOR UPDATE', [conversationId]);
      if (['ativa', 'aguardando_usuario'].includes(estado)) {
        await cliente.query(`UPDATE nexus.interaction_tasks SET estado='pausada', atualizada_em=now()
          WHERE conversation_id=$1 AND id<>$2 AND estado IN ('ativa','aguardando_usuario')`, [conversationId, id]);
      }
      const linha = (await cliente.query(`UPDATE nexus.interaction_tasks
        SET estado=$3, atualizada_em=now() WHERE conversation_id=$1 AND id=$2 RETURNING *`,
      [conversationId, id, estado])).rows[0];
      if (!linha) return null;
      await cliente.query(`UPDATE nexus.conversations SET tarefa_ativa_id=$2, atualizada_em=now() WHERE id=$1`, [
        conversationId, ['ativa', 'aguardando_usuario'].includes(estado) ? id : null
      ]);
      return linhaParaTarefa(linha);
    });
  }

  async function retomarTarefa(id) {
    const tarefas = await listarTarefas({ incluirFinalizadas: true });
    const tarefa = tarefas.find((item) => item.id === id && item.estado === 'pausada');
    if (!tarefa) return null;
    return salvarTarefa({
      ...tarefa,
      estado: tarefa.camposPendentes.length ? 'aguardando_usuario' : 'ativa'
    });
  }

  async function listarLonga({ somenteAtivos = false, tipos = null, somenteAplicaveis = false } = {}) {
    const base = await obterContexto();
    const linhas = (await pool.query(`
      SELECT k.*, COALESCE(jsonb_agg(t.gatilho) FILTER (WHERE t.gatilho IS NOT NULL), '[]') AS gatilhos
      FROM nexus.knowledge_items k
      LEFT JOIN nexus.knowledge_triggers t ON t.knowledge_id = k.id
      WHERE ($1::boolean = false OR k.ativo = true)
        AND ($2::text[] IS NULL OR k.tipo=ANY($2::text[]))
        AND ($3::boolean = false OR k.escopo='global'
          OR (k.escopo='principal' AND k.principal_id=$4)
          OR (k.escopo='department' AND k.department_id=$5))
      GROUP BY k.id ORDER BY k.criado_em, k.id
    `, [somenteAtivos, tipos, somenteAplicaveis, base.principalId, base.departmentId])).rows;
    return linhas.map((item) => ({
      id: item.id, categoria: item.categoria, conteudo: item.conteudo,
      gatilhos: item.gatilhos, origem: item.origem, ativo: item.ativo,
      tipo: item.tipo || 'business_knowledge', escopo: item.escopo || 'global',
      principalId: item.principal_id || null, departmentId: item.department_id || null,
      versao: Number(item.versao || 1), payload: item.payload || {},
      criadoEm: item.criado_em?.toISOString?.() || item.criado_em,
      ...(item.desativado_em ? { desativadoEm: item.desativado_em.toISOString?.() || item.desativado_em } : {})
    }));
  }

  async function buscarPorTipo(pergunta, tipos, limite = 5) {
    return (await listarLonga({ somenteAtivos: true, somenteAplicaveis: true, tipos }))
      .map((item) => ({ item, pontuacao: pontuarConhecimento(item, pergunta) }))
      .filter(({ pontuacao }) => pontuacao >= 2 || pontuacao === 100)
      .sort((a, b) => b.pontuacao - a.pontuacao || (
        ({ global: 0, department: 1, principal: 2 }[a.item.escopo] ?? 3) -
        ({ global: 0, department: 1, principal: 2 }[b.item.escopo] ?? 3)
      ))
      .slice(0, limite).map(({ item }) => item);
  }

  async function buscarLonga(pergunta, limite = 5) {
    return buscarPorTipo(pergunta, ['business_knowledge'], limite);
  }

  async function buscarPlaybooks(pergunta, limite = 5) {
    return buscarPorTipo(pergunta, ['execution_playbook'], limite);
  }

  async function listarPreferencias() {
    return listarLonga({
      somenteAtivos: true, somenteAplicaveis: true, tipos: ['personal_preference']
    });
  }

  async function montarContexto(pergunta) {
    const curta = await listarCurta();
    const longa = await buscarLonga(pergunta);
    const blocos = [];
    if (curta.length) blocos.push(
      'Memoria curta (use apenas para resolver referencias da conversa; reconfirme dados mutaveis nas tools):',
      ...curta.map((item, indice) => `${indice + 1}. Pergunta: ${item.pergunta}\n` +
        `   Pergunta autonoma: ${item.perguntaAutonoma || item.pergunta}\n` +
        `   Perfil: ${item.perfil || 'nao registrado'}\n` +
        (item.rota ? `   Rota: ${JSON.stringify(item.rota)}\n` : '') +
        (Object.keys(item.entidades || {}).length ? `   Entidades: ${JSON.stringify(item.entidades)}\n` : '') +
        `   Resposta resumida: ${item.resposta}`)
    );
    if (longa.length) blocos.push(
      'Memoria longa relevante (aprendizados revisados; regras oficiais das tools prevalecem; em conflito, escopo global prevalece):',
      ...longa.map((item) => `- [${item.categoria}] ${item.conteudo}`)
    );
    return blocos.join('\n');
  }

  async function montarContextoEstruturado() {
    return (await listarCurta()).map((item) => ({
      pergunta: item.pergunta, perguntaAutonoma: item.perguntaAutonoma,
      dominio: item.rota?.dominioPrimario || item.perfil,
      dominiosSecundarios: item.rota?.dominiosSecundarios || [],
      intencao: item.rota?.intencao || null, entidades: item.entidades,
      periodo: item.periodo, filtros: item.filtros, campos: item.campos,
      ferramentas: item.ferramentas, referencias: item.referencias,
      resposta: item.resposta, criadaEm: item.criadaEm
    }));
  }

  async function adicionarConhecimento({
    conteudo, categoria = 'correcao', gatilhos = [], id: idInformado,
    origem = 'correcao_aprovada', ativo = true, criadoEm: criadoEmInformado,
    desativadoEm = null
  }) {
    const texto = resumir(conteudo, 1_000);
    if (!texto) throw new Error('Informe o aprendizado a memorizar.');
    return comTransacao(pool, async (cliente) => {
      let id = idInformado || (texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim().split(' ').slice(0, 6).join('-') || 'aprendizado');
      if (!idInformado) {
        const base = id;
        let sufixo = 2;
        while ((await cliente.query('SELECT 1 FROM nexus.knowledge_items WHERE id=$1', [id])).rowCount) id = `${base}-${sufixo++}`;
      }
      const criadoEm = criadoEmInformado || new Date().toISOString();
      await cliente.query(`INSERT INTO nexus.knowledge_items
        (id,categoria,conteudo,origem,ativo,criado_em,desativado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET categoria=EXCLUDED.categoria, conteudo=EXCLUDED.conteudo,
          origem=EXCLUDED.origem, ativo=EXCLUDED.ativo, criado_em=EXCLUDED.criado_em,
          desativado_em=EXCLUDED.desativado_em`,
      [id, categoria, texto, origem, ativo !== false, criadoEm, desativadoEm]);
      await cliente.query('DELETE FROM nexus.knowledge_triggers WHERE knowledge_id=$1', [id]);
      for (const gatilho of gatilhos.map((item) => resumir(item, 100)).filter(Boolean)) {
        await cliente.query('INSERT INTO nexus.knowledge_triggers (knowledge_id,gatilho) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, gatilho]);
      }
      return { id, categoria, conteudo: texto, gatilhos, origem, ativo: ativo !== false, criadoEm,
        ...(desativadoEm ? { desativadoEm } : {}) };
    });
  }

  async function removerConhecimento(id) {
    const linha = (await pool.query(`UPDATE nexus.knowledge_items SET ativo=false, desativado_em=now()
      WHERE id=$1 RETURNING *`, [id])).rows[0];
    if (!linha) throw new Error(`Aprendizado nao encontrado: ${id}`);
    return (await listarLonga()).find((item) => item.id === id);
  }

  async function limparCurta() {
    const { conversationId } = await obterContexto();
    await comTransacao(pool, async (cliente) => {
      await cliente.query('DELETE FROM nexus.interactions WHERE conversation_id=$1', [conversationId]);
      await cliente.query('DELETE FROM nexus.interaction_tasks WHERE conversation_id=$1', [conversationId]);
      await cliente.query('UPDATE nexus.conversations SET tarefa_ativa_id=NULL, atualizada_em=now() WHERE id=$1', [conversationId]);
    });
  }

  return {
    adicionarConhecimento, atualizarEstadoTarefa, buscarLonga, buscarPlaybooks, expirarTarefas,
    limparCurta, listarCurta, listarLonga, listarTarefas, montarContexto,
    montarContextoEstruturado, obterContexto, obterTarefaAtiva, registrarInteracao,
    removerConhecimento, retomarTarefa, salvarTarefa, listarPreferencias,
    pool, principalSlug, departamentoSlug, sessao,
    backend: 'postgres'
  };
}

module.exports = { criarPostgresMemoryStore };
