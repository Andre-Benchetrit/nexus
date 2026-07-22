const test = require('node:test');
const assert = require('node:assert/strict');

const { executarAgente, lerArgumentos } = require('../agentes/consultor_nexus');

test('delega a execução para um provider com contrato comum', async () => {
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'Resposta do provider', provider: 'teste', modelo: 'mock' };
    }
  };
  const executarVendas = async () => '{}';

  const resultado = await executarAgente('Quais dados temos?', {
    provider,
    executarAnalisarVendasTool: executarVendas
  });

  assert.equal(resultado.texto, 'Resposta do provider');
  assert.equal(contexto.pergunta, 'Quais dados temos?');
  assert.equal(contexto.tools[0].executar, executarVendas);
  assert.deepEqual(
    contexto.tools.map((ferramenta) => ferramenta.definicao.name),
    ['analisar_vendas', 'analisar_catalogo']
  );
  assert.equal(contexto.maxRodadas, 3);
});

test('envia somente a fachada de vendas quando a pergunta e sobre venda', async () => {
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'ok' };
    }
  };
  await executarAgente('Qual marca mais vendeu ontem?', { provider });
  assert.deepEqual(
    contexto.tools.map(({ definicao }) => definicao.name),
    ['analisar_vendas']
  );
});

test('envia somente indicadores Gold em comparacoes executivas', async () => {
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'ok' };
    }
  };
  await executarAgente('Compare o faturamento deste mes com o anterior', { provider });
  assert.deepEqual(
    contexto.tools.map(({ definicao }) => definicao.name),
    ['analisar_indicadores']
  );
  assert.equal(contexto.maxRodadas, 3);
});

test('completa o ano de uma data curta antes de chamar o provider', async () => {
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'ok' };
    }
  };
  await executarAgente('Pedidos de 17/07', {
    provider,
    dataReferencia: '2026-07-20'
  });
  assert.equal(contexto.pergunta, 'Pedidos de 17/07/2026');
  assert.match(contexto.instrucoes, /Hoje no negocio: 2026-07-20/);
});

test('lê provider e modelo pela linha de comando', () => {
  assert.deepEqual(
    lerArgumentos(['--provider', 'gemini', '--model', 'modelo-x', 'Quantos', 'clientes?']),
    {
      pergunta: 'Quantos clientes?',
      opcoes: { providerNome: 'gemini', modelo: 'modelo-x' }
    }
  );
});

test('le perfil de tools pela linha de comando', () => {
  assert.deepEqual(
    lerArgumentos(['--perfil', 'silver', 'Quantos', 'clientes?']),
    {
      pergunta: 'Quantos clientes?',
      opcoes: { perfilTools: 'silver' }
    }
  );
});
