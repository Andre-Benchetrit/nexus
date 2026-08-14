const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const CAMINHO_CONHECIMENTO = path.join(RAIZ, 'memoria', 'conhecimento.json');
const DIRETORIO_RUNTIME = path.join(RAIZ, 'memoria', '.runtime');
const LIMITE_CURTA_PADRAO = 10;
const LIMITE_TAREFAS_PENDENTES = 5;
const TTL_TAREFA_PADRAO_MS = 24 * 60 * 60 * 1000;
const LIMITE_RESUMO_PERGUNTA = 180;
const LIMITE_RESUMO_RESPOSTA = 1_000;

const PALAVRAS_VAZIAS = new Set([
  'a', 'as', 'ao', 'aos', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e',
  'em', 'entre', 'essa', 'esse', 'esta', 'este', 'eu', 'me', 'na', 'nas', 'no',
  'nos', 'o', 'os', 'para', 'por', 'que', 'qual', 'quais', 'se', 'um', 'uma'
]);

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim();
}

function resumir(texto, limite) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= limite) return limpo;
  const trecho = limpo.slice(0, limite - 1);
  const ultimoEspaco = trecho.lastIndexOf(' ');
  return `${trecho.slice(0, ultimoEspaco > limite * 0.7 ? ultimoEspaco : trecho.length)}…`;
}

function validarSessao(sessao) {
  const valor = String(sessao || 'padrao').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,60}$/.test(valor)) {
    throw new Error('Sessao de memoria invalida. Use letras, numeros, _ ou -.');
  }
  return valor;
}

function caminhoSessao(sessao) {
  return path.join(DIRETORIO_RUNTIME, `sessao-${validarSessao(sessao)}.json`);
}

function lerJson(caminho, padrao) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (erro) {
    if (erro.code === 'ENOENT') return structuredClone(padrao);
    throw new Error(`Memoria invalida em ${caminho}: ${erro.message}`);
  }
}

function gravarJson(caminho, valor) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, 'utf8');
  fs.renameSync(temporario, caminho);
}

function tokensRelevantes(texto) {
  return new Set(
    normalizar(texto)
      .split(' ')
      .filter((token) => token.length >= 3 && !PALAVRAS_VAZIAS.has(token))
  );
}

function pontuarConhecimento(item, pergunta) {
  if (item.ativo === false) return 0;
  const perguntaNormalizada = normalizar(pergunta);
  const gatilhos = (item.gatilhos || []).map(normalizar).filter(Boolean);
  if (gatilhos.some((gatilho) => perguntaNormalizada.includes(gatilho))) return 100;

  const tokensPergunta = tokensRelevantes(pergunta);
  const tokensItem = tokensRelevantes(
    `${item.categoria || ''} ${item.conteudo || ''} ${gatilhos.join(' ')}`
  );
  let comuns = 0;
  for (const token of tokensPergunta) {
    if (tokensItem.has(token)) comuns += 1;
  }
  return comuns;
}

function extrairReferenciasTemporais(resposta) {
  const texto = String(resposta || '');
  const ultimaDataCompleta = texto.match(
    /[uú]ltima data completa\s+(?:[eé]|foi|:)\s*(\d{4}-\d{2}-\d{2})/i
  )?.[1] || null;
  return ultimaDataCompleta ? { ultimaDataCompleta } : {};
}

function pareceContinuacao(pergunta) {
  const texto = normalizar(pergunta);
  if (!texto) return false;
  return /^(e |agora |nesse|nessa|nesses|nessas|desses|dessas|deles|delas|tambem|compare|detalhe|separe|mostre os|mostre as|pode me passar|passe|repita|inclua|adicione|acrescente)/.test(texto)
    || /\b(anterior|acima|mesmo periodo|esses dados|esse resultado|esses pedidos|os mesmos|novamente)\b/.test(texto);
}

