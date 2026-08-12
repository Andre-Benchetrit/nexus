const fs = require('node:fs');
const path = require('node:path');

const { executarAgente } = require('../agentes/consultor_nexus');
const { criarMemoria, pareceContinuacao } = require('../agentes/memoria');
const { resolverPerfilComContexto } = require('../agentes/roteador');

const RAIZ = path.resolve(__dirname, '..');
const CAMINHO_BATERIA = path.join(RAIZ, 'avaliacoes', 'perguntas_reais.json');
const DIRETORIO_RESULTADOS = path.join(RAIZ, 'avaliacoes', 'resultados');

function lerOpcoes(argumentos) {
  const opcoes = { executar: false, limite: Infinity };
  for (let i = 0; i < argumentos.length; i += 1) {
    const atual = argumentos[i];
    if (atual === '--executar') opcoes.executar = true;
    else if (atual === '--debug') opcoes.debug = true;
    else if (atual === '--provider') opcoes.providerNome = argumentos[++i];
    else if (atual === '--model') opcoes.modelo = argumentos[++i];
    else if (atual === '--router-mode') opcoes.routerMode = argumentos[++i];
    else if (atual === '--router-provider') opcoes.routerProviderNome = argumentos[++i];
    else if (atual === '--router-model') opcoes.routerModelo = argumentos[++i];
    else if (atual === '--categoria') opcoes.categoria = argumentos[++i];
    else if (atual === '--caso') opcoes.caso = argumentos[++i];
    else if (atual === '--limite') opcoes.limite = Number(argumentos[++i]);
    else throw new Error(`Opcao desconhecida: ${atual}`);
  }
  if (!Number.isInteger(opcoes.limite) && opcoes.limite !== Infinity) {
    throw new Error('--limite deve ser um numero inteiro.');
  }
  return opcoes;
}

function carregarCasos(opcoes = {}) {
  const bateria = JSON.parse(fs.readFileSync(CAMINHO_BATERIA, 'utf8'));
  return bateria.casos
    .filter((caso) => !opcoes.categoria || caso.categoria === opcoes.categoria)
    .filter((caso) => !opcoes.caso || caso.id === opcoes.caso)
    .slice(0, opcoes.limite);
}

function perguntaParaRoteamento(caso) {
  if (!caso.contextoAnterior || !pareceContinuacao(caso.pergunta)) return caso.pergunta;
  return `${caso.contextoAnterior.pergunta} ${caso.pergunta}`;
}

function validarResposta(texto) {
  const resposta = String(texto || '').trim();
  const problemas = [];
  if (resposta.length < 10) problemas.push('resposta vazia ou curta demais');
  if (/tool call validation failed|excedeu .* rodadas|erro:/i.test(resposta)) {
    problemas.push('resposta contem erro interno');
  }
  return problemas;
}

