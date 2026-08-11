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

test('informa data indisponivel sem apresenta-la como analisada', () => {
  const resposta = aplicarGarantiasResposta('Foram 10 pedidos.', [{
    nome: 'analisar_indicadores',
    resultado: {
      operacao: 'painel',
      modo: 'focado',
      data_solicitada: '2026-08-03',
      data_analisada: null,
      dados_disponiveis: false,
      ultima_data_disponivel: '2026-07-29',
      ultimo_dia_completo: '2026-07-28',
      cobertura: { ultima_data_parcial: true }
    }
  }]);
  assert.match(resposta, /Não há dados disponíveis para 03\/08\/2026/);
  assert.match(resposta, /Última data disponível: 29\/07\/2026 \(parcial\)/);
  assert.doesNotMatch(resposta, /Data analisada: 03\/08\/2026/);
  assert.doesNotMatch(resposta, /10 pedidos/);
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
    [...FERRAMENTAS_NEGOCIO, 'solicitar_aprofundamento']
  );
  assert.equal(typeof contexto.tools.find(
    (item) => item.definicao.name === 'analisar_vendas'
  ).executar, 'function');
  assert.equal(contexto.maxRodadas, 10);
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
    ['analisar_desempenho', 'solicitar_aprofundamento']
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
    ['analisar_indicadores', 'solicitar_aprofundamento']
  );
  assert.equal(contexto.maxRodadas, 10);
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
    ['analisar_catalogo', 'solicitar_aprofundamento']
  );
  assert.deepEqual(
    contextos[1].tools.map((item) => item.definicao.name),
    ['analisar_catalogo', 'solicitar_aprofundamento', 'analisar_influencias']
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
  assert.ok(
    obterFerramentasDoPerfil('estoque')
      .every((ferramenta) => ferramenta.terminal === false)
  );
  assert.deepEqual(
    obterFerramentasDoPerfil('gold').map((item) => item.definicao.name),
    ['consultar_gold', 'agregar_gold']
  );
  const [consultaGold, agregacaoGold] = obterFerramentasDoPerfil('gold');
  assert.equal(consultaGold.terminal({ operacao: 'descrever_objeto' }), false);
  assert.equal(consultaGold.terminal({ operacao: 'consultar' }), true);
  assert.equal(agregacaoGold.terminal, true);
});

test('aprofunda dinamicamente no Silver sem reiniciar o provider', async () => {
  let contextoRecebido;
  const provider = {
    async executar(contexto) {
      contextoRecebido = contexto;
      const gateway = contexto.tools.find((item) => (
        item.definicao.name === 'solicitar_aprofundamento'
      ));
      await gateway.executar({
        camada: 'silver',
        finalidade: 'consultar',
        justificativa: 'Preciso dos detalhes modelados do cadastro solicitado.'
      });
      const consulta = contexto.tools.find((item) => item.definicao.name === 'consultar_silver');
      assert.ok(consulta);
      await consulta.executar({ operacao: 'descrever_objeto', objeto: 'dim_cliente' });
      await consulta.executar({ operacao: 'consultar', objeto: 'dim_cliente', limite: 5 });
      return { texto: 'Detalhes conferidos.', provider: 'teste', modelo: 'mock' };
    }
  };

  const resultado = await executarAgente('Quais detalhes adicionais existem para clientes?', {
    provider,
    executarConsultarSilverTool: async (argumentos) => JSON.stringify({
      operacao: argumentos.operacao,
      dados: []
    })
  });

  assert.equal(resultado.texto, 'Detalhes conferidos.');
  assert.equal(resultado.roteamento.aprofundamento.camada, 'silver');
  assert.match(resultado.roteamento.perfilEfetivo, /\+silver$/);
  assert.ok(contextoRecebido.tools.some((item) => item.definicao.name === 'agregar_silver'));
});

test('aprofunda no Gold e expoe apenas o par da camada escolhida', async () => {
  const provider = {
    async executar(contexto) {
      const liberacao = await contexto.tools.find((item) => item.definicao.name === 'solicitar_aprofundamento')
        .executar({
          camada: 'gold',
          finalidade: 'agregar',
          justificativa: 'A fachada nao trouxe a metrica oficial necessaria.'
        });
      assert.match(JSON.parse(liberacao).catalogo, /clientes_faturados/);
      const nomes = contexto.tools.map((item) => item.definicao.name);
      assert.ok(nomes.includes('consultar_gold'));
      assert.ok(nomes.includes('agregar_gold'));
      assert.ok(!nomes.includes('consultar_silver'));
      return { texto: 'Metrica conferida.', provider: 'teste', modelo: 'mock' };
    }
  };
  const resultado = await executarAgente('Confira uma metrica adicional do painel', { provider });
  assert.equal(resultado.roteamento.aprofundamento.camada, 'gold');
});

