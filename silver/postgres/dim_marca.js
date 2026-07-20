const { criarDimensaoClassificacao } = require('./criar_dimensao_classificacao');

module.exports = criarDimensaoClassificacao({
  nome: 'dim_marca',
  entidade: 'marca',
  chave: 'id_marca',
  colunaNome: 'marca'
});
