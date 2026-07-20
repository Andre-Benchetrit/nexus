const { citar, texto } = require('./util');

function criarDimensaoClassificacao({ nome, entidade, chave, colunaNome }) {
  return {
    nome,
    tipo: 'dimensao',
    descricao: `Cadastro atual de ${colunaNome}s para classificacao de produtos.`,
    versaoContrato: 1,
    chavePrimaria: chave,
    fontePrincipal: entidade,
    fontesBronze: [entidade],
    colunas: [
      chave,
      colunaNome,
      'dt_registro',
      'dt_alteracao',
      'fonte_sistema',
      'processado_em'
    ],
    consulta: {
      habilitadaParaAgente: true,
      colunasPadrao: [chave, colunaNome],
      colunasAgente: [chave, colunaNome, 'dt_registro', 'dt_alteracao']
    },

    construirSql(contextosBronze) {
      const origem = citar(contextosBronze.get(entidade).viewAtual);
      return `
        SELECT
          o.${chave},
          ${texto('o.descricao')} AS ${colunaNome},
          o.dt_registro,
          coalesce(o.datamodificacaoserver, o.datamodificacao, o.dthr_atualizacao)
            AS dt_alteracao,
          'postgres.sysemp.${entidade}' AS fonte_sistema,
          CAST(current_timestamp AS TIMESTAMP) AS processado_em
        FROM ${origem} o
      `;
    }
  };
}

module.exports = { criarDimensaoClassificacao };
