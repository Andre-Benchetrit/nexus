const { citar, flagBooleano, texto } = require('../core/util');

module.exports = {
  nome: 'dim_funcionario',
  tipo: 'dimensao',
  descricao: 'Pessoas de todas as empresas marcadas como funcionario ou vendedor no cadastro de clientes.',
  versaoContrato: 1,
  chavePrimaria: 'id_funcionario',
  preservaTotalEntrada: false,
  fontePrincipal: 'cliente',
  fontesBronze: ['cliente'],
  colunas: [
    'id_funcionario',
    'funcionario',
    'funcionario_razao_social',
    'funcionario_fantasia',
    'id_empresa',
    'tipo_pessoa',
    'id_funcao',
    'funcionario_ativo',
    'dt_cadastro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_funcionario', 'funcionario', 'id_empresa', 'id_funcao', 'funcionario_ativo'
    ],
    colunasAgente: [
      'id_funcionario', 'funcionario', 'funcionario_razao_social',
      'funcionario_fantasia', 'id_empresa', 'tipo_pessoa', 'id_funcao',
      'funcionario_ativo', 'dt_cadastro', 'dt_alteracao'
    ]
  },

  construirSql(contextosBronze) {
    const clientes = citar(contextosBronze.get('cliente').viewAtual);
    return `
      SELECT
        c.id_cliente AS id_funcionario,
        coalesce(${texto('c.fantasia')}, ${texto('c.razsocial')}) AS funcionario,
        ${texto('c.razsocial')} AS funcionario_razao_social,
        ${texto('c.fantasia')} AS funcionario_fantasia,
        c.id_empresa,
        ${texto('c.pessoafj')} AS tipo_pessoa,
        c.id_funcao,
        ${flagBooleano('c.ativo')} AS funcionario_ativo,
        c.dt_cadastro,
        c.dt_alteracao,
        'postgres.sysemp.cliente' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${clientes} c
      WHERE ${flagBooleano('c.funcionario_vend')}
    `;
  }
};
