const notaSaida = require('./postgres/entidades/nota_saida');
const cliente = require('./postgres/entidades/cliente');

const entidades = {
  nota_saida: notaSaida,
  cliente: cliente
};

function obterEntidade(nome) {
  const entidade = entidades[nome];
  if (!entidade) {
    throw new Error(`Entidade não encontrada: ${nome}. Disponíveis: ${Object.keys(entidades).join(', ')}`);
  }
  return entidade;
}

module.exports = { entidades, obterEntidade };
