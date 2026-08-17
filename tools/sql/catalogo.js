const ENTIDADES_SQL = Object.freeze({
  nota_saida: {
    tabela: 'nota_saida', alias: 'ns', dominio: ['pedidos', 'vendas', 'faturamento', 'notas', 'frete', 'operacao'],
    campos: {
      id_nota_saida: 'bigint', id_pedido_vda_importado: 'bigint', id_nr_nf: 'bigint',
      id_empresa: 'bigint', id_cliente: 'bigint', id_tp_pedido: 'bigint',
      id_plataforma: 'bigint', id_transportadora: 'bigint', id_regra_transporte: 'bigint',
      id_nat_operacao: 'bigint', marketplace_pedido: 'text', data_pedido: 'date',
      data_emissao: 'date', situacao: 'text', total_nota_fiscal: 'numeric',
      valor_frete: 'numeric', valor_frete_custo: 'numeric', entrega_uf: 'text',
      bloqueada: 'text', nf_cancelada: 'text', nfe_cstat: 'text', tipo_documento: 'text'
    }
  },
  nota_saida_itens: {
    tabela: 'nota_saida_itens', alias: 'nsi', dominio: ['vendas', 'produtos'],
    campos: {
      id_nota_saida: 'bigint', item: 'integer', id_empresa: 'bigint', id_produto: 'bigint',
      qtde: 'numeric', qtde_faturada: 'numeric', qtde_devolvida: 'numeric',
      valor_bruto: 'numeric', valor_liquido: 'numeric', valor_total_liquido: 'numeric',
      custo_produto: 'numeric', vr_frete: 'numeric', data_emissao: 'date'
    }
  },
  produto: {
    tabela: 'produto', alias: 'p', dominio: ['produtos', 'catalogo'],
    campos: {
      id_produto: 'bigint', descricao: 'text', codigo_auxiliar: 'text', cod_barra: 'text',
      cod_fabrica: 'text', id_grupo: 'bigint', id_subgrupo: 'bigint', id_marca: 'bigint',
      id_categoria: 'bigint', estoque: 'numeric', inativo: 'text', disponivel: 'text',
      envia_site: 'text', dt_cadastro: 'date', dt_alteracao: 'timestamp',
      composicao_estoque: 'integer', volumes: 'integer'
    }
  },
  tipo_produto: {
    tabela: 'tipo_produto', alias: 'tprod', dominio: ['produtos', 'catalogo'],
    campos: { id_tp_produto: 'integer', descricao: 'text' }
  },
  produto_inventario: {
    tabela: 'produto_inventario', alias: 'pi', dominio: ['estoque'],
    campos: {
      id_sequencia: 'bigint', id_produto: 'bigint', id_empresa: 'bigint', estoque: 'numeric',
      qtde_reserva: 'numeric', estoque_minimo: 'numeric', estoque_maximo: 'numeric',
      estoque_seguranca: 'numeric', dthr_atualizacao: 'timestamp'
    }
  },
  log_estoque: {
    tabela: 'log_estoque', alias: 'le', dominio: ['movimentacoes', 'estoque'],
    campos: {
      id_sequencia: 'bigint', data_hora: 'timestamp', id_produto: 'bigint',
      id_empresa: 'bigint', dc: 'text', origem: 'text', qtde: 'numeric', estoque: 'numeric'
    }
  },
  nota_saida_bloqueada: {
    tabela: 'nota_saida_bloqueada', alias: 'nsb', dominio: ['bloqueios'],
    campos: {
      id_nota_saida: 'bigint', id_bloqueio: 'bigint', id_empresa: 'bigint',
      id_sequencia: 'bigint', id_produto: 'bigint', liberado: 'boolean', data: 'date',
      data_lib: 'date', dthr_atualizacao: 'timestamp', hora_bloqueio: 'time'
    }
  },
  cliente: {
    tabela: 'cliente', alias: 'c', dominio: ['pessoas', 'vendas'],
    campos: {
      id_cliente: 'bigint', razsocial: 'text', fantasia: 'text', id_empresa: 'bigint',
      cidade: 'text', id_uf: 'bigint', ativo: 'text', funcionario_vend: 'text',
      transportadora: 'text', id_funcao: 'bigint'
    }
  },
  tipo_pedido: {
    tabela: 'tipo_pedido', alias: 'tp', dominio: ['pedidos', 'vendas'],
    campos: {
      id_tp_pedido: 'bigint', descricao: 'text', tipo: 'text', permite_faturamento: 'text',
      bloqueado: 'text', id_nat_operacao: 'bigint'
    }
  },
  plataforma_ecommerce: {
    tabela: 'plataforma_ecommerce', alias: 'pe', dominio: ['vendas', 'operacao'],
    campos: { id: 'bigint', plataforma: 'text', descricao: 'text', apelido: 'text', ativo: 'text', id_empresa: 'bigint' }
  },
  bloqueios: {
    tabela: 'bloqueios', alias: 'b', dominio: ['bloqueios'],
    campos: { id_bloqueio: 'bigint', descricao: 'text' }
  },
  transporte_regras: {
    tabela: 'transporte_regras', alias: 'tr', dominio: ['frete'],
    campos: { id_transporte: 'bigint', descricao: 'text', id_transportadora: 'bigint', id_empresa: 'bigint', plataformas: 'text', uf: 'text' }
  }
});