const CHAVES_SENSIVEIS = /token|secret|senha|password|credential|api[_-]?key|sql|caminho|path/i;

function sanitizarEstrutura(valor) {
  if (Array.isArray(valor)) return valor.map(sanitizarEstrutura);
  if (!valor || typeof valor !== 'object') {
    return typeof valor === 'bigint' ? String(valor) : valor;
  }
  return Object.fromEntries(
    Object.entries(valor)
      .filter(([chave]) => !CHAVES_SENSIVEIS.test(chave))
      .map(([chave, item]) => [chave, sanitizarEstrutura(item)])
  );
}

function normalizarInteracao(item) {
  return {
    pergunta: item.pergunta || '',
    perguntaAutonoma: item.perguntaAutonoma || item.pergunta || '',
    resposta: item.resposta || '',
    provider: item.provider || null,
    modelo: item.modelo || null,
    perfil: item.perfil || item.rota?.dominioPrimario || null,
    rota: item.rota || null,
    plano: item.plano || null,
    ferramentas: item.ferramentas || [],
    entidades: item.entidades || {},
    periodo: item.periodo || item.rota?.periodo || null,
    filtros: item.filtros || item.rota?.filtros || [],
    campos: item.campos || item.rota?.camposSolicitados || [],
    referencias: item.referencias || {},
    criadaEm: item.criadaEm || null
  };
}

function normalizarTarefa(item) {
  return {
    id: String(item.id || ''),
    tipo: String(item.tipo || ''),
    estado: item.estado || 'ativa',
    slots: sanitizarEstrutura(item.slots || {}),
    camposPendentes: [...new Set(item.camposPendentes || [])],
    contexto: sanitizarEstrutura(item.contexto || {}),
    perguntas: sanitizarEstrutura(item.perguntas || []),
    criadaEm: item.criadaEm || new Date().toISOString(),
    atualizadaEm: item.atualizadaEm || item.criadaEm || new Date().toISOString(),
    expiraEm: item.expiraEm || new Date(Date.now() + TTL_TAREFA_PADRAO_MS).toISOString()
  };
}

