const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  criarPlanoPipeline,
  dataNoFuso
} = require('../pipeline/planejador');
const {
  caminhosControle,
  lerEstado,
  lerUltimaExecucao
} = require('../pipeline/controle');
const { executarPipeline } = require('../pipeline/executar');
const { lerArgumentos } = require('../scripts/atualizar-lake');

async function diretorioTemporario(t) {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-pipeline-'));
  t.after(async () => fs.rm(diretorio, { recursive: true, force: true }));
  return diretorio;
}

function catalogosTeste() {
  const incremental = {
    nome: 'pedidos',
    fonte: 'postgres',
    extracao: { modo: 'incremental_data' }
  };
  const snapshot = {
    nome: 'produtos',
    fonte: 'postgres',
    extracao: { modo: 'snapshot' }
  };
  const catalogoBronze = { pedidos: incremental, produtos: snapshot };
  const dim = { nome: 'dim_produto', tipo: 'dimensao' };
  const fato = { nome: 'fato_pedido', tipo: 'fato' };
  const catalogoSilver = { dim_produto: dim, fato_pedido: fato };
  const kpi = { nome: 'kpi_pedido', tipo: 'indicador' };
  const painel = { nome: 'painel', tipo: 'painel' };
  const catalogoGold = { kpi_pedido: kpi, painel };
  return {
    catalogoBronze,
    catalogoSilver,
    catalogoGold,
    ordenarSilver: () => [dim, fato],
    ordenarGold: () => [kpi, painel]
  };
}

test('planeja dias completos e descobre objetos pelos catalogos', async () => {
  const catalogos = catalogosTeste();
  const plano = await criarPlanoPipeline({
    agora: new Date('2026-07-27T15:00:00.000Z')
  }, {
    ...catalogos,
    estado: { versao: 1, entidades: { pedidos: { fim: '2026-07-25' } } },
    obterUltimoFimExportado: async () => null
  });

  assert.equal(plano.modo, 'dias_completos');
  assert.deepEqual(
    plano.etapas.bronze.map(({ nome, inicio, fim, acao }) => ({ nome, inicio, fim, acao })),
    [
      { nome: 'pedidos', inicio: '2026-07-25', fim: '2026-07-27', acao: 'exportar' },
      { nome: 'produtos', inicio: undefined, fim: undefined, acao: 'exportar' }
    ]
  );
  assert.deepEqual(plano.etapas.silver.map(({ nome }) => nome), [
    'dim_produto', 'fato_pedido'
  ]);
  assert.deepEqual(plano.etapas.gold.map(({ nome }) => nome), [
    'kpi_pedido', 'painel'
  ]);
});

test('modo intradiario sobrepoe a janela sem avancar o watermark oficial', async () => {
  const catalogos = catalogosTeste();
  const plano = await criarPlanoPipeline({
    agora: new Date('2026-07-27T15:00:00.000Z'),
    incluirHoje: true,
    sobreposicaoDias: 2,
    camadas: 'bronze',
    entidades: 'pedidos'
  }, {
    ...catalogos,
    estado: { versao: 1, entidades: { pedidos: { fim: '2026-07-25' } } },
    obterUltimoFimExportado: async () => null
  });
  const [etapa] = plano.etapas.bronze;
  assert.deepEqual(
    {
      inicio: etapa.inicio,
      fim: etapa.fim,
      forcar: etapa.forcar,
      avancarWatermark: etapa.avancarWatermark,
      watermarkBase: etapa.watermarkBase
    },
    {
      inicio: '2026-07-23',
      fim: '2026-07-28',
      forcar: true,
      avancarWatermark: false,
      watermarkBase: '2026-07-25'
    }
  );
});

test('primeira carga incremental exige inicio explicito', async () => {
  const catalogos = catalogosTeste();
  const plano = await criarPlanoPipeline({
    agora: new Date('2026-07-27T15:00:00.000Z'),
    camadas: 'bronze',
    entidades: 'pedidos'
  }, {
    ...catalogos,
    estado: { versao: 1, entidades: {} },
    obterUltimoFimExportado: async () => null
  });
  assert.equal(plano.etapas.bronze[0].acao, 'erro');
  assert.match(plano.etapas.bronze[0].motivo, /--inicio/);
});

