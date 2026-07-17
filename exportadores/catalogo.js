const notaSaida = require('./postgres/entidades/nota_saida');
const cliente = require('./postgres/entidades/cliente');
const produto = require('./postgres/entidades/produto');
const grupo = require('./postgres/entidades/grupo');
const subgrupo = require('./postgres/entidades/subgrupo');
const marca = require('./postgres/entidades/marca');
const categoria = require('./postgres/entidades/categoria');
const tipoPedido = require('./postgres/entidades/tipo_pedido');
const transportadora = require('./postgres/entidades/transportadora');
const plataformaEcommerce = require('./postgres/entidades/plataforma_ecommerce');

const entidades = {
  nota_saida: notaSaida,
  cliente: cliente,
  produto: produto,
  grupo: grupo,
  subgrupo: subgrupo,
  marca: marca,
  categoria: categoria,
  tipo_pedido: tipoPedido,
  transportadora: transportadora,
  plataforma_ecommerce: plataformaEcommerce
};

function obterEntidade(nome) {
  const entidade = entidades[nome];
  if (!entidade) {
    throw new Error(`Entidade não encontrada: ${nome}. Disponíveis: ${Object.keys(entidades).join(', ')}`);
  }
  return entidade;
}

function listarEntidadesAgente() {
  return Object.values(entidades)
    .filter((entidade) => entidade.consulta?.habilitadaParaAgente === true)
    .map((entidade) => entidade.nome);
}

module.exports = { entidades, obterEntidade, listarEntidadesAgente };
