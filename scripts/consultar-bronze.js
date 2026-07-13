#!/usr/bin/env node

const { criarLeitorBronze } = require('../duckdb/bronze');

function mostrarAjuda() {
  console.log(`
Uso:
  npm run consultar -- --listar
  npm run consultar -- cliente --schema
  npm run consultar -- cliente --contar [--visao atual|historico]
  npm run consultar -- cliente [--id 123] [--filtro campo=valor]
                           [--colunas campo1,campo2] [--limite 50]
                           [--visao atual|historico]
  `);
}

function lerArgumentos(argumentos) {
  const opcoes = { filtros: {} };
  const posicionais = [];

  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
    if (!argumento.startsWith('--')) {
      posicionais.push(argumento);
      continue;
    }

    const nome = argumento.slice(2);
    if (['listar', 'schema', 'contar', 'ajuda'].includes(nome)) {
      opcoes[nome] = true;
      continue;
    }

    const valor = argumentos[indice + 1];
    if (valor === undefined || valor.startsWith('--')) {
      throw new Error(`A opção --${nome} exige um valor.`);
    }
    indice += 1;

    if (nome === 'filtro') {
      const separador = valor.indexOf('=');
      if (separador < 1) throw new Error('--filtro deve usar o formato campo=valor.');
      opcoes.filtros[valor.slice(0, separador)] = valor.slice(separador + 1);
    } else {
      opcoes[nome] = valor;
    }
  }

  opcoes.entidade = posicionais[0];
  return opcoes;
}

function imprimirJson(valor) {
  console.log(JSON.stringify(valor, (_, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ), 2));
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.ajuda) {
    mostrarAjuda();
    return;
  }

  const leitor = criarLeitorBronze();
  try {
    if (opcoes.listar) {
      imprimirJson(await leitor.listarEntidades());
      return;
    }
    if (!opcoes.entidade) {
      mostrarAjuda();
      throw new Error('Informe uma entidade ou use --listar.');
    }
    if (opcoes.schema) {
      imprimirJson(await leitor.descreverEntidade(opcoes.entidade));
      return;
    }
    if (opcoes.contar) {
      imprimirJson(await leitor.contar(opcoes.entidade, {
        visao: opcoes.visao,
        filtros: opcoes.filtros
      }));
      return;
    }

    const consulta = {
      visao: opcoes.visao,
      limite: opcoes.limite,
      colunas: opcoes.colunas ? opcoes.colunas.split(',').filter(Boolean) : undefined,
      filtros: opcoes.filtros
    };
    const resultado = opcoes.id === undefined
      ? await leitor.consultar(opcoes.entidade, consulta)
      : await leitor.buscarPorId(opcoes.entidade, opcoes.id, consulta);
    imprimirJson(resultado);
  } finally {
    await leitor.fechar();
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
