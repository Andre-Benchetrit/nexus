#!/usr/bin/env node

const {
  objetos,
  obterObjeto,
  ordenarObjetosPorDependencias
} = require('../gold/catalogo');
const { construirGold } = require('../gold/core/executar');

async function construirObjeto(objeto) {
  console.log(`[${objeto.nome}] Preparando fontes Silver e Gold...`);
  const resultado = await construirGold(objeto);
  console.log(`[${objeto.nome}] Concluido: ${resultado.totalLinhas} linhas.`);
  console.log(resultado.caminhos.parquet);
  console.log('Qualidade:', JSON.stringify(resultado.qualidade, null, 2));
}

async function main() {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes('--listar')) {
    console.log(Object.keys(objetos).join('\n'));
    return;
  }
  if (argumentos.includes('--todos')) {
    for (const objeto of ordenarObjetosPorDependencias()) await construirObjeto(objeto);
    return;
  }
  const nome = argumentos.find((argumento) => !argumento.startsWith('--'));
  if (!nome) throw new Error('Informe o objeto ou use --todos. Exemplo: npm run gold -- kpi_vendas_diario');
  for (const objeto of ordenarObjetosPorDependencias([nome])) await construirObjeto(objeto);
}

main().catch((erro) => {
  console.error(`Falha na construcao Gold: ${erro.message}`);
  process.exitCode = 1;
});
