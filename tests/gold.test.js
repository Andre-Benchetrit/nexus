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
const {
  objetos: catalogoGoldCompleto,
  ordenarObjetosPorDependencias
} = require('../gold/catalogo');
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
const fatoPedidoTeste = {
  nome: 'fato_pedido',
  chavePrimaria: ['id_empresa', 'id_pedido_vda_importado'],
  consulta: { colunasPadrao: ['id_empresa', 'id_pedido_vda_importado'] }
};
const fatoNotaFiscalTeste = {
  nome: 'fato_nota_fiscal',
  chavePrimaria: 'id_nota_saida',
  consulta: { colunasPadrao: ['id_nota_saida'] }
};
const fatoPedidoItemTeste = {
  nome: 'fato_pedido_item',
  chavePrimaria: ['id_empresa', 'id_pedido_vda_importado', 'item'],
  consulta: { colunasPadrao: ['id_empresa', 'id_pedido_vda_importado', 'item'] }
};
const fatoEstoqueAtualTeste = {
  nome: 'fato_estoque_atual',
  chavePrimaria: 'id_sequencia',
  consulta: { colunasPadrao: ['id_sequencia'] }
};
const fatoMovimentoEstoqueTeste = {
  nome: 'fato_movimento_estoque',
  chavePrimaria: 'id_sequencia',
  consulta: { colunasPadrao: ['id_sequencia'] }
};
const catalogoSilver = {
  fato_venda: fatoVendaTeste,
  fato_venda_item: fatoVendaItemTeste,
  fato_pedido: fatoPedidoTeste,
  fato_nota_fiscal: fatoNotaFiscalTeste,
  fato_pedido_item: fatoPedidoItemTeste,
  fato_estoque_atual: fatoEstoqueAtualTeste,
  fato_movimento_estoque: fatoMovimentoEstoqueTeste
};
const nomesGoldTeste = [
  'kpi_vendas_diario',
  'kpi_faturamento_diario',
  'kpi_pedidos_pagos_diario',
  'risco_ruptura_produto',
  'kpi_estoque_diario',
  'painel_executivo_diario'
];
const catalogoGold = Object.fromEntries(
  nomesGoldTeste.map((nome) => [nome, catalogoGoldCompleto[nome]])
);

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

async function criarFatoPedidoSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_pedido',
    'dt_processamento=2026-07-19', 'execucao=20260719T120110000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1, 101::BIGINT, DATE '2026-07-17', 'PEDIDO', true, true, false, true, false, false, false, 10, 100::DECIMAL(18,2)),
        (1, 102::BIGINT, DATE '2026-07-17', 'FATURADO', true, true, false, false, true, false, false, 11, 200::DECIMAL(18,2)),
        (1, 103::BIGINT, DATE '2026-07-17', 'CANCELADO', true, false, true, false, false, false, false, 12, 50::DECIMAL(18,2)),
        (1, 105::BIGINT, DATE '2026-07-18', 'FATURADO', true, true, false, false, true, false, false, 10, 300::DECIMAL(18,2))
      ) AS dados(
        id_empresa, id_pedido_vda_importado, data_pedido, tipo_pedido,
        pedido_recebido, pedido_valido, pedido_cancelado, pedido_pendente,
        pedido_faturado, pedido_devolvido, conflito_status, id_cliente,
        valor_pedido
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_pedido', status: 'sucesso',
    inicio: '2026-07-19T12:01:10.000Z', fim: '2026-07-19T12:01:20.000Z',
    totalLinhas: 4, checksum: 'teste-pedido', arquivo: 'dados.parquet'
  }));
}

async function criarFatoNotaFiscalSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_nota_fiscal',
    'dt_processamento=2026-07-19', 'execucao=20260719T120120000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (2::BIGINT, 2, DATE '2026-07-17', DATE '2026-07-18', 11, 200::DECIMAL(18,2), true),
        (5::BIGINT, 3, DATE '2026-07-18', DATE '2026-07-18', 10, 300::DECIMAL(18,2), true)
      ) AS dados(
        id_nota_saida, id_nr_nf, data_pedido, data_emissao, id_cliente,
        valor_total_venda, faturamento_valido
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_nota_fiscal', status: 'sucesso',
    inicio: '2026-07-19T12:01:20.000Z', fim: '2026-07-19T12:01:30.000Z',
    totalLinhas: 2, checksum: 'teste-nf', arquivo: 'dados.parquet'
  }));
}

