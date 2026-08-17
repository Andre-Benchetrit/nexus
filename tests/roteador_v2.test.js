const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { executarAgente } = require('../agentes/consultor_nexus');
const { validarPlanoSugerido } = require('../agentes/capacidades');
const { criarMemoria } = require('../agentes/memoria');
const { converterTools } = require('../agentes/providers/groq');
const {
  definicaoRegistrarDecisaoRota,
  normalizarEntidadesRota,
  normalizarDecisao,
  resolverModoRoteador
} = require('../agentes/roteador_semantico');

function memoriaTemporaria(t) {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-router-v2-'));
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));
  return criarMemoria({
    sessao: 'v2',
    caminhoCurta: path.join(diretorio, 'curta.json'),
    caminhoLonga: path.join(diretorio, 'longa.json')
  });
}

function decisaoBloqueios(sobrescrever = {}) {
  return {
    pergunta_autonoma: 'Liste os pedidos bloqueados PED-1 e PED-2 com EAN.',
    dominio_primario: 'bloqueios_estoque',
    dominios_secundarios: [],
    intencao: 'enriquecer',
    entidades: [{
      tipo: 'marketplace_pedido', valores: ['PED-1', 'PED-2'], origem: 'memoria'
    }],
    periodo: null,
    filtros: [],
    campos_solicitados: ['marketplace_pedido', 'ean'],
    plano_sugerido: [{
      ferramenta: 'consultar_bloqueios_sem_estoque', finalidade: 'listar_itens'
    }],
    capacidades_ausentes: [],
    confianca: 0.98,
    precisa_esclarecimento: false,
    pergunta_esclarecimento: null,
    codigos_motivo: ['referencia_memoria'],
    ...sobrescrever
  };
}

test('normaliza decisao semantica e rejeita dominio invalido', () => {
  const decisao = normalizarDecisao(decisaoBloqueios());
  assert.equal(decisao.dominioPrimario, 'bloqueios_estoque');
  assert.equal(decisao.intencao, 'enriquecer');
  assert.throws(
    () => normalizarDecisao(decisaoBloqueios({ dominio_primario: 'inventado' })),
    /Dominio invalido/
  );
});

test('normaliza formatos tolerados de entidades para o contrato canônico', () => {
  assert.deepEqual(normalizarEntidadesRota('produto,pedido_compra').entidades, [
    { tipo: 'produto', valores: [], origem: 'pergunta_atual' },
    { tipo: 'pedido_compra', valores: [], origem: 'pergunta_atual' }
  ]);
  assert.deepEqual(normalizarEntidadesRota({
    tipo: 'produto', valores: ['SKU-1'], origem: 'pergunta_atual'
  }).entidades, [
    { tipo: 'produto', valores: ['SKU-1'], origem: 'pergunta_atual' }
  ]);
  assert.deepEqual(normalizarEntidadesRota({
    tipo: 'produto', valores: []
  }).entidades, [
    { tipo: 'produto', valores: [], origem: 'pergunta_atual' }
  ]);
  assert.deepEqual(normalizarEntidadesRota({ itens: ['produto'] }).entidades, [
    { tipo: 'produto', valores: [], origem: 'pergunta_atual' }
  ]);
  assert.deepEqual(normalizarEntidadesRota({ produto: ['SKU-1', 'SKU-2'] }).entidades, [
    { tipo: 'produto', valores: ['SKU-1', 'SKU-2'], origem: 'pergunta_atual' }
  ]);
});

test('entidade ambígua reduz confiança e exige esclarecimento', () => {
  const decisao = normalizarDecisao(decisaoBloqueios({
    entidades: { produto: '123' }, confianca: 0.98
  }));
  assert.equal(decisao.confianca, 0.65);
  assert.equal(decisao.precisaEsclarecimento, true);
  assert.match(decisao.perguntaEsclarecimento, /SKU, EAN, ID/);
  assert.equal(decisao.normalizacaoEntidades.formato, 'mapa');
  assert.ok(decisao.codigosMotivo.includes('entidades_normalizadas:mapa'));
});

