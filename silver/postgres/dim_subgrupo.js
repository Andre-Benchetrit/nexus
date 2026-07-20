const { criarDimensaoClassificacao } = require('./criar_dimensao_classificacao');

module.exports = criarDimensaoClassificacao({
  nome: 'dim_subgrupo',
  entidade: 'subgrupo',
  chave: 'id_subgrupo',
  colunaNome: 'subgrupo'
});
