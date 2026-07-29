const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executarAgente,
  lerArgumentos
} = require('../agentes/consultor_nexus');
const {
  aplicarGarantiasResposta,
  formatarDatasResposta
} = require('../agentes/resposta');
const {
  FERRAMENTAS_NEGOCIO,
  obterFerramentasDoPerfil
} = require('../agentes/ferramentas');

test('apresenta datas ISO no formato brasileiro', () => {
  assert.equal(
    formatarDatasResposta(
      'Recebido em 2026-07-17; extraido em 2026-07-29T00:00:00.000Z.'
    ),
    'Recebido em 17/07/2026; extraido em 29/07/2026.'
  );
});

test('garante as notas do ultimo recebimento quando o modelo as omite', () => {
  assert.equal(
    aplicarGarantiasResposta(
      'Foram recebidas 200 unidades.',
      [{
        nome: 'analisar_reposicoes',
        resultado: {
          operacao: 'ultimo_recebimento',
          encontrado: true,
          notas_fiscais_entrada: ['441898', '441899']
        }
      }]
    ),
    'Foram recebidas 200 unidades.\n\n' +
      'Notas fiscais de entrada: 441898, 441899.'
  );
});

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
  assert.deepEqual(
    contexto.tools.map((ferramenta) => ferramenta.definicao.name),
    FERRAMENTAS_NEGOCIO
  );
  assert.equal(
    contexto.tools.find(
      (item) => item.definicao.name === 'analisar_vendas'
    ).executar,
    executarVendas
  );
  assert.equal(contexto.maxRodadas, 4);
});

test('envia somente a fachada Gold quando a pergunta e ranking de venda', async () => {
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
    ['analisar_desempenho']
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
  assert.equal(contexto.maxRodadas, 4);
});

test('amplia uma vez o roteamento quando o provider solicita fachada ausente', async () => {
  const contextos = [];
  const provider = {
    async executar(contexto) {
      contextos.push(contexto);
      if (contextos.length === 1) {
        throw new Error(
          "attempted to call tool 'analisar_influencias' " +
          'which was not in request.tools'
        );
      }
      return { texto: 'Variacao analisada.', provider: 'teste', modelo: 'mock' };
    }
  };

  const resultado = await executarAgente(
    'Quais tipos predominam no catalogo?',
    { provider }
  );

  assert.equal(contextos.length, 2);
  assert.deepEqual(
    contextos[0].tools.map((item) => item.definicao.name),
    ['analisar_catalogo']
  );
  assert.deepEqual(
    contextos[1].tools.map((item) => item.definicao.name),
    ['analisar_catalogo', 'analisar_influencias']
  );
  assert.equal(resultado.roteamento.toolRecuperada, 'analisar_influencias');
  assert.equal(resultado.roteamento.perfilEfetivo, 'influencias');
});

test('nao encadeia recuperacoes nem amplia perfil escolhido manualmente', async () => {
  let chamadasAutomaticas = 0;
  const providerAutomatico = {
    async executar() {
      chamadasAutomaticas += 1;
      const tool = chamadasAutomaticas === 1
        ? 'analisar_influencias'
        : 'analisar_vendas';
      throw new Error(
        `attempted to call tool '${tool}' which was not in request.tools`
      );
    }
  };
  await assert.rejects(
    executarAgente('Quais tipos predominam no catalogo?', {
      provider: providerAutomatico
    }),
    /analisar_vendas/
  );
  assert.equal(chamadasAutomaticas, 2);

  let chamadasManuais = 0;
  const providerManual = {
    async executar() {
      chamadasManuais += 1;
      throw new Error(
        "attempted to call tool 'analisar_influencias' which was not in request.tools"
      );
    }
  };
  await assert.rejects(
    executarAgente('Quais tipos predominam no catalogo?', {
      provider: providerManual,
      perfilTools: 'catalogo'
    }),
    /analisar_influencias/
  );
  assert.equal(chamadasManuais, 1);
});

test('perfis com varias tools permitem combinar resultados', () => {
  assert.ok(
    obterFerramentasDoPerfil('hibrido')
      .every((ferramenta) => ferramenta.terminal === false)
  );
  assert.equal(
    obterFerramentasDoPerfil('estoque')[0].terminal,
    true
  );
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
