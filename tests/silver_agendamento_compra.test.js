const test = require('node:test');
const assert = require('node:assert/strict');

const fatoAgendamentoCompra = require(
  '../silver/onedrive/fatos/fato_agendamento_compra'
);

test('corrige inversao dia mes somente quando elimina data futura', () => {
  const sql = fatoAgendamentoCompra.construirSql(
    new Map([['agendamento_compra', { viewAtual: 'bronze_agendamento' }]]),
    new Map([['dim_produto', { viewAtual: 'silver_produto' }]])
  );

  assert.ok(fatoAgendamentoCompra.colunas.includes('data_entrada_original'));
  assert.ok(
    fatoAgendamentoCompra.colunas.includes('data_entrada_corrigida_dia_mes')
  );
  assert.match(
    sql,
    /data_entrada_original > data_referencia_fonte::DATE/
  );
  assert.match(
    sql,
    /data_entrada_dia_mes_invertidos <= data_referencia_fonte::DATE/
  );
});
