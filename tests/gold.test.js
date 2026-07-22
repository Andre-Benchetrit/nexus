const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB
} = require('../duckdb/connections');
const { criarLeitorGold } = require('../duckdb/gold');
const { objetos: catalogoGold, ordenarObjetosPorDependencias } = require('../gold/catalogo');
const { construirGold } = require('../gold/core/executar');
const {
  definicaoAnalisarIndicadores,
  executarAnalisarIndicadores
} = require('../tools/analisar_indicadores');

const fatoVendaTeste = {
  nome: 'fato_venda',
  chavePrimaria: 'id_nota_saida',
  consulta: { colunasPadrao: ['id_nota_saida'] }
};
const fatoVendaItemTeste = {
  nome: 'fato_venda_item',
  chavePrimaria: ['id_nota_saida', 'item'],
  consulta: { colunasPadrao: ['id_nota_saida', 'item'] }
};
const catalogoSilver = { fato_venda: fatoVendaTeste, fato_venda_item: fatoVendaItemTeste };

let raizLake;
let leitor;
let resultados;

async function criarFatoVendaSilver() {
  const diretorio = path.join(
    raizLake,
    'silver',
    'fato_venda',
    'dt_processamento=2026-07-19',
    'execucao=20260719T120000000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1, 1, DATE '2026-07-17', NULL::DATE, 'PEDIDO', false, false, 100::DECIMAL(18,2), 10),
        (2, 2, DATE '2026-07-17', DATE '2026-07-18', 'FATURADO', true, true, 200::DECIMAL(18,2), 11),
        (3, 0, DATE '2026-07-17', NULL::DATE, 'CANCELADO', false, false, 50::DECIMAL(18,2), 12),
        (4, 0, DATE '2026-07-17', NULL::DATE, 'ORÇAMENTO', false, false, 30::DECIMAL(18,2), 13),
        (5, 3, DATE '2026-07-18', DATE '2026-07-18', 'FATURADO', true, true, 300::DECIMAL(18,2), 10)
      ) AS dados(
        id_nota_saida, id_nr_nf, data_pedido, data_emissao, tipo_pedido,
        nota_emitida, faturamento_valido, valor_total_venda, id_cliente
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_venda',
    status: 'sucesso',
    inicio: '2026-07-19T12:00:00.000Z',
    fim: '2026-07-19T12:01:00.000Z',
    totalLinhas: 5,
    checksum: 'teste',
    arquivo: 'dados.parquet'
  }));
}

async function criarFatoVendaItemSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_venda_item',
    'dt_processamento=2026-07-19', 'execucao=20260719T120100000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (2::BIGINT, 1, DATE '2026-07-17', true, 190::DECIMAL(18,2)),
        (2::BIGINT, 2, DATE '2026-07-17', true, 10::DECIMAL(18,2)),
        (5::BIGINT, 1, DATE '2026-07-18', true, 300::DECIMAL(18,2))
      ) AS dados(id_nota_saida, item, data_pedido, pedido_pago, valor_pedido_pago_item)
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_venda_item', status: 'sucesso',
    inicio: '2026-07-19T12:01:00.000Z', fim: '2026-07-19T12:02:00.000Z',
    totalLinhas: 3, checksum: 'teste-item', arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizLake = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-gold-'));
  await criarFatoVendaSilver();
  await criarFatoVendaItemSilver();
  resultados = [];
  for (const [indice, objeto] of ordenarObjetosPorDependencias().entries()) {
    resultados.push(await construirGold(objeto, {
      raizLake,
      catalogoSilver,
      catalogoGold,
      agora: new Date(`2026-07-19T13:0${indice}:00.000Z`)
    }));
  }
  leitor = criarLeitorGold({ raizLake, catalogo: catalogoGold });
});

test.after(async () => {
  await leitor?.fechar();
  await fs.rm(raizLake, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('constroi objetos Gold na ordem de dependencia', () => {
  assert.deepEqual(resultados.map(({ objeto }) => objeto), [
    'kpi_vendas_diario',
    'kpi_faturamento_diario',
    'kpi_pedidos_pagos_diario',
    'painel_executivo_diario'
  ]);
  assert.equal(resultados[0].qualidade.chavesDuplicadas, 0);
  assert.equal(resultados[3].fontesGold.length, 3);
});

test('aplica as definicoes oficiais de pedido e pendencia', async () => {
  const resultado = await leitor.consultar('kpi_vendas_diario', {
    filtros: { data_referencia: '2026-07-17' },
    colunas: [
      'pedidos_recebidos', 'pedidos_validos', 'pedidos_cancelados',
      'pedidos_pendentes', 'pedidos_com_nota_emitida',
      'valor_pedidos_recebidos', 'valor_pedidos_validos', 'valor_cancelado'
    ],
    limite: 1
  });
  assert.deepEqual(resultado.dados[0], {
    pedidos_recebidos: 3n,
    pedidos_validos: 2n,
    pedidos_cancelados: 1n,
    pedidos_pendentes: 1n,
    pedidos_com_nota_emitida: 1n,
    valor_pedidos_recebidos: 350,
    valor_pedidos_validos: 300,
    valor_cancelado: 50
  });
});

test('faturamento usa data de emissao e somente notas emitidas', async () => {
  const resultado = await leitor.consultar('kpi_faturamento_diario', {
    filtros: { data_referencia: '2026-07-18' },
    colunas: ['notas_emitidas', 'faturamento_emitido', 'ticket_medio_faturado'],
    limite: 1
  });
  assert.deepEqual(resultado.dados[0], {
    notas_emitidas: 2n,
    faturamento_emitido: 500,
    ticket_medio_faturado: 250
  });
});

test('pedidos pagos usam data do pedido e composicao dos itens', async () => {
  const resultado = await leitor.consultar('kpi_pedidos_pagos_diario', {
    filtros: { data_referencia: '2026-07-17' },
    colunas: ['pedidos_pagos', 'valor_pedidos_pagos', 'ticket_medio_pedido_pago'],
    limite: 1
  });
  assert.deepEqual(resultado.dados[0], {
    pedidos_pagos: 1n,
    valor_pedidos_pagos: 200,
    ticket_medio_pedido_pago: 200
  });
});

test('tool Gold resume varias metricas sem reinterpretar formulas', async () => {
  assert.equal(definicaoAnalisarIndicadores.strict, true);
  const resposta = JSON.parse(await executarAnalisarIndicadores({
    operacao: 'resumir',
    metricas: [
      'pedidos_validos', 'valor_pedidos_validos',
      'notas_emitidas', 'faturamento_emitido'
    ],
    data_inicial: '2026-07-17',
    data_final: '2026-07-18',
    limite: 7
  }, {
    criarLeitor: () => criarLeitorGold({ raizLake, catalogo: catalogoGold })
  }));
  assert.deepEqual(resposta.metricas, {
    pedidos_validos: 3,
    valor_pedidos_validos: 600,
    notas_emitidas: 2,
    faturamento_emitido: 500
  });
});

test('tendencia explicita retorna todo o intervalo sem truncar pelo limite sugerido', async () => {
  const resposta = JSON.parse(await executarAnalisarIndicadores({
    operacao: 'tendencia',
    metricas: ['faturamento_emitido'],
    data_inicial: '2026-07-17',
    data_final: '2026-07-18',
    limite: 1
  }, {
    criarLeitor: () => criarLeitorGold({ raizLake, catalogo: catalogoGold })
  }));
  assert.equal(resposta.dados.length, 2);
});