const RELACIONAMENTOS_SQL = Object.freeze([
  { id: 'nota_itens', esquerda: 'nota_saida', direita: 'nota_saida_itens', on: [['id_nota_saida', 'id_nota_saida']], cardinalidade: 'um_para_muitos' },
  { id: 'item_produto', esquerda: 'nota_saida_itens', direita: 'produto', on: [['id_produto', 'id_produto']], cardinalidade: 'muitos_para_um' },
  { id: 'produto_tipo', esquerda: 'produto', direita: 'tipo_produto', on: [['composicao_estoque', 'id_tp_produto']], cardinalidade: 'muitos_para_um', tipoJoin: 'inner' },
  { id: 'inventario_produto', esquerda: 'produto_inventario', direita: 'produto', on: [['id_produto', 'id_produto']], cardinalidade: 'muitos_para_um' },
  { id: 'movimento_produto', esquerda: 'log_estoque', direita: 'produto', on: [['id_produto', 'id_produto']], cardinalidade: 'muitos_para_um' },
  { id: 'nota_bloqueio', esquerda: 'nota_saida', direita: 'nota_saida_bloqueada', on: [['id_nota_saida', 'id_nota_saida']], cardinalidade: 'um_para_muitos' },
  { id: 'bloqueio_produto', esquerda: 'nota_saida_bloqueada', direita: 'produto', on: [['id_produto', 'id_produto']], cardinalidade: 'muitos_para_um' },
  { id: 'descricao_bloqueio', esquerda: 'nota_saida_bloqueada', direita: 'bloqueios', on: [['id_bloqueio', 'id_bloqueio']], cardinalidade: 'muitos_para_um' },
  { id: 'nota_cliente', esquerda: 'nota_saida', direita: 'cliente', on: [['id_cliente', 'id_cliente']], cardinalidade: 'muitos_para_um' },
  { id: 'nota_tipo', esquerda: 'nota_saida', direita: 'tipo_pedido', on: [['id_tp_pedido', 'id_tp_pedido']], cardinalidade: 'muitos_para_um' },
  { id: 'nota_plataforma', esquerda: 'nota_saida', direita: 'plataforma_ecommerce', on: [['id_plataforma', 'id']], cardinalidade: 'muitos_para_um' },
  { id: 'nota_transporte', esquerda: 'nota_saida', direita: 'transporte_regras', on: [['id_regra_transporte', 'id_transporte']], cardinalidade: 'muitos_para_um' }
]);

const CAMPOS_NEGOCIO = Object.freeze({
  marketplace_pedido: ['nota_saida', 'marketplace_pedido'],
  id_nota_saida: ['nota_saida', 'id_nota_saida'],
  nota_fiscal: ['nota_saida', 'id_nr_nf'],
  id_empresa: ['nota_saida', 'id_empresa'],
  data_pedido: ['nota_saida', 'data_pedido'],
  data_emissao: ['nota_saida', 'data_emissao'],
  situacao: ['nota_saida', 'situacao'],
  plataforma: ['plataforma_ecommerce', 'descricao'],
  cliente: ['cliente', 'razsocial'],
  tipo_pedido: ['tipo_pedido', 'descricao'],
  id_produto: ['produto', 'id_produto'],
  descricao_produto: ['produto', 'descricao'],
  sku: ['produto', 'codigo_auxiliar'],
  ean: ['produto', 'cod_barra'],
  tipo_produto: ['tipo_produto', 'descricao'],
  composicao_estoque: ['produto', 'composicao_estoque'],
  estoque: ['produto_inventario', 'estoque'],
  qtde_reserva: ['produto_inventario', 'qtde_reserva'],
  data_movimento: ['log_estoque', 'data_hora'],
  bloqueio: ['nota_saida_bloqueada', 'id_bloqueio'],
  descricao_bloqueio: ['bloqueios', 'descricao'],
  data_bloqueio: ['nota_saida_bloqueada', 'data']
});

const CAMPOS_CALCULADOS_SQL = Object.freeze({
  codigo_barra: {
    entidade: 'produto', tipo: 'text', alias: 'codigo_barra',
    expressao: `'''' || p."cod_barra"`
  },
  codigo_fabricante: {
    entidade: 'produto', tipo: 'text', alias: 'codigo_fabricante',
    expressao: `'''' || p."cod_fabrica"`
  },
  volume: {
    entidade: 'produto', tipo: 'numeric', alias: 'volume',
    expressao: 'round(p."volumes")'
  }
});

