module.exports = {
  nome: 'plataforma_ecommerce',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'plataforma_ecommerce',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    // A tabela não possui um cursor técnico. Como cada snapshot é completo,
    // a execução mais recente desempata versões da mesma chave no leitor.
    cursor: 'id',
    chavePrimaria: 'id',
    // Nunca usar ['*'] aqui: a origem contém senhas, tokens e segredos de API.
    colunas: [
      'id',
      'plataforma',
      'descricao',
      'apelido',
      'ativo',
      'id_empresa',
      'id_transportadora',
      'plataforma_principal',
      'data_ultimo_pedido',
      'data_ultimo_produto',
      'data_ultimo_estoque',
      'data_ultimo_preco',
      'data_ultimo_status'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id',
      'plataforma',
      'descricao',
      'apelido',
      'ativo',
      'id_empresa',
      'id_transportadora',
      'plataforma_principal'
    ]
  }
};
