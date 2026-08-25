#!/usr/bin/env node

const path = require('node:path');
const { executarPipeline } = require('../pipeline/executar');
const { lerEstado, lerUltimaExecucao } = require('../pipeline/controle');
const { resolverRaizLake } = require('../nexus/lake_storage');

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

function resumirExecucao(execucao) {
  if (!execucao) return null;
  const contar = (status) => (execucao.etapas || []).filter(
    (item) => item.status === status
  ).length;
  return {
    id: execucao.id,
    status: execucao.status,
    modo: execucao.modo,
    iniciadoEm: execucao.iniciadoEm,
    finalizadoEm: execucao.finalizadoEm,
    duracaoMs: execucao.duracaoMs,
    etapas: {
      sucesso: contar('sucesso'),
      ignoradas: contar('ignorada'),
      erros: contar('erro'),
      bloqueadas: contar('bloqueada')
    },
    falhas: execucao.falhas || [],
    bloqueios: execucao.bloqueios || []
  };
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const raizLake = resolverRaizLake();
  if (opcoes.status) {
    const [estado, ultimaExecucao] = await Promise.all([
      lerEstado(raizLake),
      lerUltimaExecucao(raizLake)
    ]);
    console.log(JSON.stringify({
      estado,
      resumoUltimaExecucao: resumirExecucao(ultimaExecucao),
      ultimaExecucao
    }, null, 2));
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
      ignoradas: resultado.execucao.etapas.filter((item) => item.status === 'ignorada').length,
      erros: resultado.execucao.etapas.filter((item) => item.status === 'erro').length,
      bloqueadas: resultado.execucao.etapas.filter((item) => item.status === 'bloqueada').length
    }
  }, null, 2));
  if (resultado.execucao.status === 'parcial') process.exitCode = 2;
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Falha na atualizacao do lake: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = { lerArgumentos, resumirExecucao, resumirPlano };
