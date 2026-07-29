module.exports = {
  nome: 'agendamento_compra',
  fonte: 'onedrive',
  destino: {
    camada: 'bronze'
  },
  automacao: {
    habilitada: true
  },
  extracao: {
    modo: 'arquivo_versionado',
    estrategiaVisaoAtual: 'ultima_execucao',
    conexao: 'automacoes_onedrive',
    itemIdEnv: 'ONEDRIVE_AGENDAMENTO_COMPRA_ITEM_ID',
    planilha: 'BASE',
    linhaCabecalho: 1,
    tamanhoMaximoMb: 100,
    colunas: [
      { origem: 'INDEX', destino: 'id_linha_agendamento' },
      { origem: 'PEDIDO', destino: 'numero_pedido_compra' },
      { origem: ['FORNCEDOR', 'FORNECEDOR'], destino: 'fornecedor_anotacao' },
      { origem: 'DATA PREVISTA', destino: 'data_prevista' },
      { origem: 'COD FABRICA', destino: 'codigo_fabrica' },
      { origem: 'ID PRODUTO', destino: 'id_produto_planilha' },
      { origem: 'SKU', destino: 'sku_planilha' },
      { origem: ['DESCRIÇÃO', 'DESCRICAO'], destino: 'descricao_planilha' },
      { origem: 'QTDE', destino: 'quantidade_pedida' },
      { origem: 'CUSTO UNI', destino: 'custo_unitario' },
      { origem: 'TOTAL', destino: 'valor_total' },
      { origem: 'NF de Entrada CNT', destino: 'numero_nf_entrada' },
      { origem: 'QTDE RECEBIDO', destino: 'quantidade_recebida' },
      {
        origem: ['Aferição de Quantidade', 'Afericao de Quantidade'],
        destino: 'afericao_quantidade'
      },
      { origem: 'DATA ENTRADA', destino: 'data_entrada' },
      { origem: 'TOTAL SYSEMP', destino: 'total_sysemp' },
      {
        origem: ['SATUS DE ENTREGA', 'STATUS DE ENTREGA'],
        destino: 'status_entrega_anotacao'
      }
    ]
  },
  consulta: {
    habilitadaParaAgente: false
  }
};
