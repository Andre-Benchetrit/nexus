module.exports = {
  nome: 'transporte_regras',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'transporte_regras',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    // A origem nao possui timestamp tecnico; o snapshot completo e pequeno.
    cursor: 'id_transporte',
    chavePrimaria: 'id_transporte',
    colunas: [
      'id_transporte',
      'descricao',
      'id_transportadora',
      'nome_site',
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
      'exato',
      'id_atendimento',
      'canal'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_transporte',
      'descricao',
      'id_transportadora',
      'id_empresa',
      'plataformas',
      'serie',
      'uf'
    ]
  }
};
