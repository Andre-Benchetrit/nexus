const { citar, flagBooleano, texto } = require('../core/util');

module.exports = {
  nome: 'dim_transportadora',
  tipo: 'dimensao',
  descricao: 'Pessoas de todas as empresas marcadas como transportadora no cadastro de clientes.',
  versaoContrato: 1,
  chavePrimaria: 'id_transportadora',
  preservaTotalEntrada: false,
  fontePrincipal: 'cliente',
  fontesBronze: ['cliente'],
  colunas: [
    'id_transportadora',
    'transportadora',
    'transportadora_razao_social',
    'transportadora_fantasia',
    'id_empresa',
    'tipo_pessoa',
    'transportadora_cidade',
    'id_uf',
    'transportadora_ativa',
    'dt_cadastro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_transportadora', 'transportadora', 'id_empresa',
      'transportadora_cidade', 'transportadora_ativa'
    ],
    colunasAgente: [
      'id_transportadora', 'transportadora', 'transportadora_razao_social',
      'transportadora_fantasia', 'id_empresa', 'tipo_pessoa',
      'transportadora_cidade', 'id_uf', 'transportadora_ativa',
      'dt_cadastro', 'dt_alteracao'
    ]
  },

  construirSql(contextosBronze) {
    const clientes = citar(contextosBronze.get('cliente').viewAtual);
    return `
      SELECT
        c.id_cliente AS id_transportadora,
        coalesce(${texto('c.fantasia')}, ${texto('c.razsocial')}) AS transportadora,
        ${texto('c.razsocial')} AS transportadora_razao_social,
        ${texto('c.fantasia')} AS transportadora_fantasia,
        c.id_empresa,
        ${texto('c.pessoafj')} AS tipo_pessoa,
        ${texto('c.cidade')} AS transportadora_cidade,
        c.id_uf,
        ${flagBooleano('c.ativo')} AS transportadora_ativa,
        c.dt_cadastro,
        c.dt_alteracao,
        'postgres.sysemp.cliente' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${clientes} c
      WHERE ${flagBooleano('c.transportadora')}
    `;
  }
};
