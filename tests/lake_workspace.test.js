const test = require('node:test');
const assert = require('node:assert/strict');

const { limparWorkspaceLake } = require('../nexus/lake_workspace');

test('limpeza temporaria ocupada nao invalida snapshot ja publicado', async () => {
  let chamadas = 0;
  const removido = await limparWorkspaceLake({ temporario: true, raiz: 'temporario' }, {
    tentativas: 3,
    aguardar: async () => {},
    remover: async () => {
      chamadas += 1;
      const erro = new Error('ocupado');
      erro.code = 'EBUSY';
      throw erro;
    }
  });
  assert.equal(removido, false);
  assert.equal(chamadas, 3);
});

test('limpeza temporaria ainda propaga erros inesperados', async () => {
  await assert.rejects(limparWorkspaceLake({ temporario: true, raiz: 'temporario' }, {
    remover: async () => {
      const erro = new Error('negado');
      erro.code = 'EACCES';
      throw erro;
    }
  }), /negado/);
});