async function criarFatoPedidoItemSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_pedido_item',
    'dt_processamento=2026-07-19', 'execucao=20260719T120130000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1, 102::BIGINT, 1, DATE '2026-07-17', true, 190::DECIMAL(18,2)),
        (1, 102::BIGINT, 2, DATE '2026-07-17', true, 10::DECIMAL(18,2)),
        (1, 105::BIGINT, 1, DATE '2026-07-18', true, 300::DECIMAL(18,2))
      ) AS dados(
        id_empresa, id_pedido_vda_importado, item, data_pedido,
        pedido_pago, valor_pedido_pago_item
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_pedido_item', status: 'sucesso',
    inicio: '2026-07-19T12:01:30.000Z', fim: '2026-07-19T12:01:40.000Z',
    totalLinhas: 3, checksum: 'teste-pedido-item', arquivo: 'dados.parquet'
  }));
}

async function criarFatoEstoqueAtualSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_estoque_atual',
    'dt_processamento=2026-07-19', 'execucao=20260719T120200000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1, 1, 'Produto em ruptura', 'SKU-1', 'EAN-1', 10, 'Grupo', 20, 'Subgrupo',
         30, 'Marca', 40, 'Categoria', 100::DECIMAL(18,4), 0::DECIMAL(18,2),
         0::DECIMAL(18,4), 0::DECIMAL(18,4), true, true, true,
         TIMESTAMP '2026-07-19 10:00:00'),
        (2, 2, 'Produto alto', 'SKU-2', 'EAN-2', 10, 'Grupo', 20, 'Subgrupo',
         30, 'Marca', 40, 'Categoria', 100::DECIMAL(18,4), 1000::DECIMAL(18,2),
         10::DECIMAL(18,4), 0::DECIMAL(18,4), true, true, true,
         TIMESTAMP '2026-07-19 10:00:00'),
        (3, 3, 'Produto saudável', 'SKU-3', 'EAN-3', 10, 'Grupo', 20, 'Subgrupo',
         30, 'Marca', 40, 'Categoria', 100::DECIMAL(18,4), 10000::DECIMAL(18,2),
         100::DECIMAL(18,4), 0::DECIMAL(18,4), true, true, true,
         TIMESTAMP '2026-07-19 10:00:00'),
        (4, 4, 'Produto sem giro', 'SKU-4', 'EAN-4', 10, 'Grupo', 20, 'Subgrupo',
         30, 'Marca', 40, 'Categoria', 100::DECIMAL(18,4), 0::DECIMAL(18,2),
         0::DECIMAL(18,4), 0::DECIMAL(18,4), true, true, true,
         TIMESTAMP '2026-07-19 10:00:00')
      ) AS dados(
        id_sequencia, id_produto, descricao_produto, sku, ean,
        id_grupo, grupo, id_subgrupo, subgrupo, id_marca, marca,
        id_categoria, categoria, custo_produto_atual, valor_estoque_custo,
        estoque_disponivel, quantidade_reservada,
        empresa_analisada, produto_ativo, envia_site, dthr_atualizacao_estoque
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_estoque_atual', status: 'sucesso',
    inicio: '2026-07-19T12:02:00.000Z', fim: '2026-07-19T12:03:00.000Z',
    totalLinhas: 4, checksum: 'teste-estoque', arquivo: 'dados.parquet'
  }));
}

async function criarFatoMovimentoEstoqueSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_movimento_estoque',
    'dt_processamento=2026-07-19', 'execucao=20260719T120300000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1, 1, DATE '2026-07-18', 30::DECIMAL(18,4), true, true),
        (2, 2, DATE '2026-07-18', 90::DECIMAL(18,4), true, true),
        (3, 3, DATE '2026-07-18', 45::DECIMAL(18,4), true, true)
      ) AS dados(
        id_sequencia, id_produto, data_referencia, quantidade_saida,
        empresa_analisada, movimento_venda
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_movimento_estoque', status: 'sucesso',
    inicio: '2026-07-19T12:03:00.000Z', fim: '2026-07-19T12:04:00.000Z',
    totalLinhas: 3, checksum: 'teste-movimento', arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizLake = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-gold-'));
  await criarFatoVendaSilver();
  await criarFatoVendaItemSilver();
  await criarFatoPedidoSilver();
  await criarFatoNotaFiscalSilver();
  await criarFatoPedidoItemSilver();
  await criarFatoEstoqueAtualSilver();
  await criarFatoMovimentoEstoqueSilver();
  resultados = [];
  for (const [indice, objeto] of ordenarObjetosPorDependencias(nomesGoldTeste).entries()) {
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
    'risco_ruptura_produto',
    'kpi_estoque_diario',
    'painel_executivo_diario'
  ]);
  assert.equal(resultados[0].qualidade.chavesDuplicadas, 0);
  assert.equal(resultados[5].fontesGold.length, 4);
});