test('normalizador de entidades rejeita propriedades e valores estruturados desconhecidos', () => {
  assert.throws(
    () => normalizarEntidadesRota({
      tipo: 'produto', valores: [], origem: 'pergunta_atual', ferramenta: 'consultar_bronze'
    }),
    /Propriedade de entidade nao permitida/
  );
  assert.throws(
    () => normalizarEntidadesRota({ produto: [{ sql: 'DROP TABLE x' }] }),
    /Valores de entidade devem ser escalares/
  );
});

test('schema da Groq anuncia objeto além de array e string para entidades', () => {
  const [tool] = converterTools([definicaoRegistrarDecisaoRota]);
  const schema = tool.function.parameters.properties.entidades;
  assert.ok(schema.anyOf.some((item) => item.type === 'object'));
  assert.ok(schema.anyOf.some((item) => Array.isArray(item.type) && item.type.includes('array')));
  const objetosEntidade = [];
  function visitar(item) {
    if (!item || typeof item !== 'object') return;
    if (item.properties?.tipo && item.properties?.valores && item.properties?.origem) {
      objetosEntidade.push(item);
    }
    Object.values(item.properties || {}).forEach(visitar);
    if (item.items) visitar(item.items);
    for (const combinador of ['anyOf', 'oneOf', 'allOf']) {
      (item[combinador] || []).forEach(visitar);
    }
  }
  visitar(schema);
  assert.ok(objetosEntidade.length >= 2);
  assert.ok(objetosEntidade.every((item) => JSON.stringify(item.required) === '["tipo"]'));
});

test('planejador rejeita fachada de outro dominio e preserva a especializada', () => {
  const decisao = normalizarDecisao(decisaoBloqueios({
    plano_sugerido: [{ ferramenta: 'analisar_vendas', finalidade: 'listar' }]
  }));
  const plano = validarPlanoSugerido(decisao);
  assert.deepEqual(plano.ferramentas, ['consultar_bloqueios_sem_estoque']);
  assert.equal(plano.rejeitadas[0].motivo, 'dominio_incompativel');
});

test('agregacao visual de bloqueios preserva a fachada especializada sem inventar vendas', () => {
  const decisao = normalizarDecisao(decisaoBloqueios({
    pergunta_autonoma: 'Liste os pedidos bloqueados hoje agrupados por produto.',
    dominios_secundarios: ['estoque', 'vendas'],
    intencao: 'agregar',
    campos_solicitados: [
      'marketplace_pedido', 'sku', 'ean', 'descricao_produto', 'quantidade_pedida', 'bloqueio'
    ],
    plano_sugerido: [
      { ferramenta: 'consultar_bloqueios_sem_estoque', finalidade: 'listar e agrupar na resposta' },
      { ferramenta: 'diagnosticar_bloqueio_sem_estoque', finalidade: 'enriquecer' }
    ]
  }));
  const plano = validarPlanoSugerido(decisao);
  assert.deepEqual(plano.ferramentas, ['consultar_bloqueios_sem_estoque']);
  assert.equal(plano.rejeitadas[0].ferramenta, 'diagnosticar_bloqueio_sem_estoque');
  assert.equal(plano.rejeitadas[0].motivo, 'intencao_incompativel');
  assert.equal(plano.capacidadesAusentes.includes('intencao:agregar@vendas'), false);
  assert.equal(plano.capacidadesAusentes.includes('intencao:agregar@estoque'), false);
});