async function executarCaso(caso, opcoes) {
  const inicio = Date.now();
  const historico = caso.contextoAnterior ? [caso.contextoAnterior] : [];
  const perfilObtido = resolverPerfilComContexto(caso.pergunta, historico);
  const resultado = {
    id: caso.id,
    categoria: caso.categoria,
    pergunta: caso.pergunta,
    perfilEsperado: caso.perfilEsperado,
    perfilObtido,
    contratoOk: perfilObtido === caso.perfilEsperado,
    criterios: caso.criterios
  };
  if (!opcoes.executar) return resultado;

  let memoria = false;
  if (caso.contextoAnterior) {
    memoria = criarMemoria({ sessao: `avaliacao-${process.pid}-${caso.id}` });
    memoria.limparCurta();
    memoria.registrarInteracao({
      ...caso.contextoAnterior,
      provider: 'fixture',
      modelo: 'fixture'
    });
  }

  try {
    const resposta = await executarAgente(caso.pergunta, {
      providerNome: opcoes.providerNome,
      modelo: opcoes.modelo,
      routerMode: opcoes.routerMode,
      routerProviderNome: opcoes.routerProviderNome,
      routerModelo: opcoes.routerModelo,
      semFallback: true,
      memoria,
      onEvento: opcoes.debug
        ? (mensagem) => console.error(`[${caso.id}] ${mensagem}`)
        : undefined
    });
    resultado.resposta = resposta.texto;
    resultado.provider = resposta.provider;
    resultado.modelo = resposta.modelo;
    resultado.rodadas = resposta.rodadas;
    resultado.roteamento = resposta.roteamento;
    resultado.intencaoObtida = resposta.roteamento?.decisao?.intencao || null;
    resultado.ferramentasExecutadas = resposta.roteamento?.ferramentasExecutadas || [];
    resultado.intencaoOk = !caso.intencaoEsperada ||
      resultado.intencaoObtida === caso.intencaoEsperada;
    resultado.planoOk = !(caso.ferramentasEsperadas || []).length ||
      caso.ferramentasEsperadas.every((nome) => (
        resposta.roteamento?.plano?.ferramentas?.includes(nome)
      ));
    resultado.problemasAutomaticos = validarResposta(resposta.texto);
    resultado.execucaoOk = resultado.problemasAutomaticos.length === 0 &&
      resultado.intencaoOk && resultado.planoOk;
  } catch (erro) {
    resultado.erro = erro.message;
    resultado.execucaoOk = false;
  } finally {
    if (memoria) memoria.limparCurta();
  }
  resultado.duracaoMs = Date.now() - inicio;
  return resultado;
}

function salvarRelatorio(resultados, opcoes) {
  fs.mkdirSync(DIRETORIO_RESULTADOS, { recursive: true });
  const instante = new Date().toISOString().replace(/[:.]/g, '-');
  const caminho = path.join(DIRETORIO_RESULTADOS, `${instante}.json`);
  const relatorio = {
    criadoEm: new Date().toISOString(),
    providerSolicitado: opcoes.providerNome || process.env.LLM_PROVIDER || 'padrao',
    roteadorSolicitado: {
      modo: opcoes.routerMode || process.env.NEXUS_ROUTER_MODE || 'shadow',
      provider: opcoes.routerProviderNome || process.env.NEXUS_ROUTER_PROVIDER || null,
      modelo: opcoes.routerModelo || process.env.NEXUS_ROUTER_MODEL || null
    },
    total: resultados.length,
    contratosOk: resultados.filter((item) => item.contratoOk).length,
    execucoesOk: resultados.filter((item) => item.execucaoOk).length,
    resultados
  };
  fs.writeFileSync(caminho, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  return caminho;
}

async function main() {
  const opcoes = lerOpcoes(process.argv.slice(2));
  const casos = carregarCasos(opcoes);
  if (!casos.length) throw new Error('Nenhum caso corresponde aos filtros informados.');

  const resultados = [];
  for (const caso of casos) {
    const resultado = await executarCaso(caso, opcoes);
    resultados.push(resultado);
    const contrato = resultado.contratoOk ? 'OK' : `FALHA (${resultado.perfilObtido})`;
    const execucao = opcoes.executar
      ? resultado.execucaoOk ? ' | resposta OK' : ` | ERRO: ${resultado.erro || resultado.problemasAutomaticos}`
      : '';
    console.log(`${caso.id}: contrato ${contrato}${execucao}`);
  }

  const falhasContrato = resultados.filter((item) => !item.contratoOk);
  if (opcoes.executar) {
    const caminho = salvarRelatorio(resultados, opcoes);
    console.log(`Relatorio salvo em ${path.relative(RAIZ, caminho)}.`);
  }
  console.log(`${resultados.length - falhasContrato.length}/${resultados.length} contratos corretos.`);
  if (falhasContrato.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  carregarCasos,
  executarCaso,
  lerOpcoes,
  perguntaParaRoteamento,
  validarResposta
};
