const dimCliente = require('./postgres/dimensoes/dim_cliente');
const dimGrupo = require('./postgres/dimensoes/dim_grupo');
const dimSubgrupo = require('./postgres/dimensoes/dim_subgrupo');
const dimMarca = require('./postgres/dimensoes/dim_marca');
const dimCategoria = require('./postgres/dimensoes/dim_categoria');
const dimTipoPedido = require('./postgres/dimensoes/dim_tipo_pedido');
const dimTransporteRegra = require('./postgres/dimensoes/dim_transporte_regra');
const dimPlataformaEcommerce = require('./postgres/dimensoes/dim_plataforma_ecommerce');
const dimProduto = require('./postgres/dimensoes/dim_produto');
const fatoVenda = require('./postgres/fatos/fato_venda');
const fatoVendaItem = require('./postgres/fatos/fato_venda_item');

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