test('classifica ruptura atual e cobertura futura de estoque', async () => {
  const resultado = await leitor.consultar('risco_ruptura_produto', {
    colunas: ['id_produto', 'classificacao_risco', 'dias_cobertura'],
    ordenacao: { campo: 'id_produto', direcao: 'asc' },
    limite: 10
  });
  assert.deepEqual(resultado.dados, [
    { id_produto: 1, classificacao_risco: 'RUPTURA_ATUAL', dias_cobertura: 0 },
    { id_produto: 2, classificacao_risco: 'ALTO', dias_cobertura: 10 },
    { id_produto: 3, classificacao_risco: 'SAUDAVEL', dias_cobertura: 200 },
    { id_produto: 4, classificacao_risco: 'SEM_ESTOQUE_SEM_GIRO', dias_cobertura: null }
  ]);
});

test('registra fotografia diaria de rupturas e marca mais afetada', async () => {
  const resultado = await leitor.consultar('kpi_estoque_diario', {
    colunas: [
      'data_referencia',
      'produtos_elegiveis_estoque',
      'produtos_ruptura_atual',
      'produtos_risco_alto',
      'produtos_alerta_30d',
      'marca_mais_alertas',
      'produtos_alerta_marca_lider'
    ],
    limite: 1
  });
  assert.deepEqual(resultado.dados[0], {
    data_referencia: new Date('2026-07-18T00:00:00.000Z'),
    produtos_elegiveis_estoque: 4n,
    produtos_ruptura_atual: 1n,
    produtos_risco_alto: 1n,
    produtos_alerta_30d: 2n,
    marca_mais_alertas: 'Marca',
    produtos_alerta_marca_lider: 2n
  });
});

test('inclui a fotografia de estoque no painel executivo do mesmo dia', async () => {
  const resultado = await leitor.consultar('painel_executivo_diario', {
    filtros: { data_referencia: '2026-07-18' },
    colunas: [
      'produtos_ruptura_atual',
      'produtos_risco_critico',
      'produtos_risco_alto',
      'produtos_risco_medio',
      'produtos_alerta_30d',
      'marca_mais_alertas'
    ],
    limite: 1
  });
  assert.deepEqual(resultado.dados[0], {
    produtos_ruptura_atual: 1n,
    produtos_risco_critico: 0n,
    produtos_risco_alto: 1n,
    produtos_risco_medio: 0n,
    produtos_alerta_30d: 2n,
    marca_mais_alertas: 'Marca'
  });
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

test('tool painel inclui o bloco de estoque atual com data propria', async () => {
  const resposta = JSON.parse(await executarAnalisarIndicadores({
    operacao: 'painel',
    metricas: null,
    data_inicial: null,
    data_final: null,
    limite: 7
  }, {
    criarLeitor: () => criarLeitorGold({ raizLake, catalogo: catalogoGold })
  }));
  assert.equal(resposta.estoque_atual.produtos_ruptura_atual, '1');
  assert.equal(resposta.estoque_atual.produtos_alerta_30d, '2');
  assert.equal(resposta.estoque_atual.marca_mais_alertas, 'Marca');
  assert.equal(
    resposta.estoque_atual.data_referencia,
    '2026-07-18T00:00:00.000Z'
  );
});

test('resumo recente sem datas e tratado como painel administrativo completo', async () => {
  const resposta = JSON.parse(await executarAnalisarIndicadores({
    operacao: 'resumir',
    metricas: null,
    data_inicial: null,
    data_final: null,
    recencia: 'mais_recente_completo',
    limite: 1
  }, {
    criarLeitor: () => criarLeitorGold({ raizLake, catalogo: catalogoGold })
  }));
  assert.equal(resposta.operacao, 'painel');
  assert.ok(resposta.estoque_atual);
  assert.notEqual(resposta.dados, null);
});

test('painel posterior a cobertura recua explicitamente para o ultimo dia disponivel', async () => {
  const resposta = JSON.parse(await executarAnalisarIndicadores({
    operacao: 'painel',
    metricas: null,
    data_inicial: '2026-07-19',
    data_final: '2026-07-19',
    limite: 1
  }, {
    criarLeitor: () => criarLeitorGold({ raizLake, catalogo: catalogoGold })
  }));
  assert.equal(resposta.dados.data_referencia, '2026-07-18T00:00:00.000Z');
  assert.deepEqual(resposta.ajuste_cobertura, {
    data_solicitada: '2026-07-19',
    data_utilizada: '2026-07-18',
    motivo: 'data solicitada posterior a ultima data comercial disponivel'
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