const REGRA_FATURAMENTO = `(
  coalesce(ns.id_nr_nf, 0) > 0
  AND ns.data_emissao IS NOT NULL
  AND trim(coalesce(ns.nfe_cstat, '')) = '100'
  AND upper(trim(coalesce(ns.tipo_documento, ''))) <> 'DV'
  AND coalesce(ns.id_tp_pedido, 0) <> 4
  AND ns.id_nat_operacao IN (1, 2, 3, 19)
  AND upper(trim(coalesce(tp.descricao, ''))) NOT LIKE 'CANCEL%'
  AND position('_' in trim(coalesce(ns.marketplace_pedido, ''))) = 0
)`;

const METRICAS_SQL = Object.freeze({
  faturamento: {
    entidade: 'nota_saida', expressao: 'sum(ns.total_nota_fiscal)', tipo: 'numeric',
    entidadesNecessarias: ['tipo_pedido'], regras: [REGRA_FATURAMENTO],
    periodoObrigatorio: true,
    descricao: 'Faturamento fiscal valido conforme as regras oficiais do Nexus.'
  },
  faturamento_itens: {
    entidade: 'nota_saida_itens',
    expressao: 'sum(coalesce(nsi.valor_total_liquido, nsi.valor_liquido * nsi.qtde))',
    alias: 'faturamento', tipo: 'numeric',
    entidadesNecessarias: ['nota_saida', 'tipo_pedido'], regras: [REGRA_FATURAMENTO],
    periodoObrigatorio: true,
    descricao: 'Faturamento fiscal valido distribuido no grao dos itens da nota.'
  },
  valor_total_notas: {
    entidade: 'nota_saida', expressao: 'sum(ns.total_nota_fiscal)', tipo: 'numeric',
    entidadesNecessarias: [], regras: [], descricao: 'Soma bruta das notas, inclusive canceladas.'
  },
  quantidade_pedidos: {
    entidade: 'nota_saida', expressao: 'count(DISTINCT ns.id_nota_saida)', tipo: 'bigint',
    entidadesNecessarias: [], regras: [], descricao: 'Quantidade distinta de pedidos/notas.'
  },
  quantidade_itens: {
    entidade: 'nota_saida_itens', expressao: 'sum(nsi.qtde)', tipo: 'numeric',
    entidadesNecessarias: [], regras: [], descricao: 'Quantidade total de itens.'
  },
  valor_total_itens: {
    entidade: 'nota_saida_itens',
    expressao: 'sum(coalesce(nsi.valor_total_liquido, nsi.valor_liquido * nsi.qtde))',
    tipo: 'numeric', entidadesNecessarias: [], regras: [], descricao: 'Valor liquido total dos itens.'
  },
  estoque_disponivel: {
    entidade: 'produto_inventario', expressao: 'sum(pi.estoque - coalesce(pi.qtde_reserva, 0))',
    tipo: 'numeric', entidadesNecessarias: [], regras: [], descricao: 'Estoque atual menos reservas.'
  },
  quantidade_bloqueios: {
    entidade: 'nota_saida_bloqueada', expressao: 'count(*)', tipo: 'bigint',
    entidadesNecessarias: [], regras: [], descricao: 'Quantidade de ocorrencias de bloqueio.'
  },
  quantidade_movimentada: {
    entidade: 'log_estoque', expressao: "sum(CASE WHEN upper(trim(le.dc)) = 'D' THEN -le.qtde ELSE le.qtde END)",
    tipo: 'numeric', entidadesNecessarias: [], regras: [], descricao: 'Saldo quantitativo das movimentacoes.'
  }
});

const REGRAS_SQL = Object.freeze({
  produto_ativo_vendavel: {
    entidadesNecessarias: ['produto'],
    expressao: `(p."composicao_estoque" IN (0, 6, 50) AND p."inativo" = 'F')`,
    descricao: 'Somente produtos ativos com composição de estoque 0, 6 ou 50, incluindo kits.'
  },
  sku_sem_sufixo_variacao: {
    entidadesNecessarias: ['produto'],
    expressao: `(p."codigo_auxiliar" !~ '(_[0-9]+|_OUT)$')`,
    descricao: 'Exclui SKUs terminados em _<número> ou _OUT.'
  }
});

function obterEntidadeSql(nome) { return ENTIDADES_SQL[nome] || null; }
function obterMetricaSql(nome) { return METRICAS_SQL[nome] || null; }

module.exports = {
  CAMPOS_CALCULADOS_SQL,
  CAMPOS_NEGOCIO,
  ENTIDADES_SQL,
  METRICAS_SQL,
  REGRAS_SQL,
  RELACIONAMENTOS_SQL,
  obterEntidadeSql,
  obterMetricaSql
};
