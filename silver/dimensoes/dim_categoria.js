const { criarDimensaoClassificacao } = require('../postgres/criar_dimensao_classificacao');

module.exports = criarDimensaoClassificacao({
  nome: 'dim_categoria',
  entidade: 'categoria',
  chave: 'id_categoria',
  colunaNome: 'categoria'
});
