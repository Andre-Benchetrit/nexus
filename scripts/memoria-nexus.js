const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarMemoria } = require('../agentes/memoria');
const { criarServicoMemoriaGovernada } = require('../nexus/memoria_governada');

function lerOpcoes(argumentos) {
  const opcoes = { gatilhos: [] };
  for (let i = 0; i < argumentos.length; i += 1) {
    const atual = argumentos[i];
    if (atual === '--listar') opcoes.acao = 'listar';
    else if (atual === '--listar-curta') opcoes.acao = 'listar-curta';
    else if (atual === '--limpar-curta') opcoes.acao = 'limpar-curta';
    else if (atual === '--lembrar') {
      opcoes.acao = 'lembrar';
      opcoes.conteudo = argumentos[++i];
    } else if (atual === '--esquecer') {
      opcoes.acao = 'esquecer';
      opcoes.id = argumentos[++i];
    } else if (atual === '--categoria') opcoes.categoria = argumentos[++i];
    else if (atual === '--gatilhos') {
      opcoes.gatilhos = String(argumentos[++i] || '').split(',').map((item) => item.trim());
    } else if (atual === '--sessao') opcoes.sessao = argumentos[++i];
    else if (atual === '--principal') opcoes.principal = argumentos[++i];
    else if (atual === '--setor') opcoes.setor = argumentos[++i];
    else throw new Error(`Opcao desconhecida: ${atual}`);
  }
  return opcoes;
}

function imprimir(valor) {
  console.log(JSON.stringify(valor, null, 2));
}

async function main() {
  const opcoes = lerOpcoes(process.argv.slice(2));
  const memoria = criarMemoria({
    sessao: opcoes.sessao,
    principalSlug: opcoes.principal,
    departamentoSlug: opcoes.setor
  });
  if (opcoes.acao === 'listar') return imprimir(await memoria.listarLonga(
    memoria.backend === 'postgres' ? { somenteAplicaveis: true } : undefined
  ));
  if (opcoes.acao === 'listar-curta') return imprimir(await memoria.listarCurta());
  if (opcoes.acao === 'limpar-curta') {
    await memoria.limparCurta();
    return console.log(`Memoria curta da sessao "${memoria.sessao}" limpa.`);
  }
  if (opcoes.acao === 'lembrar') {
    if (memoria.backend === 'postgres') {
      const servico = criarServicoMemoriaGovernada({
        pool: memoria.pool,
        principalSlug: opcoes.principal || memoria.principalSlug,
        departamentoSlug: opcoes.setor || null,
        sessao: memoria.sessao,
        modo: 'propose'
      });
      const oferta = await servico.oferecer({
        eligible: true,
        reasonCode: 'pedido_explicito_cli',
        candidate: {
          type: 'business_knowledge',
          category: opcoes.categoria || 'correcao',
          statement: opcoes.conteudo,
          triggers: opcoes.gatilhos,
          proposedScope: opcoes.setor ? 'department' : 'global',
          confidence: 1,
          evidenceRefs: ['cli:agente_memoria'],
          failurePattern: {},
          successPattern: { origem: 'solicitacao_explicita' },
          riskFlags: []
        }
      }, { processoConcluido: true, preferenciaExplicita: false });
      const confirmacao = await servico.processarRespostaOferta('sim');
      return imprimir({ ...oferta.candidato, status: confirmacao.status });
    }
    return imprimir(await memoria.adicionarConhecimento(opcoes));
  }
  if (opcoes.acao === 'esquecer') {
    if (memoria.backend === 'postgres') {
      throw new Error('No PostgreSQL, revogue pela fila governada com nexus:memory:candidates -- revoke.');
    }
    return imprimir(await memoria.removerConhecimento(opcoes.id));
  }
  throw new Error(
    'Use --listar, --listar-curta, --limpar-curta, --lembrar "texto" ou --esquecer id.'
  );
}

if (require.main === module) {
  try {
    main().catch((erro) => {
      console.error(`Erro: ${erro.message}`);
      process.exitCode = 1;
    });
  } catch (erro) {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  }
}

module.exports = { lerOpcoes };