test('planejador não autoriza Bronze sem intenção de auditoria', () => {
  const decisao = normalizarDecisao(decisaoBloqueios({
    dominio_primario: 'bronze',
    intencao: 'listar',
    campos_solicitados: ['registro_bruto'],
    plano_sugerido: [{ ferramenta: 'consultar_bronze', finalidade: 'consultar' }]
  }));
  const plano = validarPlanoSugerido(decisao);
  assert.deepEqual(plano.ferramentas, []);
  assert.equal(plano.rejeitadas[0].motivo, 'bronze_exige_auditoria');
  assert.ok(plano.capacidadesAusentes.includes('intencao:listar@bronze'));
});

test('planejador bloqueia Silver complementar sem capacidade ausente', () => {
  const decisao = normalizarDecisao(decisaoBloqueios({
    dominios_secundarios: ['silver'],
    plano_sugerido: [
      { ferramenta: 'consultar_bloqueios_sem_estoque', finalidade: 'listar_itens' },
      { ferramenta: 'consultar_silver', finalidade: 'consultar' }
    ]
  }));
  const plano = validarPlanoSugerido(decisao);
  assert.deepEqual(plano.ferramentas, ['consultar_bloqueios_sem_estoque']);
  assert.equal(plano.rejeitadas[0].motivo, 'camada_sem_capacidade_ausente');
});

test('modo padrão de produção é shadow e provider injetado preserva legado', (t) => {
  const modoAmbiente = process.env.NEXUS_ROUTER_MODE;
  delete process.env.NEXUS_ROUTER_MODE;
  t.after(() => {
    if (modoAmbiente === undefined) delete process.env.NEXUS_ROUTER_MODE;
    else process.env.NEXUS_ROUTER_MODE = modoAmbiente;
  });
  assert.equal(resolverModoRoteador({}), 'shadow');
  assert.equal(resolverModoRoteador({ provider: {} }), 'legacy');
  assert.equal(resolverModoRoteador({ routerMode: 'v2', provider: {} }), 'v2');
});

test('v2 resolve continuação, usa fachada em lote e persiste identificadores completos', async (t) => {
  const memoria = memoriaTemporaria(t);
  memoria.registrarInteracao({
    pergunta: 'Quais pedidos têm bloqueio de estoque?',
    resposta: 'PED-1 e PED-2 estão bloqueados.',
    perfil: 'bloqueios_estoque',
    rota: {
      dominioPrimario: 'bloqueios_estoque', intencao: 'listar',
      dominiosSecundarios: []
    },
    entidades: { marketplace_pedido: ['PED-1', 'PED-2'] }
  });

  const providerRoteador = {
    nome: 'router-mock',
    modelo: 'router-v2',
    async executar(contexto) {
      assert.match(contexto.instrucoes, /dado nao confiavel/);
      await contexto.tools[0].executar(decisaoBloqueios({
        dominio_primario: 'vendas',
        plano_sugerido: [{ ferramenta: 'analisar_vendas', finalidade: 'listar' }]
      }));
      return { texto: 'Rota registrada.', provider: 'router-mock', modelo: 'router-v2' };
    }
  };
  let perguntaPrincipal;
  let ferramentasPrincipais;
  let argumentosTool;
  const provider = {
    async executar(contexto) {
      perguntaPrincipal = contexto.pergunta;
      ferramentasPrincipais = contexto.tools.map((item) => item.definicao.name);
      const tool = contexto.tools[0];
      await tool.executar({
        operacao: 'listar_itens',
        marketplace_pedido: null,
        marketplace_pedidos: ['PED-1', 'PED-2'],
        id_nota_saida: null,
        ids_notas_saida: null,
        limite: 100
      });
      return {
        texto: 'PED-1 — EAN-1\nPED-2 — EAN-2',
        provider: 'resposta-mock',
        modelo: 'principal'
      };
    }
  };

  const resultado = await executarAgente(
    'Pode me passar esses pedidos novamente, mas com o código de barra na frente?',
    {
      provider,
      providerRoteador,
      routerMode: 'v2',
      memoria,
      executarConsultarBloqueiosSemEstoqueTool: async (argumentos) => {
        argumentosTool = argumentos;
        return JSON.stringify({
          operacao: 'listar_itens',
          dados: [
            { marketplace_pedido: 'PED-1', ean: 'EAN-1' },
            { marketplace_pedido: 'PED-2', ean: 'EAN-2' }
          ],
          atualizado_em: '2026-08-11T12:00:00-03:00'
        });
      }
    }
  );

  assert.equal(resultado.roteamento.perfilInicial, 'bloqueios_estoque');
  assert.equal(resultado.roteamento.modo, 'v2');
  assert.deepEqual(ferramentasPrincipais, ['consultar_bloqueios_sem_estoque']);
  assert.equal(perguntaPrincipal, 'Liste os pedidos bloqueados PED-1 e PED-2 com EAN.');
  assert.deepEqual(argumentosTool.marketplace_pedidos, ['PED-1', 'PED-2']);
  assert.deepEqual(
    memoria.listarCurta().at(-1).entidades.marketplace_pedido,
    ['PED-1', 'PED-2']
  );
  assert.deepEqual(memoria.listarCurta().at(-1).entidades.ean, ['EAN-1', 'EAN-2']);
});

