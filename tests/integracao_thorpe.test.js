const test = require('node:test');
const assert = require('node:assert/strict');

const {
  criarClienteThorpe,
  normalizarEstoqueThorpe
} = require('../integracoes/thorpe/cliente');
const {
  resolverConfiguracaoThorpe,
  resumirConfiguracaoThorpe
} = require('../integracoes/thorpe/configuracao');

test('resolve configuracao sem revelar credenciais no resumo', () => {
  const configuracao = resolverConfiguracaoThorpe({
    env: {
      THORPE_BASE_URL: 'https://thorpe.test/',
      THORPE_API_TOKEN: 'token-api-secreto',
      THORPE_USER: 'usuario',
      THORPE_PASSWORD: 'senha-secreta'
    }
  });
  const resumo = resumirConfiguracaoThorpe(configuracao);
  assert.deepEqual(resumo, {
    baseUrl: 'https://thorpe.test',
    apiToken: true,
    usuario: true,
    senha: true,
    pronta: true
  });
  assert.equal(JSON.stringify(resumo).includes('secreta'), false);
});

test('soma somente disponivel e pulmao dos lotes retornados', () => {
  const resultado = normalizarEstoqueThorpe({
    data: [
      { lote: 'A', disponivel: '10', pulmao: '2' },
      { lote: 'B', disponivel: 3, pulmao: '1,5', reservado: 999 }
    ]
  }, 'SKU-1', new Date('2026-08-10T12:00:00Z'));
  assert.equal(resultado.disponivel, 13);
  assert.equal(resultado.pulmao, 3.5);
  assert.equal(resultado.total_utilizavel, 16.5);
  assert.equal(resultado.lotes_considerados, 2);
});

test('autentica no Thorpe e consulta estoque por codigo auxiliar em modo leitura', async () => {
  const chamadas = [];
  const respostas = [
    new Response(JSON.stringify({ token: 'token-valido-12345' }), { status: 200 }),
    new Response(JSON.stringify({
      data: [{ disponivel: 4, pulmao: 6 }]
    }), { status: 200 })
  ];
  const cliente = criarClienteThorpe({
    configuracao: {
      baseUrl: 'https://thorpe.test',
      apiToken: 'api-token',
      usuario: 'usuario',
      senha: 'senha'
    },
    fetchImpl: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      return respostas.shift();
    },
    agora: new Date('2026-08-10T12:00:00Z')
  });

  const estoque = await cliente.consultarEstoque('SKU COM / BARRA');
  assert.equal(chamadas[0].url, 'https://thorpe.test/v2/token');
  assert.equal(chamadas[0].opcoes.method, 'POST');
  assert.equal(chamadas[0].opcoes.headers['api-token'], 'api-token');
  assert.equal(
    chamadas[1].url,
    'https://thorpe.test/v2/estoque/SKU%20COM%20%2F%20BARRA/lote'
  );
  assert.equal(chamadas[1].opcoes.method, 'GET');
  assert.equal(chamadas[1].opcoes.headers['api-token'], 'api-token');
  assert.equal(chamadas[1].opcoes.headers.authorization, 'Bearer token-valido-12345');
  assert.equal(estoque.total_utilizavel, 10);
});

test('renova o token uma vez quando o Thorpe responde 401', async () => {
  let autenticacoes = 0;
  let consultas = 0;
  const cliente = criarClienteThorpe({
    configuracao: {
      baseUrl: 'https://thorpe.test',
      apiToken: 'api-token',
      usuario: 'usuario',
      senha: 'senha'
    },
    fetchImpl: async (url) => {
      if (url.endsWith('/v2/token')) {
        autenticacoes += 1;
        return new Response(JSON.stringify({
          token: `token-valido-${autenticacoes}-xxxx`
        }), { status: 200 });
      }
      consultas += 1;
      if (consultas === 1) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ disponivel: 2, pulmao: 1 }), {
        status: 200
      });
    }
  });
  const estoque = await cliente.consultarEstoque('SKU-1');
  assert.equal(autenticacoes, 2);
  assert.equal(consultas, 2);
  assert.equal(estoque.total_utilizavel, 3);
});
