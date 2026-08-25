const { randomUUID } = require('node:crypto');

const MODOS_HANDOFF = Object.freeze(['legacy', 'shadow', 'v1']);
const CHAVE_SENSIVEL = /password|senha|secret|token|credential|api[_-]?key|prompt|sql|conteudo_bruto|resultado_bruto/i;

function resolverModoHandoff(valor = process.env.NEXUS_HANDOFF_MODE || 'shadow') {
  const modo = String(valor).toLowerCase();
  if (!MODOS_HANDOFF.includes(modo)) {
    throw new Error(`NEXUS_HANDOFF_MODE invalido: ${modo}.`);
  }
  return modo;
}

function ordenarEstrutura(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarEstrutura);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.keys(valor).sort().map((chave) => (
    [chave, ordenarEstrutura(valor[chave])]
  )));
}

function assinaturaTool(nome, argumentos) {
  return `${nome}:${JSON.stringify(ordenarEstrutura(argumentos || {}))}`;
}

function sanitizarHandoff(valor, profundidade = 0) {
  if (profundidade > 16) return '[estrutura_profunda_omitida]';
  if (Array.isArray(valor)) return valor.map((item) => sanitizarHandoff(item, profundidade + 1));
  if (!valor || typeof valor !== 'object') {
    if (typeof valor === 'bigint') return String(valor);
    if (typeof valor === 'string' && /^\s*(?:SELECT|WITH\b[\s\S]*?SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(valor)) {
      return '[sql_omitido]';
    }
    if (typeof valor === 'string' && /(?:postgres(?:ql)?:\/\/|api[_-]?key\s*[:=]|bearer\s+[a-z0-9._-]{12,})/i.test(valor)) {
      return '[segredo_omitido]';
    }
    return valor;
  }
  return Object.fromEntries(Object.entries(valor)
    .filter(([chave]) => !CHAVE_SENSIVEL.test(chave))
    .map(([chave, item]) => [chave, sanitizarHandoff(item, profundidade + 1)]));
}

function codigoErro(erro) {
  const valor = erro?.codigo || erro?.code || erro?.status || erro?.statusCode || erro?.name;
  return valor && /^[A-Za-z0-9_-]{2,80}$/.test(String(valor))
    ? String(valor).toUpperCase()
    : erro ? 'ERRO_EXECUCAO' : null;
}

function selecionarArgumentosHandoff(argumentos, permitidos) {
  if (!Array.isArray(permitidos)) return sanitizarHandoff(argumentos);
  return sanitizarHandoff(Object.fromEntries(Object.entries(argumentos || {})
    .filter(([chave]) => permitidos.includes(chave))));
}

function criarEstadoExecucao(opcoes = {}) {
  const id = opcoes.id || randomUUID();
  const modo = resolverModoHandoff(opcoes.modo);
  const checkpoints = [];
  const ledger = new Map();
  const contexto = {
    objetivo: opcoes.objetivo || null,
    perguntaAutonoma: opcoes.perguntaAutonoma || null,
    etapa: opcoes.etapa || null,
    rota: null,
    plano: null,
    restricoes: [],
    capacidadesAusentes: [],
    requisitosResposta: []
  };

  function checkpoint(tipo, dados = {}) {
    const item = {
      sequencia: checkpoints.length + 1,
      tipo,
      etapa: dados.etapa || contexto.etapa || null,
      provider: dados.provider || null,
      callId: dados.callId || null,
      criadoEm: new Date().toISOString(),
      dados: sanitizarHandoff(dados.dados || {})
    };
    checkpoints.push(item);
    opcoes.onCheckpoint?.(item);
    return item;
  }

  function atualizarContexto(atualizacao = {}) {
    for (const chave of [
      'objetivo', 'perguntaAutonoma', 'etapa', 'rota', 'plano',
      'restricoes', 'capacidadesAusentes', 'requisitosResposta'
    ]) {
      if (atualizacao[chave] !== undefined) contexto[chave] = sanitizarHandoff(atualizacao[chave]);
    }
    checkpoint('contexto_atualizado', { etapa: atualizacao.etapa, dados: {
      campos: Object.keys(atualizacao)
    } });
  }

  function prepararTool(nome, argumentos, politica = {}) {
    const assinatura = assinaturaTool(nome, argumentos);
    const anterior = ledger.get(assinatura);
    if (anterior?.status === 'sucesso' && anterior.efeito === 'leitura' && anterior.idempotente) {
      anterior.reutilizacoes += 1;
      checkpoint('tool_reutilizada', { dados: { nome, assinatura, execucaoId: anterior.execucaoId } });
      return { reutilizar: true, resultado: anterior.resultado, entrada: anterior };
    }
    if (anterior?.status === 'sucesso' && anterior.efeito === 'escrita') {
      const erro = new Error(`Tool de escrita ${nome} nao pode ser repetida automaticamente.`);
      erro.codigo = 'ESCRITA_REPETIDA_BLOQUEADA';
      throw erro;
    }
    if (anterior?.status === 'erro_validacao') {
      const erro = new Error(`Chamada invalida repetida bloqueada para ${nome}.`);
      erro.codigo = 'CHAMADA_INVALIDA_REPETIDA';
      throw erro;
    }
    if (anterior?.status === 'erro') {
      const ultimo = anterior.erros?.at(-1);
      const repetir = politica.politicaReutilizacao === 'repetir_transitorio' && ultimo?.transitorio;
      if (!repetir) {
        const erro = new Error(`Chamada com falha anterior nao sera repetida para ${nome}.`);
        erro.codigo = 'CHAMADA_FALHA_REPETIDA';
        throw erro;
      }
    }
    const entrada = anterior || {
      assinatura,
      nome,
      argumentos: selecionarArgumentosHandoff(argumentos, politica.argumentosHandoff),
      efeito: politica.efeito || 'leitura',
      idempotente: politica.idempotencia !== false,
      politicaReutilizacao: politica.politicaReutilizacao || 'mesmo_turno',
      status: 'iniciada',
      tentativas: 0,
      reutilizacoes: 0,
      resultado: null,
      referencias: {},
      execucaoId: null,
      erros: []
    };
    entrada.tentativas += 1;
    entrada.status = 'iniciada';
    ledger.set(assinatura, entrada);
    checkpoint('tool_iniciada', { dados: { nome, assinatura, tentativa: entrada.tentativas } });
    return { reutilizar: false, entrada };
  }

  function concluirTool(nome, argumentos, resultado, detalhes = {}) {
    const assinatura = assinaturaTool(nome, argumentos);
    const entrada = ledger.get(assinatura) || prepararTool(nome, argumentos, detalhes.politica).entrada;
    entrada.status = 'sucesso';
    entrada.resultado = sanitizarHandoff(resultado);
    entrada.referencias = sanitizarHandoff(detalhes.referencias || {});
    entrada.execucaoId = detalhes.execucaoId || entrada.execucaoId || null;
    entrada.concluidaEm = new Date().toISOString();
    checkpoint('tool_concluida', { dados: {
      nome, assinatura, execucaoId: entrada.execucaoId,
      referencias: entrada.referencias
    } });
    return entrada;
  }

  function falharTool(nome, argumentos, erro, detalhes = {}) {
    const assinatura = assinaturaTool(nome, argumentos);
    const entrada = ledger.get(assinatura) || {
      assinatura, nome,
      argumentos: selecionarArgumentosHandoff(argumentos, detalhes.argumentosHandoff), efeito: 'leitura',
      idempotente: true, tentativas: 1, reutilizacoes: 0, referencias: {}, erros: []
    };
    const codigo = codigoErro(erro);
    const validacao = detalhes.validacao === true || /VALID|ARGUMENT|SCHEMA|REJEIT|INVALID/i.test(codigo || '');
    entrada.status = validacao ? 'erro_validacao' : 'erro';
    entrada.erros ||= [];
    entrada.erros.push({ codigo, transitorio: detalhes.transitorio === true });
    entrada.concluidaEm = new Date().toISOString();
    ledger.set(assinatura, entrada);
    checkpoint('tool_falhou', { dados: {
      nome, assinatura, codigo, validacao, transitorio: detalhes.transitorio === true
    } });
    return entrada;
  }

  function criarHandoff({ providerAnterior, providerDestino, erro } = {}) {
    const ferramentas = [...ledger.values()];
    const handoff = {
      versao: 1,
      executionId: id,
      objetivo: contexto.objetivo,
      perguntaAutonoma: contexto.perguntaAutonoma,
      etapa: contexto.etapa,
      rota: contexto.rota,
      plano: contexto.plano,
      restricoes: contexto.restricoes,
      capacidadesAusentes: contexto.capacidadesAusentes,
      requisitosResposta: contexto.requisitosResposta,
      providerAnterior: providerAnterior || null,
      providerDestino: providerDestino || null,
      falhaProvider: erro ? { codigo: codigoErro(erro) } : null,
      toolsConcluidas: ferramentas.filter((item) => item.status === 'sucesso').map((item) => ({
        nome: item.nome,
        argumentos: item.argumentos,
        resultado: item.resultado,
        referencias: item.referencias,
        execucaoId: item.execucaoId,
        reutilizacoes: item.reutilizacoes
      })),
      tentativasFalhas: ferramentas.filter((item) => item.status.startsWith('erro')).map((item) => ({
        nome: item.nome,
        argumentos: item.argumentos,
        status: item.status,
        erros: item.erros
      })),
      checkpoints: checkpoints.map((item) => ({
        sequencia: item.sequencia,
        tipo: item.tipo,
        etapa: item.etapa,
        provider: item.provider,
        dados: item.dados
      }))
    };
    checkpoint('handoff_criado', { dados: {
      providerAnterior, providerDestino,
      toolsConcluidas: handoff.toolsConcluidas.length,
      tentativasFalhas: handoff.tentativasFalhas.length,
      codigo: handoff.falhaProvider?.codigo || null
    } });
    return sanitizarHandoff(handoff);
  }

  return {
    id,
    modo,
    checkpoint,
    atualizarContexto,
    prepararTool,
    concluirTool,
    falharTool,
    criarHandoff,
    listarCheckpoints: () => structuredClone(checkpoints),
    listarLedger: () => structuredClone([...ledger.values()]),
    contexto: () => structuredClone(contexto)
  };
}

function aplicarHandoffAoContexto(contexto, handoff) {
  const mensagens = Array.isArray(contexto.mensagens) ? [...contexto.mensagens] : [];
  mensagens.push({
    role: 'user',
    content: [
      'Continue a tarefa a partir deste checkpoint validado pelo Nexus.',
      'Nao repita tools concluidas; use as evidencias fornecidas e busque apenas o que estiver ausente.',
      `Checkpoint estruturado: ${JSON.stringify(handoff)}`
    ].join('\n')
  });
  return { ...contexto, mensagens, handoff };
}

module.exports = {
  MODOS_HANDOFF,
  aplicarHandoffAoContexto,
  assinaturaTool,
  criarEstadoExecucao,
  resolverModoHandoff,
  sanitizarHandoff
};
