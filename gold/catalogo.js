const kpiVendasDiario = require('./modelos/vendas/kpi_vendas_diario');
const kpiFaturamentoDiario = require('./modelos/vendas/kpi_faturamento_diario');
const kpiPedidosPagosDiario = require('./modelos/vendas/kpi_pedidos_pagos_diario');
const desempenhoProdutoDiario = require('./modelos/vendas/desempenho_produto_diario');
const kpiPlataformaDiario = require('./modelos/vendas/kpi_plataforma_diario');
const kpiFreteDiario = require('./modelos/vendas/kpi_frete_diario');
const riscoRupturaProduto = require('./modelos/estoque/risco_ruptura_produto');
const kpiEstoqueDiario = require('./modelos/estoque/kpi_estoque_diario');
const painelExecutivoDiario = require('./modelos/executivo/painel_executivo_diario');

const objetos = {
  kpi_vendas_diario: kpiVendasDiario,
  kpi_faturamento_diario: kpiFaturamentoDiario,
  kpi_pedidos_pagos_diario: kpiPedidosPagosDiario,
  desempenho_produto_diario: desempenhoProdutoDiario,
  kpi_plataforma_diario: kpiPlataformaDiario,
  kpi_frete_diario: kpiFreteDiario,
  risco_ruptura_produto: riscoRupturaProduto,
  kpi_estoque_diario: kpiEstoqueDiario,
  painel_executivo_diario: painelExecutivoDiario
};

function obterObjeto(nome) {
  const objeto = objetos[nome];
  if (!objeto) {
    throw new Error(`Objeto Gold nao encontrado: ${nome}. Disponiveis: ${Object.keys(objetos).join(', ')}`);
  }
  return objeto;
}

function listarObjetosAgente() {
  return Object.values(objetos)
    .filter((objeto) => objeto.consulta?.habilitadaParaAgente === true)
    .map((objeto) => objeto.nome);
}

function ordenarObjetosPorDependencias(nomes = Object.keys(objetos)) {
  const ordenados = [];
  const visitando = new Set();
  const visitados = new Set();

  function visitar(nome) {
    if (visitados.has(nome)) return;
    if (visitando.has(nome)) throw new Error(`Dependencia circular no Gold envolvendo ${nome}.`);
    const objeto = obterObjeto(nome);
    visitando.add(nome);
    for (const dependencia of objeto.fontesGold || []) visitar(dependencia);
    visitando.delete(nome);
    visitados.add(nome);
    ordenados.push(objeto);
  }

  for (const nome of nomes) visitar(nome);
  return ordenados;
}

module.exports = {
  objetos,
  obterObjeto,
  listarObjetosAgente,
  ordenarObjetosPorDependencias
};