test('executa as camadas em ordem e persiste watermark e auditoria', async (t) => {
  const raizLake = await diretorioTemporario(t);
  const chamadas = [];
  const catalogos = catalogosTeste();
  const plano = {
    versao: 1,
    modo: 'dias_completos',
    etapas: {
      bronze: [{
        camada: 'bronze',
        nome: 'pedidos',
        fonte: 'postgres',
        acao: 'exportar',
        inicio: '2026-07-25',
        fim: '2026-07-27',
        avancarWatermark: true
      }],
      silver: [{ camada: 'silver', nome: 'fato_pedido', acao: 'construir' }],
      gold: [{ camada: 'gold', nome: 'kpi_pedido', acao: 'construir' }]
    }
  };

  const resultado = await executarPipeline({
    raizLake,
    agora: new Date('2026-07-27T15:00:00.000Z')
  }, {
    ...catalogos,
    estado: { versao: 1, atualizadoEm: null, entidades: {} },
    criarPlano: async () => plano,
    adaptadoresFonte: {
      postgres: async () => {
        chamadas.push('bronze');
        return { totalLinhas: 10, checksum: 'b' };
      }
    },
    construirSilver: async () => {
      chamadas.push('silver');
      return { totalLinhas: 9, checksum: 's' };
    },
    construirGold: async () => {
      chamadas.push('gold');
      return { totalLinhas: 1, checksum: 'g' };
    }
  });

  assert.deepEqual(chamadas, ['bronze', 'silver', 'gold']);
  assert.equal(resultado.execucao.status, 'sucesso');
  assert.equal((await lerEstado(raizLake)).entidades.pedidos.fim, '2026-07-27');
  assert.equal((await lerUltimaExecucao(raizLake)).status, 'sucesso');
  await assert.rejects(fs.access(caminhosControle(raizLake).trava));
});

test('falha interrompe dependentes, registra erro e libera a trava', async (t) => {
  const raizLake = await diretorioTemporario(t);
  const chamadas = [];
  const catalogos = catalogosTeste();
  const plano = {
    versao: 1,
    modo: 'dias_completos',
    etapas: {
      bronze: [{
        camada: 'bronze',
        nome: 'pedidos',
        fonte: 'postgres',
        acao: 'exportar',
        inicio: '2026-07-25',
        fim: '2026-07-27'
      }],
      silver: [{ camada: 'silver', nome: 'fato_pedido', acao: 'construir' }],
      gold: []
    }
  };

  await assert.rejects(
    executarPipeline({ raizLake }, {
      ...catalogos,
      estado: { versao: 1, entidades: {} },
      criarPlano: async () => plano,
      adaptadoresFonte: {
        postgres: async () => {
          chamadas.push('bronze');
          throw new Error('origem indisponivel');
        }
      },
      construirSilver: async () => chamadas.push('silver')
    }),
    /origem indisponivel/
  );

  assert.deepEqual(chamadas, ['bronze']);
  assert.equal((await lerUltimaExecucao(raizLake)).status, 'erro');
  await assert.rejects(fs.access(caminhosControle(raizLake).trava));
});

test('interpreta opcoes de automacao pela linha de comando', () => {
  assert.deepEqual(
    lerArgumentos([
      '--incluir-hoje',
      '--camadas', 'bronze,silver',
      '--entidades', 'nota_saida,produto',
      '--sobreposicao-dias', '3',
      '--dry-run'
    ]),
    {
      incluirHoje: true,
      camadas: 'bronze,silver',
      entidades: 'nota_saida,produto',
      sobreposicaoDias: 3,
      dryRun: true
    }
  );
  assert.equal(dataNoFuso(new Date('2026-07-28T01:00:00Z')), '2026-07-27');
});
