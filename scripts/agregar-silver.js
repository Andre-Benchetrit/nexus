#!/usr/bin/env node

const { criarLeitorSilver } = require('../duckdb/silver');

function mostrarAjuda() {
  console.log(`
Uso:
  npm run agregar:silver -- dim_produto --agrupar grupo --contar
  npm run agregar:silver -- dim_produto --agrupar grupo --contar \
    --filtro produto_ativo=true --limite 10

Opcoes:
  --agrupar campo1,campo2
  --contar
  --somar campo
  --media campo
  --minimo campo
  --maximo campo
  --filtro campo=valor
  --visao atual|historico
  --limite 50
  `);
}

function lerArgumentos(argumentos) {
  const opcoes = { filtros: {}, calculos: [] };
  const nome = argumentos[0]?.startsWith('--') ? undefined : argumentos[0];
  for (let indice = nome ? 1 : 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
    if (argumento === '--ajuda') {
      opcoes.ajuda = true;
    } else if (argumento === '--contar') {
      opcoes.calculos.push({ operacao: 'contar', campo: null });
    } else if (['--somar', '--media', '--minimo', '--maximo'].includes(argumento)) {
      const campo = argumentos[++indice];
      if (!campo || campo.startsWith('--')) throw new Error(`${argumento} exige um campo.`);
      opcoes.calculos.push({ operacao: argumento.slice(2), campo });
    } else {
      const valor = argumentos[++indice];
      if (valor === undefined || valor.startsWith('--')) throw new Error(`${argumento} exige um valor.`);
      if (argumento === '--filtro') {
        const separador = valor.indexOf('=');
        if (separador < 1) throw new Error('--filtro deve usar campo=valor.');
        opcoes.filtros[valor.slice(0, separador)] = valor.slice(separador + 1);
      } else if (argumento === '--agrupar') opcoes.agrupar = valor;
      else if (argumento === '--visao') opcoes.visao = valor;
      else if (argumento === '--limite') opcoes.limite = valor;
      else throw new Error(`Opcao desconhecida: ${argumento}`);
    }
  }
  return { nome, ...opcoes };
}

function imprimir(valor) {
  console.log(JSON.stringify(valor, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2));
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.ajuda) return mostrarAjuda();
  if (!opcoes.nome) {
    mostrarAjuda();
    throw new Error('Informe um objeto Silver.');
  }
  if (!opcoes.calculos.length) throw new Error('Informe ao menos um calculo, como --contar.');
  const agrupamentos = opcoes.agrupar
    ? opcoes.agrupar.split(',').filter(Boolean).map((campo) => ({ campo, granularidade: 'valor' }))
    : [];
  const leitor = criarLeitorSilver();
  try {
    imprimir(await leitor.agregar(opcoes.nome, {
      visao: opcoes.visao,
      agrupamentos,
      calculos: opcoes.calculos,
      filtros: opcoes.filtros,
      limite: opcoes.limite
    }));
  } finally {
    await leitor.fechar();
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
