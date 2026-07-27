const { criarMemoria } = require('../agentes/memoria');

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
    else throw new Error(`Opcao desconhecida: ${atual}`);
  }
  return opcoes;
}

function imprimir(valor) {
  console.log(JSON.stringify(valor, null, 2));
}

function main() {
  const opcoes = lerOpcoes(process.argv.slice(2));
  const memoria = criarMemoria({ sessao: opcoes.sessao });
  if (opcoes.acao === 'listar') return imprimir(memoria.listarLonga());
  if (opcoes.acao === 'listar-curta') return imprimir(memoria.listarCurta());
  if (opcoes.acao === 'limpar-curta') {
    memoria.limparCurta();
    return console.log(`Memoria curta da sessao "${memoria.sessao}" limpa.`);
  }
  if (opcoes.acao === 'lembrar') {
    return imprimir(memoria.adicionarConhecimento(opcoes));
  }
  if (opcoes.acao === 'esquecer') {
    return imprimir(memoria.removerConhecimento(opcoes.id));
  }
  throw new Error(
    'Use --listar, --listar-curta, --limpar-curta, --lembrar "texto" ou --esquecer id.'
  );
}

if (require.main === module) {
  try {
    main();
  } catch (erro) {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  }
}

module.exports = { lerOpcoes };
