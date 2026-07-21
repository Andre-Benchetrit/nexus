const test = require('node:test');
const assert = require('node:assert/strict');

const { classificarPergunta, resolverPerfil } = require('../agentes/roteador');

test('roteia vendas, catalogo e auditoria sem usar modelo', () => {
  assert.equal(classificarPergunta('Qual marca mais vendeu hoje?'), 'vendas');
  assert.equal(classificarPergunta('Quanto vendemos para o cliente MMA?'), 'vendas');
  assert.equal(classificarPergunta('Quais foram as ultimas notas?'), 'vendas');
  assert.equal(classificarPergunta('Quais tipos predominam no catálogo?'), 'catalogo');
  assert.equal(classificarPergunta('Quero auditar os dados brutos do Bronze'), 'bronze');
  assert.equal(classificarPergunta('Quantos registros do cliente MMA existem?'), 'silver');
  assert.equal(classificarPergunta('Quais tipos de pedido existem?'), 'silver');
});

test('respeita perfil explicito e valida perfil desconhecido', () => {
  assert.equal(resolverPerfil('qualquer pergunta', 'silver'), 'silver');
  assert.throws(() => resolverPerfil('x', 'impossivel'), /Perfil invalido/);
});
