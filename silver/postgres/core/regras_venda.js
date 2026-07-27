function textoNormalizado(expressao) {
  return `upper(trim(coalesce(${expressao}, '')))`;
}

function documentoPedido(alias = 'n') {
  return `${textoNormalizado(`${alias}.tipo_documento`)} = 'PD'`;
}

function documentoFiscal(alias = 'n') {
  return `${textoNormalizado(`${alias}.tipo_documento`)} = 'NF'`;
}

function tipoPedidoCancelado(aliasTipoPedido = 'tp') {
  return `starts_with(${textoNormalizado(`${aliasTipoPedido}.tipo_pedido`)}, 'CANCEL')`;
}

function documentoReverso(alias = 'n') {
  return `contains(trim(coalesce(${alias}.marketplace_pedido, '')), '_')`;
}

function faturamentoValido(aliasNota = 'n', aliasTipoPedido = 'tp') {
  return `(
    coalesce(${aliasNota}.id_nr_nf, 0) > 0
    AND ${aliasNota}.data_emissao IS NOT NULL
    AND trim(coalesce(${aliasNota}.nfe_cstat, '')) = '100'
    AND ${textoNormalizado(`${aliasNota}.tipo_documento`)} <> 'DV'
    AND coalesce(${aliasNota}.id_tp_pedido, 0) <> 4
    AND ${aliasNota}.id_nat_operacao IN (1, 2, 3, 19)
    AND NOT ${tipoPedidoCancelado(aliasTipoPedido)}
    AND NOT ${documentoReverso(aliasNota)}
  )`;
}

function pedidoPago(aliasNota = 'n', aliasTipoPedido = 'tp') {
  return `(
    ${documentoPedido(aliasNota)}
    AND ${aliasNota}.id_tp_pedido IN (1, 3)
    AND ${aliasNota}.id_nat_operacao IN (1, 2, 3, 19)
    AND NOT ${tipoPedidoCancelado(aliasTipoPedido)}
    AND NOT ${documentoReverso(aliasNota)}
  )`;
}

module.exports = {
  documentoFiscal,
  documentoPedido,
  documentoReverso,
  faturamentoValido,
  pedidoPago,
  textoNormalizado,
  tipoPedidoCancelado
};
