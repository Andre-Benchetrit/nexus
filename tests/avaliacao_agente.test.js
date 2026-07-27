const test = require('node:test');
const assert = require('node:assert/strict');

const {
  carregarCasos,
  validarResposta
} = require('../scripts/avaliar-agente');
const { resolverPerfilComContexto } = require('../agentes/roteador');

test('todos os casos permanentes seguem o perfil esperado', () => {
  const casos = carregarCasos();
  assert.ok(casos.length >= 20);
  for (const caso of casos) {
    assert.equal(
      resolverPerfilComContexto(
        caso.pergunta,
        caso.contextoAnterior ? [caso.contextoAnterior] : []
      ),
      caso.perfilEsperado,
      caso.id
    );
  }
});

test('validador automatico detecta respostas vazias e erros internos', () => {
  assert.ok(validarResposta('').length > 0);
  assert.ok(validarResposta('Erro: tool call validation failed').length > 0);
  assert.deepEqual(validarResposta('O resultado consultado foi de 10 pedidos.'), []);
});