test('v2 pede esclarecimento sem executar provider principal', async (t) => {
  const memoria = memoriaTemporaria(t);
  let principalExecutado = false;
  const resultado = await executarAgente('Como estamos?', {
    routerMode: 'v2',
    memoria,
    provider: { async executar() { principalExecutado = true; } },
    providerRoteador: {
      nome: 'router-mock', modelo: 'router-v2',
      async executar(contexto) {
        await contexto.tools[0].executar(decisaoBloqueios({
          pergunta_autonoma: 'Como estamos?',
          dominio_primario: 'hibrido',
          intencao: 'resumir',
          entidades: [],
          campos_solicitados: [],
          plano_sugerido: [],
          confianca: 0.3,
          precisa_esclarecimento: true,
          pergunta_esclarecimento: 'Você quer analisar vendas, estoque ou operação?'
        }));
        return { texto: 'ok' };
      }
    }
  });
  assert.equal(principalExecutado, false);
  assert.match(resultado.texto, /vendas, estoque ou operação/);
  assert.equal(resultado.roteamento.esclarecimento, true);
});

test('v2 permite mudança legítima de bloqueios para faturamento dos pedidos', async (t) => {
  const memoria = memoriaTemporaria(t);
  memoria.registrarInteracao({
    pergunta: 'Quais pedidos têm bloqueio de estoque?',
    resposta: 'PED-1 e PED-2 estão bloqueados.',
    perfil: 'bloqueios_estoque',
    rota: { dominioPrimario: 'bloqueios_estoque', dominiosSecundarios: [], intencao: 'listar' },
    entidades: { marketplace_pedido: ['PED-1', 'PED-2'] }
  });
  let tools;
  const resultado = await executarAgente('Qual foi o faturamento deles?', {
    routerMode: 'v2',
    memoria,
    provider: {
      async executar(contexto) {
        tools = contexto.tools.map((item) => item.definicao.name);
        return { texto: 'A tool de vendas deve reconfirmar os valores.', provider: 'mock' };
      }
    },
    providerRoteador: {
      nome: 'router-mock', modelo: 'router-v2',
      async executar(contexto) {
        await contexto.tools[0].executar(decisaoBloqueios({
          pergunta_autonoma: 'Qual foi o faturamento dos pedidos PED-1 e PED-2?',
          dominio_primario: 'vendas',
          intencao: 'resumir',
          campos_solicitados: ['marketplace_pedido', 'faturamento'],
          plano_sugerido: [{ ferramenta: 'analisar_vendas', finalidade: 'resumir' }]
        }));
        return { texto: 'ok' };
      }
    }
  });
  assert.equal(resultado.roteamento.perfilInicial, 'vendas');
  assert.deepEqual(tools, ['analisar_vendas']);
});
