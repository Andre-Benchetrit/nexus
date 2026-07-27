const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const CAMINHO_CONHECIMENTO = path.join(RAIZ, 'memoria', 'conhecimento.json');
const DIRETORIO_RUNTIME = path.join(RAIZ, 'memoria', '.runtime');
const LIMITE_CURTA_PADRAO = 3;
const LIMITE_RESUMO_PERGUNTA = 180;
const LIMITE_RESUMO_RESPOSTA = 320;

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
  return /^(e |agora |nesse|nessa|nesses|nessas|desses|dessas|deles|delas|tambem|compare|detalhe|separe|mostre os|mostre as)/.test(texto)
    || /\b(anterior|acima|mesmo periodo|esses dados|esse resultado)\b/.test(texto);
}

function criarMemoria(opcoes = {}) {
  const sessao = validarSessao(opcoes.sessao || 'padrao');
  const limiteCurta = Number(opcoes.limiteCurta || LIMITE_CURTA_PADRAO);
  const arquivoCurta = opcoes.caminhoCurta || caminhoSessao(sessao);
  const arquivoLonga = opcoes.caminhoLonga || CAMINHO_CONHECIMENTO;

  function listarCurta() {
    const dados = lerJson(arquivoCurta, { versao: 1, sessao, interacoes: [] });
    return (dados.interacoes || []).slice(-limiteCurta);
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
          `   Perfil: ${item.perfil || 'nao registrado'}\n` +
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

  function registrarInteracao({ pergunta, resposta, provider, modelo, perfil, referencias }) {
    const dados = lerJson(arquivoCurta, { versao: 1, sessao, interacoes: [] });
    dados.interacoes = [
      ...(dados.interacoes || []),
      {
        pergunta: resumir(pergunta, LIMITE_RESUMO_PERGUNTA),
        resposta: resumir(resposta, LIMITE_RESUMO_RESPOSTA),
        provider: provider || null,
        modelo: modelo || null,
        perfil: perfil || null,
        referencias: referencias || extrairReferenciasTemporais(resposta),
        criadaEm: new Date().toISOString()
      }
    ].slice(-limiteCurta);
    gravarJson(arquivoCurta, dados);
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
    gravarJson(arquivoCurta, { versao: 1, sessao, interacoes: [] });
  }

  return {
    adicionarConhecimento,
    buscarLonga,
    limparCurta,
    listarCurta,
    listarLonga,
    montarContexto,
    registrarInteracao,
    removerConhecimento,
    sessao
  };
}

module.exports = {
  CAMINHO_CONHECIMENTO,
  LIMITE_CURTA_PADRAO,
  criarMemoria,
  extrairReferenciasTemporais,
  pareceContinuacao,
  pontuarConhecimento,
  resumir
};
