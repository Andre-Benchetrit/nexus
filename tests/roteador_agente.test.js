const test = require('node:test');
const assert = require('node:assert/strict');

const { classificarPergunta, resolverPerfil } = require('../agentes/roteador');

test('roteia vendas, catalogo e auditoria sem usar modelo', () => {
  assert.equal(classificarPergunta('Compare o faturamento deste mês com o anterior'), 'indicadores');
  assert.equal(classificarPergunta('Quantos pedidos estão pendentes?'), 'indicadores');
  assert.equal(classificarPergunta('Qual marca mais vendeu hoje?'), 'vendas');
  assert.equal(classificarPergunta('Quanto vendemos para o cliente MMA?'), 'vendas');
  assert.equal(classificarPergunta('Quais foram as ultimas notas?'), 'vendas');
  assert.equal(classificarPergunta('Quais tipos predominam no catálogo?'), 'catalogo');
  assert.equal(classificarPergunta('Quero auditar os dados brutos do Bronze'), 'bronze');
  assert.equal(classificarPergunta('Quantos registros do cliente MMA existem?'), 'silver');
  assert.equal(classificarPergunta('Quais tipos de pedido existem?'), 'silver');
});

test('roteia explicacao de queda para analise de influencias', () => {
  assert.equal(
    classificarPergunta('Compare os periodos e diga quais marcas mais influenciaram a queda'),
    'influencias'
  );
});

test('roteia pedidos pagos para indicadores Gold', () => {
  assert.equal(classificarPergunta('Qual foi o valor dos pedidos pagos no mes?'), 'indicadores');
});

test('roteia faturamento com intervalo explicito para indicadores Gold', () => {
  assert.equal(
    classificarPergunta('Qual foi o faturamento de 22/06/2026 até 21/07/2026?'),
    'indicadores'
  );
});

test('mantem rankings dimensionais na fachada de vendas', () => {
  assert.equal(classificarPergunta('Qual marca teve o maior faturamento?'), 'vendas');
  assert.equal(classificarPergunta('Qual plataforma vendeu mais no periodo?'), 'vendas');
  assert.equal(
    classificarPergunta('Compare a queda de faturamento por marca'),
    'influencias'
  );
});

test('respeita perfil explicito e valida perfil desconhecido', () => {
  assert.equal(resolverPerfil('qualquer pergunta', 'silver'), 'silver');
  assert.throws(() => resolverPerfil('x', 'impossivel'), /Perfil invalido/);
});
