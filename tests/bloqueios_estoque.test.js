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
const { construirGold } = require('../gold/core/executar');
const bloqueioItem = require('../gold/modelos/estoque/bloqueio_sem_estoque_item');
const bloqueioPedido = require('../gold/modelos/estoque/bloqueio_sem_estoque_pedido');
const entidadeBloqueioNota = require(
  '../exportadores/postgres/entidades/nota_saida_bloqueada'
);
const entidadeItemNota = require(
  '../exportadores/postgres/entidades/nota_saida_itens'
);
const {
  obterBloqueiosSemEstoque
} = require('../tools/consultar_bloqueios_sem_estoque');
const {
  classificarProduto,
  DIAS_REPOSICAO_PROXIMA,
  executarDiagnosticarBloqueioSemEstoque
} = require('../tools/diagnosticar_bloqueio_sem_estoque');

const fatoBloqueioTeste = {
  nome: 'fato_nota_saida_bloqueio_item',
  chavePrimaria: [
    'id_nota_saida', 'id_bloqueio', 'id_empresa', 'sequencia_ocorrencia'
  ],
  consulta: { colunasPadrao: ['id_nota_saida'] }
};
const catalogoSilver = {
  fato_nota_saida_bloqueio_item: fatoBloqueioTeste
};
const catalogoGold = {
  bloqueio_sem_estoque_item: bloqueioItem,
  bloqueio_sem_estoque_pedido: bloqueioPedido
};

function dataNegocio(deslocamento = 0) {
  const agora = new Date();
  agora.setUTCDate(agora.getUTCDate() + deslocamento);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}

let raizLake;
let leitor;

async function criarFonteSilver() {
  const diretorio = path.join(
    raizLake, 'silver', 'fato_nota_saida_bloqueio_item',
    'dt_processamento=2026-08-10', 'execucao=20260810T120000000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet')
    .replace(/\\/g, '/')
    .replace(/'/g, "''");
  const hoje = dataNegocio();
  const amanha = dataNegocio(1);
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1::BIGINT,58::BIGINT,10::BIGINT,1::BIGINT,'PED-1',100::BIGINT,true,
         'SKU-1','EAN-1','Produto comum',2::DECIMAL(15,4),'AMAZON',
         DATE '${amanha}',TIMESTAMP '2026-08-10 08:00:00','SEM ESTOQUE',true,1,true),
        (2::BIGINT,58::BIGINT,10::BIGINT,1::BIGINT,'PED-MELI-FUTURO',101::BIGINT,true,
         'SKU-2','EAN-2','Meli futuro',1::DECIMAL(15,4),'Meli Coletas EXT',
         DATE '${amanha}',TIMESTAMP '2026-08-10 08:01:00','SEM ESTOQUE',true,1,true),
        (3::BIGINT,58::BIGINT,10::BIGINT,1::BIGINT,'PED-MELI-HOJE',102::BIGINT,true,
         'SKU-3','EAN-3','Meli hoje',1::DECIMAL(15,4),'Meli Coletas EXT',
         DATE '${hoje}',TIMESTAMP '2026-08-10 08:02:00','SEM ESTOQUE',true,1,true),
        (4::BIGINT,58::BIGINT,10::BIGINT,7::BIGINT,'PED-SEM-PRODUTO',0::BIGINT,false,
         NULL,NULL,NULL,NULL,'AMAZON',DATE '${amanha}',
         TIMESTAMP '2026-08-10 08:03:00','SEM ESTOQUE',true,1,true),
        (5::BIGINT,58::BIGINT,10::BIGINT,1::BIGINT,'PED-TIPO-ERRADO',103::BIGINT,true,
         'SKU-5','EAN-5','Tipo errado',1::DECIMAL(15,4),'AMAZON',
         DATE '${amanha}',TIMESTAMP '2026-08-10 08:04:00','SEM ESTOQUE',true,4,true)
      ) AS dados(
        id_nota_saida,id_bloqueio,id_empresa,sequencia_ocorrencia,
        marketplace_pedido,id_produto,produto_cadastrado,sku,ean,
        descricao_produto,quantidade_pedida,canal_venda,dt_limite_expedicao,
        dthr_bloqueio,descricao_bloqueio,bloqueio_ativo,id_tp_pedido,
        pedido_bloqueado
      )
    ) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    objeto: 'fato_nota_saida_bloqueio_item',
    status: 'sucesso',
    fim: '2026-08-10T12:00:00.000Z',
    totalLinhas: 5,
    checksum: 'teste',
    arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizLake = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-bloqueios-'));
  await criarFonteSilver();
  await construirGold(bloqueioItem, {
    raizLake,
    catalogoSilver,
    catalogoGold,
    agora: new Date('2026-08-10T12:01:00Z')
  });
  await construirGold(bloqueioPedido, {
    raizLake,
    catalogoSilver,
    catalogoGold,
    agora: new Date('2026-08-10T12:02:00Z')
  });
  leitor = criarLeitorGold({ raizLake, catalogo: catalogoGold });
});

test.after(async () => {
  await leitor?.fechar();
  await fs.rm(raizLake, { recursive: true, force: true, maxRetries: 10 });
});

test('aplica bloqueio 58 e excecao temporal de MELI deterministicamente', async () => {
  const resultado = await leitor.consultar('bloqueio_sem_estoque_item', {
    colunas: [
      'marketplace_pedido', 'id_produto',
      'canal_meli_coleta_ext', 'meli_incluido_por_limite_hoje'
    ],
    ordenacao: { campo: 'marketplace_pedido', direcao: 'asc' },
    limite: 20
  });
  assert.deepEqual(
    resultado.dados.map((linha) => linha.marketplace_pedido),
    ['PED-1', 'PED-MELI-HOJE', 'PED-SEM-PRODUTO']
  );
  assert.equal(
    resultado.dados.find((linha) => linha.marketplace_pedido === 'PED-MELI-HOJE')
      .meli_incluido_por_limite_hoje,
    true
  );
  assert.equal(
    resultado.dados.find((linha) => linha.marketplace_pedido === 'PED-SEM-PRODUTO')
      .id_produto,
    0n
  );
});

