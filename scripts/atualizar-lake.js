#!/usr/bin/env node

const path = require('node:path');
const { executarPipeline } = require('../pipeline/executar');
const { lerEstado, lerUltimaExecucao } = require('../pipeline/controle');

function lerArgumentos(argumentos) {
  const opcoes = {};
  const comValor = new Map([
    ['--inicio', 'inicio'],
    ['--fim', 'fim'],
    ['--camadas', 'camadas'],
    ['--entidades', 'entidades'],
    ['--silver', 'objetosSilver'],
    ['--gold', 'objetosGold'],
    ['--sobreposicao-dias', 'sobreposicaoDias']
  ]);
  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
    if (argumento === '--dry-run') opcoes.dryRun = true;
    else if (argumento === '--incluir-hoje') opcoes.incluirHoje = true;
    else if (argumento === '--forcar') opcoes.forcar = true;
    else if (argumento === '--status') opcoes.status = true;
    else {
      const destino = comValor.get(argumento);
      if (!destino) throw new Error(`Opcao desconhecida: ${argumento}`);
      const valor = argumentos[++indice];
      if (!valor) throw new Error(`${argumento} exige um valor.`);
      opcoes[destino] = argumento === '--sobreposicao-dias' ? Number(valor) : valor;
    }
  }
  return opcoes;
}

function resumirPlano(plano) {
  return {
    modo: plano.modo,
    hoje: plano.hoje,
    janelaPadrao: plano.janelaPadrao,
    sobreposicaoDias: plano.sobreposicaoDias,
    etapas: Object.fromEntries(Object.entries(plano.etapas).map(([camada, etapas]) => [
      camada,
      etapas.map(({ nome, acao, inicio, fim, motivo }) => ({
        nome, acao, inicio, fim, motivo
      }))
    ]))
  };
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const raizLake = path.resolve(__dirname, '..', 'lake');
  if (opcoes.status) {
    const [estado, ultimaExecucao] = await Promise.all([
      lerEstado(raizLake),
      lerUltimaExecucao(raizLake)
    ]);
    console.log(JSON.stringify({ estado, ultimaExecucao }, null, 2));
    return;
  }

  const resultado = await executarPipeline({
    ...opcoes,
    raizLake,
    onEvento: (mensagem) => console.error(`[pipeline] ${mensagem}`)
  });
  if (opcoes.dryRun) {
    console.log(JSON.stringify(resumirPlano(resultado.plano), null, 2));
    return;
  }
  console.log(JSON.stringify({
    id: resultado.execucao.id,
    status: resultado.execucao.status,
    modo: resultado.execucao.modo,
    duracaoMs: resultado.execucao.duracaoMs,
    etapas: {
      sucesso: resultado.execucao.etapas.filter((item) => item.status === 'sucesso').length,
      ignoradas: resultado.execucao.etapas.filter((item) => item.status === 'ignorada').length
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Falha na atualizacao do lake: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = { lerArgumentos, resumirPlano };
