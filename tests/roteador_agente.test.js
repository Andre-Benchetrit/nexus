const test = require('node:test');
const assert = require('node:assert/strict');

const { classificarPergunta, resolverPerfil } = require('../agentes/roteador');

test('roteia vendas, catalogo e auditoria sem usar modelo', () => {
  assert.equal(classificarPergunta('Compare o faturamento deste mês com o anterior'), 'indicadores');
  assert.equal(classificarPergunta('Quantos pedidos estão pendentes?'), 'indicadores');
  assert.equal(classificarPergunta('Qual marca mais vendeu hoje?'), 'desempenho');
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

test('roteia rankings dimensionais faturados para o Gold de desempenho', () => {
  assert.equal(classificarPergunta('Qual marca teve o maior faturamento?'), 'desempenho');
  assert.equal(classificarPergunta('Qual plataforma vendeu mais no periodo?'), 'desempenho');
  assert.equal(
    classificarPergunta('Compare a queda de faturamento por marca'),
    'influencias'
  );
});

test('roteia ruptura e cobertura para o perfil de estoque', () => {
  assert.equal(classificarPergunta('Quais produtos estão em ruptura?'), 'estoque');
  assert.equal(classificarPergunta('Qual estoque deve acabar nos próximos 15 dias?'), 'estoque');
  assert.equal(classificarPergunta('Quais produtos têm cobertura crítica?'), 'estoque');
});

test('prioriza painel administrativo quando a pergunta mistura estoque e vendas', () => {
  assert.equal(
    classificarPergunta(
      'Me de o resumo administrativo mais recente e completo, incluindo vendas, faturamento e rupturas de estoque.'
    ),
    'indicadores'
  );
  assert.equal(
    classificarPergunta('Faca um resumo completo de vendas, faturamento e rupturas.'),
    'indicadores'
  );
  assert.equal(
    classificarPergunta('Me de apenas o resumo das rupturas por classificacao.'),
    'estoque'
  );
});

test('nao confunde vendas de 30 dias de um produto em ruptura com painel executivo', () => {
  assert.equal(
    classificarPergunta(
      'Liste 5 produtos da PHILCO em ruptura atual, com estoque e vendas dos ultimos 30 dias.'
    ),
    'estoque'
  );
});

test('roteia pedidos devolvidos por plataforma para o funil operacional', () => {
  assert.equal(
    classificarPergunta(
      'Quais plataformas tiveram mais pedidos devolvidos no periodo?'
    ),
    'operacao'
  );
});

test('prioriza listagem de pedidos pendentes sobre agregacao por plataforma', () => {
  assert.equal(
    classificarPergunta(
      'Liste os 5 pedidos pendentes mais recentes, mostrando numero, plataforma e valor.'
    ),
    'vendas'
  );
});

test('respeita perfil explicito e valida perfil desconhecido', () => {
  assert.equal(resolverPerfil('qualquer pergunta', 'silver'), 'silver');
  assert.throws(() => resolverPerfil('x', 'impossivel'), /Perfil invalido/);
});
