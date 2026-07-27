const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarVendas,
  executarAnalisarVendas
} = require('../tools/analisar_vendas');

function argumentos(sobrescritas = {}) {
  return {
    operacao: 'ranquear',
    nivel: 'item',
    agrupar_por: 'marca',
    data_campo: 'pedido',
    data_inicial: '2026-07-17',
    data_final: null,
    filtros: [],
    metricas: ['quantidade', 'valor'],
    ordenar_por: 'quantidade',
    limite: 10,
    ...sobrescritas
  };
}

function leitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async agregar(nome, opcoes) {
        chamadas.push(['agregar', nome, opcoes]);
        return {
          dados: [{ grupo_1: 'PHILCO', calculo_1: 492, calculo_2: 656358.41 }],
          ultimaConstrucao: '2026-07-20T10:00:00Z'
        };
      },
      async consultar(nome, opcoes) {
        chamadas.push(['consultar', nome, opcoes]);
        return { dados: [{ id_nota_saida: 1 }], ultimaConstrucao: 'agora' };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expoe contrato compacto e estrito para vendas', () => {
  assert.equal(definicaoAnalisarVendas.name, 'analisar_vendas');
  assert.equal(definicaoAnalisarVendas.strict, true);
  assert.deepEqual(
    new Set(definicaoAnalisarVendas.parameters.required),
    new Set(Object.keys(definicaoAnalisarVendas.parameters.properties))
  );
  const filtro = definicaoAnalisarVendas.parameters.properties.filtros.items;
  assert.deepEqual(filtro.required, ['campo', 'operador', 'valor']);
  const metricas = definicaoAnalisarVendas.parameters.properties.metricas;
  assert.equal(metricas.maxItems, 4);
  assert.deepEqual(metricas.type, ['array', 'null']);
  assert.equal(
    definicaoAnalisarVendas.parameters.properties.pedidos_marketplace.maxItems,
    50
  );
});

test('traduz ranking de marca para campos de negocio', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarVendas(argumentos(), {
    criarLeitor: () => falso.leitor
  }));

  assert.deepEqual(saida.dados, [{
    marca: 'PHILCO',
    quantidade_vendida: 492,
    valor_total_vendido: 656358.41
  }]);
  assert.equal(falso.chamadas[0][1], 'fato_pedido_item');
  assert.deepEqual(falso.chamadas[0][2].filtros.data_pedido, {
    operador: 'igual',
    valor: '2026-07-17'
  });
  assert.equal(falso.fechado, true);
});

test('emissao filtra somente notas emitidas e lista pelas mais recentes', async () => {
  const falso = leitorFalso();
  await executarAnalisarVendas(argumentos({
    operacao: 'listar',
    nivel: 'pedido',
    agrupar_por: null,
    data_campo: 'emissao',
    metricas: [],
    ordenar_por: null
  }), { criarLeitor: () => falso.leitor });

  const opcoes = falso.chamadas[0][2];
  assert.equal(falso.chamadas[0][1], 'fato_nota_fiscal');
  assert.equal(opcoes.filtros.faturamento_valido, undefined);
  assert.deepEqual(opcoes.ordenacao, { campo: 'data_emissao', direcao: 'desc' });
});

test('impede produto no nivel de pedido', async () => {
  let abriuLeitor = false;
  await assert.rejects(
    executarAnalisarVendas(argumentos({ nivel: 'pedido', agrupar_por: 'produto' }), {
      criarLeitor() {
        abriuLeitor = true;
        return leitorFalso().leitor;
      }
    }),
    /exige nivel item/
  );
  assert.equal(abriuLeitor, false);
});

test('resumo ignora agrupamento e retorna o total geral', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarVendas(argumentos({
    operacao: 'resumir',
    agrupar_por: 'marca'
  }), { criarLeitor: () => falso.leitor }));

  assert.deepEqual(falso.chamadas[0][2].agrupamentos, []);
  assert.equal(saida.agrupado_por, null);
});

test('agrupa transportadora por id e retorna seu nome descritivo', async () => {
  const falso = leitorFalso();
  falso.leitor.agregar = async (nome, opcoes) => {
    falso.chamadas.push(['agregar', nome, opcoes]);
    return {
      dados: [{ grupo_1: 232861, grupo_2: 'JADLOG - ORIGEM EXT', calculo_1: 337n }],
      ultimaConstrucao: 'agora'
    };
  };
  const saida = JSON.parse(await executarAnalisarVendas(argumentos({
    nivel: 'pedido',
    agrupar_por: 'transportadora',
    metricas: ['pedidos'],
    ordenar_por: 'pedidos'
  }), { criarLeitor: () => falso.leitor }));

  assert.deepEqual(falso.chamadas[0][2].agrupamentos, [
    { campo: 'id_transportadora', granularidade: 'valor' },
    { campo: 'transporte_regras', granularidade: 'valor' }
  ]);
  assert.deepEqual(falso.chamadas[0][2].filtros.id_transportadora, {
    operador: 'maior_que',
    valor: '0'
  });
  assert.deepEqual(saida.dados[0], {
    id_transportadora: 232861,
    transportadora: 'JADLOG - ORIGEM EXT',
    quantidade_pedidos: '337'
  });
});

