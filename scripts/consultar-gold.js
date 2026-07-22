#!/usr/bin/env node

const { criarLeitorGold } = require('../duckdb/gold');

function ajuda() {
  console.log(`
Uso:
  npm run consultar:gold -- --listar
  npm run consultar:gold -- painel_executivo_diario --schema
  npm run consultar:gold -- painel_executivo_diario --contar
  npm run consultar:gold -- painel_executivo_diario [--filtro campo=valor]
      [--colunas campo1,campo2] [--limite 50]
      [--ordenar campo] [--direcao asc|desc] [--visao atual|historico]
  `);
}

function argumentos(valores) {
  const opcoes = { filtros: {} };
  const posicionais = [];
  for (let indice = 0; indice < valores.length; indice += 1) {
    const atual = valores[indice];
    if (!atual.startsWith('--')) {
      posicionais.push(atual);
      continue;
    }
    const nome = atual.slice(2);
    if (['listar', 'schema', 'contar', 'ajuda'].includes(nome)) {
      opcoes[nome] = true;
      continue;
    }
    const valor = valores[++indice];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`A opcao --${nome} exige um valor.`);
    if (nome === 'filtro') {
      const separador = valor.indexOf('=');
      if (separador < 1) throw new Error('--filtro deve usar campo=valor.');
      opcoes.filtros[valor.slice(0, separador)] = valor.slice(separador + 1);
    } else opcoes[nome] = valor;
  }
  opcoes.objeto = posicionais[0];
  return opcoes;
}

function imprimir(valor) {
  console.log(JSON.stringify(valor, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2));
}

async function main() {
  const opcoes = argumentos(process.argv.slice(2));
  if (opcoes.ajuda) return ajuda();
  const leitor = criarLeitorGold();
  try {
    if (opcoes.listar) return imprimir(await leitor.listarObjetos());
    if (!opcoes.objeto) {
      ajuda();
      throw new Error('Informe um objeto Gold ou use --listar.');
    }
    if (opcoes.schema) return imprimir(await leitor.descreverObjeto(opcoes.objeto));
    if (opcoes.contar) return imprimir(await leitor.contar(opcoes.objeto, {
      visao: opcoes.visao,
      filtros: opcoes.filtros
    }));
    imprimir(await leitor.consultar(opcoes.objeto, {
      visao: opcoes.visao,
      filtros: opcoes.filtros,
      colunas: opcoes.colunas?.split(',').filter(Boolean),
      limite: opcoes.limite,
      deslocamento: opcoes.deslocamento,
      ordenacao: opcoes.ordenar
        ? { campo: opcoes.ordenar, direcao: opcoes.direcao || 'asc' }
        : undefined
    }));
  } finally {
    await leitor.fechar();
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
