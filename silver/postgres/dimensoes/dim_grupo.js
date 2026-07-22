const { criarDimensaoClassificacao } = require('./criar_dimensao_classificacao');

module.exports = criarDimensaoClassificacao({
  nome: 'dim_grupo',
  entidade: 'grupo',
  chave: 'id_grupo',
  colunaNome: 'grupo'
});
