module.exports = {
  nome: 'nota_saida_bloqueada',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'nota_saida_bloqueada',
  destino: {
    camada: 'bronze'
  },
  extracao: {
    modo: 'incremental_data',
    cursor: 'dthr_atualizacao',
    cursoresIncrementais: ['dthr_atualizacao', 'data'],
    // A origem remove bloqueios liberados fisicamente. O snapshot leve das
    // chaves atuais impede que essas ocorrencias permane\u00e7am na visao Bronze atual.
    reconciliarExclusoes: true,
    // Chave primaria real da origem. id_produto nao identifica a ocorrencia:
    // ha bloqueios legitimos repetidos e muitos registros usam id_produto = 0.
    chavePrimaria: [
      'id_nota_saida',
      'id_bloqueio',
      'id_empresa',
      'id_sequencia'
    ],
    colunas: ['*']
  },
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida',
      'id_bloqueio',
      'id_empresa',
      'id_sequencia',
      'liberado',
      'data',
      'data_lib',
      'dthr_atualizacao',
      'hora_lib',
      'hora_bloqueio',
      'id_produto'
    ]
  }
};
