const { citar, flagBooleano, texto } = require('./util');

module.exports = {
  nome: 'dim_transporte_regra',
  tipo: 'dimensao',
  descricao: 'Regras de transporte e seus criterios de aplicacao.',
  versaoContrato: 1,
  chavePrimaria: 'id_transporte',
  fontePrincipal: 'transporte_regras',
  fontesBronze: ['transporte_regras'],
  colunas: [
    'id_transporte',
    'transporte_regra',
    'id_transportadora',
    'nome_site_transporte',
    'id_empresa',
    'empresas',
    'id_servico',
    'plataformas',
    'serie',
    'uf',
    'cidade',
    'cep_inicial',
    'cep_final',
    'peso_de',
    'peso_ate',
    'regra_cepuf',
    'frete_padrao',
    'regra_exata',
    'id_atendimento',
    'canal',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_transporte', 'transporte_regra', 'id_transportadora',
      'id_empresa', 'plataformas', 'serie', 'uf'
    ],
    colunasAgente: [
      'id_transporte', 'transporte_regra', 'id_transportadora',
      'nome_site_transporte', 'id_empresa', 'empresas', 'id_servico',
      'plataformas', 'serie', 'uf', 'cidade', 'cep_inicial', 'cep_final',
      'peso_de', 'peso_ate', 'regra_cepuf', 'frete_padrao', 'regra_exata',
      'id_atendimento', 'canal'
    ]
  },

  construirSql(contextosBronze) {
    const regras = citar(contextosBronze.get('transporte_regras').viewAtual);
    return `
      SELECT
        tr.id_transporte,
        ${texto('tr.descricao')} AS transporte_regra,
        tr.id_transportadora,
        ${texto('tr.nome_site')} AS nome_site_transporte,
        tr.id_empresa,
        ${texto('tr.empresas')} AS empresas,
        tr.id_servico,
        ${texto('tr.plataformas')} AS plataformas,
        ${texto('tr.serie')} AS serie,
        ${texto('tr.uf')} AS uf,
        ${texto('tr.cidade')} AS cidade,
        ${texto('tr.cep_inicial')} AS cep_inicial,
        ${texto('tr.cep_final')} AS cep_final,
        tr.peso_de,
        tr.peso_ate,
        tr.regra_cepuf,
        (coalesce(tr.frete_padrao, 0) <> 0) AS frete_padrao,
        ${flagBooleano('tr.exato')} AS regra_exata,
        tr.id_atendimento,
        ${texto('tr.canal')} AS canal,
        'postgres.sysemp.transporte_regras' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${regras} tr
    `;
  }
};