test('consolida quantidade de pedidos sem confundir com ocorrencias', async () => {
  const pedidos = await leitor.contar('bloqueio_sem_estoque_pedido');
  const ocorrencias = await leitor.contar('bloqueio_sem_estoque_item');
  assert.equal(pedidos.total, 3n);
  assert.equal(ocorrencias.total, 3n);
});

test('mantem os graos reais das origens auditadas', () => {
  assert.deepEqual(entidadeItemNota.extracao.chavePrimaria, [
    'id_nota_saida', 'item'
  ]);
  assert.deepEqual(entidadeBloqueioNota.extracao.chavePrimaria, [
    'id_nota_saida', 'id_bloqueio', 'id_empresa', 'id_sequencia'
  ]);
});

test('tool resume pedidos e ocorrencias como metricas diferentes', async () => {
  const resumo = await obterBloqueiosSemEstoque({
    operacao: 'resumir',
    marketplace_pedido: null,
    id_nota_saida: null,
    limite: 10
  }, {
    criarLeitorGold: () => criarLeitorGold({ raizLake, catalogo: catalogoGold })
  });
  assert.equal(resumo.descricao_bloqueio, 'PRODUTOS SEM ESTOQUE');
  assert.equal(resumo.quantidade_pedidos, 3n);
  assert.equal(resumo.quantidade_ocorrencias, 3n);
});

test('classifica estoque e distancia da reposicao sem depender do LLM', () => {
  assert.equal(classificarProduto({
    estoqueEncontrado: true,
    estoqueDisponivel: 5,
    quantidadePedida: 2,
    reposicao: null,
    thorpeEncontrado: true,
    estoqueThorpe: 3
  }), 'estoque_suficiente_bloqueio_possivelmente_desatualizado');
  assert.equal(classificarProduto({
    estoqueEncontrado: true,
    estoqueDisponivel: 0,
    quantidadePedida: 2,
    reposicao: { dias_ate_chegada: DIAS_REPOSICAO_PROXIMA },
    thorpeEncontrado: true,
    estoqueThorpe: 0
  }), 'falta_confirmada_com_reposicao_proxima');
  assert.equal(classificarProduto({
    estoqueEncontrado: true,
    estoqueDisponivel: 0,
    quantidadePedida: 2,
    reposicao: { dias_ate_chegada: DIAS_REPOSICAO_PROXIMA + 1 },
    thorpeEncontrado: true,
    estoqueThorpe: 0
  }), 'falta_confirmada_com_reposicao_distante');
  assert.equal(classificarProduto({
    estoqueEncontrado: true,
    estoqueDisponivel: 0,
    quantidadePedida: 2,
    reposicao: null,
    thorpeEncontrado: true,
    estoqueThorpe: 0
  }), 'falta_confirmada_sem_reposicao_prevista');
  assert.equal(classificarProduto({
    estoqueEncontrado: true,
    estoqueDisponivel: 0,
    quantidadePedida: 2,
    reposicao: null,
    thorpeEncontrado: true,
    estoqueThorpe: 5
  }), 'divergencia_erp_cd');
  assert.equal(classificarProduto({
    estoqueEncontrado: true,
    estoqueDisponivel: 0,
    quantidadePedida: 2,
    reposicao: null,
    thorpeEncontrado: false,
    estoqueThorpe: null
  }), 'diagnostico_parcial');
});

test('diagnostico cruza o codigo auxiliar com estoque Thorpe', async () => {
  const skusConsultados = [];
  const criarLeitorGoldFalso = () => ({
    async consultar(objeto) {
      if (objeto === 'bloqueio_sem_estoque_item') {
        return {
          dados: [{
            id_nota_saida: 10,
            marketplace_pedido: 'PED-10',
            id_produto: 100,
            sku: 'SKU-100',
            descricao_produto: 'Produto teste',
            quantidade_pedida: 4
          }],
          ultimaConstrucao: '2026-08-10T12:00:00Z'
        };
      }
      assert.equal(objeto, 'risco_ruptura_produto');
      return {
        dados: [{
          id_produto: 100,
          sku: 'SKU-100',
          descricao_produto: 'Produto teste',
          estoque_disponivel: 0,
          quantidade_reservada: 0,
          classificacao_risco: 'RUPTURA_ATUAL'
        }]
      };
    },
    async fechar() {}
  });
  const resultado = JSON.parse(await executarDiagnosticarBloqueioSemEstoque({
    marketplace_pedido: 'PED-10',
    id_nota_saida: null
  }, {
    criarLeitorGold: criarLeitorGoldFalso,
    clienteThorpe: {
      async consultarEstoque(sku) {
        skusConsultados.push(sku);
        return {
          sku,
          disponivel: 3,
          pulmao: 2,
          total_utilizavel: 5,
          lotes_considerados: 2
        };
      }
    },
    executarAnalisarReposicoes: async () => JSON.stringify({ dados: [] }),
    agora: new Date('2026-08-10T12:00:00Z')
  }));
  assert.deepEqual(skusConsultados, ['SKU-100']);
  assert.equal(resultado.classificacao, 'divergencia_erp_cd');
  assert.equal(resultado.produtos[0].estoque_cd_thorpe.disponivel, 3);
  assert.equal(resultado.produtos[0].estoque_cd_thorpe.pulmao, 2);
  assert.equal(resultado.produtos[0].estoque_cd_thorpe.cobre_quantidade, true);
});