test('bloqueia Bronze comercial e uma segunda ampliacao', async () => {
  const providerBronze = {
    async executar(contexto) {
      return contexto.tools.find((item) => item.definicao.name === 'solicitar_aprofundamento')
        .executar({
          camada: 'bronze',
          finalidade: 'auditar',
          justificativa: 'Quero obter mais linhas para responder uma venda comum.'
        });
    }
  };
  await assert.rejects(
    executarAgente('Qual produto mais vendeu?', { provider: providerBronze }),
    /Bronze foi negado/
  );

  const providerDuplo = {
    async executar(contexto) {
      const gateway = contexto.tools.find((item) => item.definicao.name === 'solicitar_aprofundamento');
      await gateway.executar({
        camada: 'gold', finalidade: 'consultar',
        justificativa: 'Preciso conferir o indicador oficial solicitado.'
      });
      await gateway.executar({
        camada: 'silver', finalidade: 'consultar',
        justificativa: 'Agora quero tambem detalhes modelados adicionais.'
      });
    }
  };
  await assert.rejects(
    executarAgente('Confira uma divergencia do indicador', { provider: providerDuplo }),
    /Aprofundamento ja liberado/
  );
});

test('libera Bronze para auditoria explicita e preserva a visao historica', async () => {
  const provider = {
    async executar(contexto) {
      await contexto.tools.find((item) => item.definicao.name === 'solicitar_aprofundamento')
        .executar({
          camada: 'bronze', finalidade: 'auditar',
          justificativa: 'Preciso auditar a divergencia diretamente na origem.'
        });
      const consulta = contexto.tools.find((item) => item.definicao.name === 'consultar_bronze');
      assert.ok(consulta);
      await consulta.executar({
        operacao: 'consultar', entidade: 'nota_saida', visao: 'historico', limite: 5
      });
      return { texto: 'Auditoria concluida.', provider: 'teste', modelo: 'mock' };
    }
  };
  const resultado = await executarAgente(
    'Existe divergencia entre este registro e o resultado modelado',
    { provider, executarTool: async () => '{}' }
  );
  assert.equal(resultado.roteamento.aprofundamento.camada, 'bronze');
});

test('bloqueia repeticao identica e mais de uma consulta tecnica final', async () => {
  const provider = {
    async executar(contexto) {
      await contexto.tools.find((item) => item.definicao.name === 'solicitar_aprofundamento')
        .executar({
          camada: 'silver', finalidade: 'consultar',
          justificativa: 'Preciso consultar detalhes modelados adicionais.'
        });
      const consultar = contexto.tools.find((item) => item.definicao.name === 'consultar_silver');
      await consultar.executar({ operacao: 'consultar', objeto: 'dim_cliente', limite: 5 });
      await consultar.executar({ operacao: 'consultar', objeto: 'dim_cliente', limite: 5 });
    }
  };
  await assert.rejects(
    executarAgente('Consulte detalhes adicionais de clientes', {
      provider,
      executarConsultarSilverTool: async () => '{}'
    }),
    /Chamada repetida bloqueada/
  );
});

test('forca hoje literal e corrige deterministicamente a resposta do modelo', async () => {
  let argumentosExecutados;
  const provider = {
    async executar(contexto) {
      await contexto.tools[0].executar({
        operacao: 'painel',
        metricas: ['pedidos_pagos', 'valor_pedidos_pagos'],
        data_inicial: null,
        data_final: null,
        recencia: 'mais_recente_completo',
        limite: 1
      });
      return { texto: 'Hoje foram 0 pedidos e R$ 0,00.', provider: 'mock', modelo: 'mock' };
    }
  };
  const resultado = await executarAgente(
    'Quantos pedidos pagos temos hoje e qual o valor?',
    {
      provider,
      dataReferencia: '2026-08-03',
      executarAnalisarIndicadoresTool: async (argumentos) => {
        argumentosExecutados = argumentos;
        return JSON.stringify({
          operacao: 'painel',
          modo: 'focado',
          data_solicitada: '2026-08-03',
          data_analisada: '2026-08-03T00:00:00.000Z',
          dados_disponiveis: true,
          dados_parciais: true,
          metricas: { pedidos_pagos: 620, valor_pedidos_pagos: 600313.1 },
          cobertura: { atualizado_em: '2026-08-03T09:32:29.487-03:00' }
        });
      }
    }
  );

  assert.equal(argumentosExecutados.data_inicial, '2026-08-03');
  assert.equal(argumentosExecutados.data_final, '2026-08-03');
  assert.equal(argumentosExecutados.recencia, null);
  assert.match(resultado.texto, /Data analisada: 03\/08\/2026 \(dados parciais\)/);
  assert.match(resultado.texto, /Pedidos pagos: 620/);
  assert.match(resultado.texto, /Valor dos pedidos pagos: R\$\s*600\.313,10/);
  assert.match(resultado.texto, /Indicadores atualizados em 03\/08\/2026 às 09:32/);
  assert.doesNotMatch(resultado.texto, /0 pedidos/);
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

test('le configuracao do roteador e ignora separador isolado', () => {
  const resultado = lerArgumentos([
    '--router-mode', 'v2', '--router-provider', 'openai',
    '--router-model', 'modelo-rota', '--max-rodadas', '12', '--', 'Qual', 'pedido?'
  ]);
  assert.equal(resultado.pergunta, 'Qual pedido?');
  assert.equal(resultado.opcoes.routerMode, 'v2');
  assert.equal(resultado.opcoes.routerProviderNome, 'openai');
  assert.equal(resultado.opcoes.routerModelo, 'modelo-rota');
  assert.equal(resultado.opcoes.maxRodadas, 12);
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