test('lista ultimos pedidos somente com transportadora registrada', async () => {
  const falso = leitorFalso();
  falso.leitor.consultar = async (nome, opcoes) => {
    falso.chamadas.push(['consultar', nome, opcoes]);
    return {
      dados: [{
        id_nota_saida: 123,
        id_nr_nf: 456,
        marketplace_pedido: 'PED-1',
        transporte_regras: 'JADLOG'
      }],
      ultimaConstrucao: 'agora'
    };
  };
  const saida = JSON.parse(await executarAnalisarVendas(argumentos({
    operacao: 'listar',
    nivel: 'pedido',
    agrupar_por: null,
    data_inicial: null,
    filtros: [{ campo: 'transportadora', operador: 'nao_esta_vazio', valor: null }],
    metricas: [],
    ordenar_por: 'data_pedido'
  }), { criarLeitor: () => falso.leitor }));

  assert.deepEqual(falso.chamadas[0][2].filtros.transporte_regras, {
    operador: 'nao_esta_vazio',
    valor: null
  });
  assert.deepEqual(falso.chamadas[0][2].ordenacao, {
    campo: 'data_pedido',
    direcao: 'desc'
  });
  assert.deepEqual(saida.dados, [{
    id_registro_venda: 123,
    numero_pedido: 'PED-1',
    numero_nota_fiscal: 456,
    transportadora: 'JADLOG'
  }]);
});

test('aceita todas as metricas conhecidas quando a operacao e listar', async () => {
  const falso = leitorFalso();
  await executarAnalisarVendas(argumentos({
    operacao: 'listar',
    nivel: 'pedido',
    agrupar_por: null,
    metricas: ['pedidos', 'itens', 'quantidade', 'valor'],
    ordenar_por: 'data_pedido'
  }), { criarLeitor: () => falso.leitor });

  assert.equal(falso.chamadas[0][0], 'consultar');
});

test('localiza notas em lote e presta contas de pedidos ausentes e duplicados', async () => {
  const falso = leitorFalso();
  falso.leitor.consultar = async (nome, opcoes) => {
    falso.chamadas.push(['consultar', nome, opcoes]);
    return {
      dados: [
        {
          marketplace_pedido: 'PED-1',
          id_nr_nf: 123,
          faturamento_valido: true,
          data_emissao: '2026-07-20'
        },
        {
          marketplace_pedido: 'PED-2',
          id_nr_nf: 456,
          faturamento_valido: false,
          data_emissao: '2026-07-21'
        },
        {
          marketplace_pedido: 'PED-2',
          id_nr_nf: 456,
          faturamento_valido: false,
          data_emissao: '2026-07-21'
        },
        {
          marketplace_pedido: 'PED-3',
          id_nr_nf: 0,
          faturamento_valido: false,
          data_emissao: null
        }
      ],
      ultimaConstrucao: 'agora'
    };
  };

  const saida = JSON.parse(await executarAnalisarVendas({
    operacao: 'localizar_notas',
    pedidos_marketplace: ['PED-1', 'PED-2', 'PED-3', 'PED-4', 'PED-2']
  }, { criarLeitor: () => falso.leitor }));

  assert.deepEqual(falso.chamadas[0][2].filtros.marketplace_pedido, {
    operador: 'em',
    valor: null,
    valores: ['PED-1', 'PED-2', 'PED-3', 'PED-4']
  });
  assert.equal(saida.notas_fiscais_separadas_por_espaco, '123 456');
  assert.deepEqual(saida.pedidos_nao_encontrados, ['PED-4']);
  assert.deepEqual(saida.pedidos_encontrados_sem_nota_fiscal, ['PED-3']);
  assert.deepEqual(saida.pedidos_duplicados_na_solicitacao, [{
    numero_pedido_marketplace: 'PED-2',
    ocorrencias: 2
  }]);
  assert.deepEqual(saida.pedidos[0].notas_fiscais_validas, ['123']);
  assert.deepEqual(saida.pedidos[1].notas_fiscais_validas, []);
  assert.equal(falso.fechado, true);
});

test('rejeita numero de pedido marketplace recebido como numero', async () => {
  let abriuLeitor = false;
  await assert.rejects(
    executarAnalisarVendas({
      operacao: 'localizar_notas',
      pedidos_marketplace: [7010572805356104]
    }, {
      criarLeitor() {
        abriuLeitor = true;
        return leitorFalso().leitor;
      }
    }),
    /deve ser enviado como texto/
  );
  assert.equal(abriuLeitor, false);
});