function criarFileMemoryStore(opcoes = {}) {
  const sessao = validarSessao(opcoes.sessao || 'padrao');
  const limiteCurta = Number(
    opcoes.limiteCurta || process.env.NEXUS_SESSION_HISTORY_LIMIT || LIMITE_CURTA_PADRAO
  );
  if (!Number.isInteger(limiteCurta) || limiteCurta < 1 || limiteCurta > 50) {
    throw new Error('Limite da memoria curta deve ser um inteiro entre 1 e 50.');
  }
  const arquivoCurta = opcoes.caminhoCurta || caminhoSessao(sessao);
  const arquivoLonga = opcoes.caminhoLonga || CAMINHO_CONHECIMENTO;

  function lerSessao() {
    const dados = lerJson(arquivoCurta, {
      versao: 3,
      sessao,
      interacoes: [],
      tarefas: [],
      tarefaAtiva: null
    });
    return {
      versao: 3,
      sessao,
      interacoes: (dados.interacoes || []).map(normalizarInteracao),
      tarefas: (dados.tarefas || []).map(normalizarTarefa),
      tarefaAtiva: dados.tarefaAtiva || null
    };
  }

  function gravarSessao(dados) {
    gravarJson(arquivoCurta, {
      versao: 3,
      sessao,
      interacoes: (dados.interacoes || []).slice(-limiteCurta),
      tarefas: (dados.tarefas || []).map(normalizarTarefa),
      tarefaAtiva: dados.tarefaAtiva || null
    });
  }

  function listarCurta() {
    const dados = lerSessao();
    return (dados.interacoes || []).slice(-limiteCurta).map(normalizarInteracao);
  }

  function expirarTarefas(agora = new Date()) {
    const dados = lerSessao();
    let alterado = false;
    for (const tarefa of dados.tarefas) {
      if (
        ['ativa', 'aguardando_usuario', 'pausada'].includes(tarefa.estado) &&
        Date.parse(tarefa.expiraEm) <= agora.getTime()
      ) {
        tarefa.estado = 'expirada';
        tarefa.atualizadaEm = agora.toISOString();
        if (dados.tarefaAtiva === tarefa.id) dados.tarefaAtiva = null;
        alterado = true;
      }
    }
    if (alterado) gravarSessao(dados);
    return dados.tarefas.filter((item) => item.estado === 'expirada');
  }

  function listarTarefas({ incluirFinalizadas = false } = {}) {
    expirarTarefas();
    const tarefas = lerSessao().tarefas;
    return tarefas.filter((item) => incluirFinalizadas ||
      ['ativa', 'aguardando_usuario', 'pausada'].includes(item.estado));
  }

  function obterTarefaAtiva() {
    expirarTarefas();
    const dados = lerSessao();
    return dados.tarefas.find((item) => item.id === dados.tarefaAtiva &&
      ['ativa', 'aguardando_usuario'].includes(item.estado)) || null;
  }

  function salvarTarefa(tarefa, { ativar = true } = {}) {
    const dados = lerSessao();
    const agora = new Date().toISOString();
    const normalizada = normalizarTarefa({
      ...tarefa,
      atualizadaEm: agora,
      criadaEm: tarefa.criadaEm || agora
    });
    const indice = dados.tarefas.findIndex((item) => item.id === normalizada.id);
    if (indice >= 0) dados.tarefas[indice] = normalizada;
    else dados.tarefas.push(normalizada);
    if (ativar) {
      for (const item of dados.tarefas) {
        if (
          item.id !== normalizada.id &&
          ['ativa', 'aguardando_usuario'].includes(item.estado)
        ) item.estado = 'pausada';
      }
      dados.tarefaAtiva = normalizada.id;
    }
    const pendentes = dados.tarefas.filter((item) =>
      ['ativa', 'aguardando_usuario', 'pausada'].includes(item.estado));
    if (pendentes.length > LIMITE_TAREFAS_PENDENTES) {
      const remover = pendentes
        .filter((item) => item.id !== dados.tarefaAtiva)
        .sort((a, b) => a.atualizadaEm.localeCompare(b.atualizadaEm))
        .slice(0, pendentes.length - LIMITE_TAREFAS_PENDENTES);
      const ids = new Set(remover.map((item) => item.id));
      dados.tarefas = dados.tarefas.filter((item) => !ids.has(item.id));
    }
    gravarSessao(dados);
    return normalizada;
  }

  function atualizarEstadoTarefa(id, estado) {
    const dados = lerSessao();
    const tarefa = dados.tarefas.find((item) => item.id === id);
    if (!tarefa) return null;
    tarefa.estado = estado;
    tarefa.atualizadaEm = new Date().toISOString();
    if (['concluida', 'cancelada', 'expirada', 'pausada'].includes(estado) &&
      dados.tarefaAtiva === id) dados.tarefaAtiva = null;
    if (['ativa', 'aguardando_usuario'].includes(estado)) dados.tarefaAtiva = id;
    gravarSessao(dados);
    return normalizarTarefa(tarefa);
  }

  function retomarTarefa(id) {
    const dados = lerSessao();
    const tarefa = dados.tarefas.find((item) => item.id === id && item.estado === 'pausada');
    if (!tarefa) return null;
    for (const item of dados.tarefas) {
      if (['ativa', 'aguardando_usuario'].includes(item.estado)) item.estado = 'pausada';
    }
    tarefa.estado = tarefa.camposPendentes.length ? 'aguardando_usuario' : 'ativa';
    tarefa.atualizadaEm = new Date().toISOString();
    dados.tarefaAtiva = tarefa.id;
    gravarSessao(dados);
    return normalizarTarefa(tarefa);
  }

  function listarLonga({ somenteAtivos = false } = {}) {
    const dados = lerJson(arquivoLonga, { versao: 1, itens: [] });
    return (dados.itens || []).filter((item) => !somenteAtivos || item.ativo !== false);
  }

  function buscarLonga(pergunta, limite = 5) {
    return listarLonga({ somenteAtivos: true })
      .map((item) => ({ item, pontuacao: pontuarConhecimento(item, pergunta) }))
      .filter(({ pontuacao }) => pontuacao >= 2 || pontuacao === 100)
      .sort((a, b) => b.pontuacao - a.pontuacao)
      .slice(0, limite)
      .map(({ item }) => item);
  }

  function montarContexto(pergunta) {
    const curta = listarCurta();
    const longa = buscarLonga(pergunta);
    const blocos = [];

    if (curta.length) {
      blocos.push(
        'Memoria curta (use apenas para resolver referencias da conversa; reconfirme dados mutaveis nas tools):',
        ...curta.map((item, indice) => (
          `${indice + 1}. Pergunta: ${item.pergunta}\n` +
          `   Pergunta autonoma: ${item.perguntaAutonoma || item.pergunta}\n` +
          `   Perfil: ${item.perfil || 'nao registrado'}\n` +
          (item.rota ? `   Rota: ${JSON.stringify(item.rota)}\n` : '') +
          (Object.keys(item.entidades || {}).length
            ? `   Entidades: ${JSON.stringify(item.entidades)}\n`
            : '') +
          `   Resposta resumida: ${item.resposta}` +
          (
            item.referencias?.ultimaDataCompleta
              ? `\n   Ultima data completa: ${item.referencias.ultimaDataCompleta}`
              : ''
          )
        ))
      );
    }
    if (longa.length) {
      blocos.push(
        'Memoria longa relevante (aprendizados revisados; regras oficiais das tools prevalecem):',
        ...longa.map((item) => `- [${item.categoria}] ${item.conteudo}`)
      );
    }
    return blocos.join('\n');
  }

  function montarContextoEstruturado() {
    return listarCurta().map((item) => ({
      pergunta: item.pergunta,
      perguntaAutonoma: item.perguntaAutonoma,
      dominio: item.rota?.dominioPrimario || item.perfil,
      dominiosSecundarios: item.rota?.dominiosSecundarios || [],
      intencao: item.rota?.intencao || null,
      entidades: item.entidades,
      periodo: item.periodo,
      filtros: item.filtros,
      campos: item.campos,
      ferramentas: item.ferramentas.map((ferramenta) => ({
        nome: ferramenta.nome,
        argumentos: ferramenta.argumentos,
        referencias: ferramenta.referencias,
        atualizadoEm: ferramenta.atualizadoEm || null
      })),
      referencias: item.referencias,
      resposta: item.resposta,
      criadaEm: item.criadaEm
    }));
  }

  function registrarInteracao({
    pergunta,
    perguntaAutonoma,
    resposta,
    provider,
    modelo,
    perfil,
    rota,
    plano,
    ferramentas = [],
    entidades = {},
    periodo,
    filtros,
    campos,
    referencias
  }) {
    const dados = lerSessao();
    dados.interacoes = [
      ...(dados.interacoes || []).map(normalizarInteracao),
      {
        pergunta: resumir(pergunta, LIMITE_RESUMO_PERGUNTA),
        perguntaAutonoma: resumir(
          perguntaAutonoma || rota?.perguntaAutonoma || pergunta,
          LIMITE_RESUMO_PERGUNTA * 2
        ),
        resposta: resumir(resposta, LIMITE_RESUMO_RESPOSTA),
        provider: provider || null,
        modelo: modelo || null,
        perfil: perfil || null,
        rota: rota ? sanitizarEstrutura(rota) : null,
        plano: plano ? sanitizarEstrutura(plano) : null,
        ferramentas: sanitizarEstrutura(ferramentas),
        entidades: sanitizarEstrutura(entidades),
        periodo: sanitizarEstrutura(periodo || rota?.periodo || null),
        filtros: sanitizarEstrutura(filtros || rota?.filtros || []),
        campos: sanitizarEstrutura(campos || rota?.camposSolicitados || []),
        referencias: sanitizarEstrutura(
          referencias || extrairReferenciasTemporais(resposta)
        ),
        criadaEm: new Date().toISOString()
      }
    ].slice(-limiteCurta);
    gravarSessao(dados);
  }

  function adicionarConhecimento({ conteudo, categoria = 'correcao', gatilhos = [] }) {
    const texto = resumir(conteudo, 1_000);
    if (!texto) throw new Error('Informe o aprendizado a memorizar.');
    const dados = lerJson(arquivoLonga, { versao: 1, itens: [] });
    const idBase = normalizar(texto).split(' ').slice(0, 6).join('-') || 'aprendizado';
    let id = idBase;
    let sufixo = 2;
    while ((dados.itens || []).some((item) => item.id === id)) id = `${idBase}-${sufixo++}`;
    const item = {
      id,
      categoria,
      conteudo: texto,
      gatilhos: gatilhos.map((gatilho) => resumir(gatilho, 100)).filter(Boolean),
      origem: 'correcao_aprovada',
      ativo: true,
      criadoEm: new Date().toISOString()
    };
    dados.itens = [...(dados.itens || []), item];
    gravarJson(arquivoLonga, dados);
    return item;
  }

  function removerConhecimento(id) {
    const dados = lerJson(arquivoLonga, { versao: 1, itens: [] });
    const item = (dados.itens || []).find((atual) => atual.id === id);
    if (!item) throw new Error(`Aprendizado nao encontrado: ${id}`);
    item.ativo = false;
    item.desativadoEm = new Date().toISOString();
    gravarJson(arquivoLonga, dados);
    return item;
  }

  function limparCurta() {
    gravarSessao({ versao: 3, sessao, interacoes: [], tarefas: [], tarefaAtiva: null });
  }

  return {
    adicionarConhecimento,
    atualizarEstadoTarefa,
    buscarLonga,
    expirarTarefas,
    limparCurta,
    listarCurta,
    listarLonga,
    listarTarefas,
    montarContexto,
    montarContextoEstruturado,
    obterTarefaAtiva,
    registrarInteracao,
    removerConhecimento,
    retomarTarefa,
    salvarTarefa,
    sessao,
    backend: 'file'
  };
}

