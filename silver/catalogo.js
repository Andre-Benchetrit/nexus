const dimCliente = require('./postgres/dim_cliente');
const dimGrupo = require('./postgres/dim_grupo');
const dimSubgrupo = require('./postgres/dim_subgrupo');
const dimMarca = require('./postgres/dim_marca');
const dimCategoria = require('./postgres/dim_categoria');
const dimTipoPedido = require('./postgres/dim_tipo_pedido');
const dimTransporteRegra = require('./postgres/dim_transporte_regra');
const dimPlataformaEcommerce = require('./postgres/dim_plataforma_ecommerce');
const dimProduto = require('./postgres/dim_produto');
const fatoVenda = require('./postgres/fato_venda');
const fatoVendaItem = require('./postgres/fato_venda_item');

const objetos = {
  dim_cliente: dimCliente,
  dim_grupo: dimGrupo,
  dim_subgrupo: dimSubgrupo,
  dim_marca: dimMarca,
  dim_categoria: dimCategoria,
  dim_tipo_pedido: dimTipoPedido,
  dim_transporte_regra: dimTransporteRegra,
  dim_plataforma_ecommerce: dimPlataformaEcommerce,
  dim_produto: dimProduto,
  fato_venda: fatoVenda,
  fato_venda_item: fatoVendaItem
};

function obterObjeto(nome) {
  const objeto = objetos[nome];
  if (!objeto) {
    throw new Error(`Objeto Silver nao encontrado: ${nome}. Disponiveis: ${Object.keys(objetos).join(', ')}`);
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
    if (visitando.has(nome)) throw new Error(`Dependencia circular no Silver envolvendo ${nome}.`);
    const objeto = obterObjeto(nome);
    visitando.add(nome);
    for (const dependencia of objeto.fontesSilver || []) visitar(dependencia);
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
