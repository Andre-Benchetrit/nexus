#!/usr/bin/env node

const {
  objetos,
  obterObjeto,
  ordenarObjetosPorDependencias
} = require('../silver/catalogo');
const { construirSilver } = require('../silver/core/executar');

async function construirObjeto(objeto) {
  console.log(`[${objeto.nome}] Preparando fontes Bronze e Silver...`);
  const resultado = await construirSilver(objeto);
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
    for (const objeto of ordenarObjetosPorDependencias()) {
      await construirObjeto(objeto);
    }
    return;
  }
  const nome = argumentos.find((argumento) => !argumento.startsWith('--'));
  if (!nome) {
    throw new Error('Informe o objeto ou use --todos. Exemplo: npm run silver -- dim_produto');
  }

  await construirObjeto(obterObjeto(nome));
}

main().catch((erro) => {
  console.error(`Falha na construcao Silver: ${erro.message}`);
  process.exitCode = 1;
});
