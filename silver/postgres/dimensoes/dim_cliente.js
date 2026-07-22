const { citar, flagBooleano, texto } = require('../core/util');

module.exports = {
  nome: 'dim_cliente',
  tipo: 'dimensao',
  descricao: 'Cadastro atual de clientes com apenas atributos seguros para analise.',
  versaoContrato: 1,
  chavePrimaria: 'id_cliente',
  fontePrincipal: 'cliente',
  fontesBronze: ['cliente'],
  colunas: [
    'id_cliente',
    'cliente',
    'cliente_razao_social',
    'cliente_fantasia',
    'id_empresa',
    'tipo_pessoa',
    'cliente_cidade',
    'id_uf',
    'cliente_ativo',
    'dt_cadastro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_cliente', 'cliente', 'cliente_cidade', 'cliente_ativo'
    ],
    colunasAgente: [
      'id_cliente', 'cliente', 'cliente_razao_social', 'cliente_fantasia',
      'id_empresa', 'tipo_pessoa', 'cliente_cidade', 'id_uf',
      'cliente_ativo', 'dt_cadastro', 'dt_alteracao'
    ]
  },

  construirSql(contextosBronze) {
    const clientes = citar(contextosBronze.get('cliente').viewAtual);
    return `
      SELECT
        c.id_cliente,
        coalesce(${texto('c.fantasia')}, ${texto('c.razsocial')}) AS cliente,
        ${texto('c.razsocial')} AS cliente_razao_social,
        ${texto('c.fantasia')} AS cliente_fantasia,
        c.id_empresa,
        ${texto('c.pessoafj')} AS tipo_pessoa,
        ${texto('c.cidade')} AS cliente_cidade,
        c.id_uf,
        ${flagBooleano('c.ativo')} AS cliente_ativo,
        c.dt_cadastro,
        c.dt_alteracao,
        'postgres.sysemp.cliente' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${clientes} c
    `;
  }
};