function resolverBackendMemoria(opcoes = {}) {
  if (opcoes.caminhoCurta || opcoes.caminhoLonga) return 'file';
  const backend = String(
    opcoes.backend || process.env.NEXUS_MEMORY_BACKEND ||
    (process.env.NEXUS_DATABASE_URL ? 'postgres' : 'file')
  ).toLowerCase();
  if (!['file', 'postgres'].includes(backend)) {
    throw new Error(`Backend de memoria invalido: ${backend}.`);
  }
  return backend;
}

function criarMemoria(opcoes = {}) {
  const backend = resolverBackendMemoria(opcoes);
  if (backend === 'file') return criarFileMemoryStore(opcoes);
  const { criarPostgresMemoryStore } = require('../nexus/memoria_postgres');
  return criarPostgresMemoryStore(opcoes);
}

module.exports = {
  CAMINHO_CONHECIMENTO,
  LIMITE_CURTA_PADRAO,
  LIMITE_TAREFAS_PENDENTES,
  TTL_TAREFA_PADRAO_MS,
  criarFileMemoryStore,
  criarMemoria,
  extrairReferenciasTemporais,
  pareceContinuacao,
  pontuarConhecimento,
  resumir,
  sanitizarEstrutura,
  normalizarInteracao,
  normalizarTarefa,
  resolverBackendMemoria,
  validarSessao
};
