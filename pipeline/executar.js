const path = require('node:path');
const { resolverRaizLake } = require('../nexus/lake_storage');

const { entidades: catalogoBronzePadrao } = require('../exportadores/catalogo');
const { ADAPTADORES_FONTE } = require('../exportadores/adaptadores');
const { objetos: catalogoSilverPadrao } = require('../silver/catalogo');
const { construirSilver } = require('../silver/core/executar');
const { objetos: catalogoGoldPadrao } = require('../gold/catalogo');
const { construirGold } = require('../gold/core/executar');
const { criarPlanoPipeline } = require('./planejador');
const {
  adquirirTrava,
  lerEstado,
  liberarTrava,
  salvarEstado,
  salvarExecucao
} = require('./controle');

function criarIdExecucao(data = new Date()) {
  return `${data.toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
}

function erroResumido(erro) {
  return {
    mensagem: erro.message,
    codigo: erro.code || null
  };
}

async function executarEtapa(execucao, etapa, operacao, onEvento) {
  if (etapa.acao === 'ignorar') {
    const registro = {
      ...etapa,
      status: 'ignorada',
      iniciadoEm: new Date().toISOString(),
      finalizadoEm: new Date().toISOString()
    };
    execucao.etapas.push(registro);
    onEvento?.(`[${etapa.camada}/${etapa.nome}] Ignorada: ${etapa.motivo}.`);
    return { registro, resultado: null };
  }

  const registro = {
    ...etapa,
    status: 'executando',
    iniciadoEm: new Date().toISOString()
  };
  execucao.etapas.push(registro);
  onEvento?.(`[${etapa.camada}/${etapa.nome}] Iniciando...`);
  const inicioMs = Date.now();
  try {
    const resultado = await operacao();
    Object.assign(registro, {
      status: 'sucesso',
      finalizadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - inicioMs,
      totalLinhas: Number(resultado?.totalLinhas ?? 0),
      checksum: resultado?.checksum || null
    });
    onEvento?.(
      `[${etapa.camada}/${etapa.nome}] Concluida em ${registro.duracaoMs} ms ` +
      `(${registro.totalLinhas} linhas).`
    );
    return { registro, resultado };
  } catch (erro) {
    Object.assign(registro, {
      status: 'erro',
      finalizadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - inicioMs,
      erro: erroResumido(erro)
    });
    onEvento?.(`[${etapa.camada}/${etapa.nome}] Falhou: ${erro.message}`);
    throw erro;
  }
}

function chaveEtapa(camada, nome) {
  return `${camada}:${nome}`;
}

function listarDependencias(etapa, catalogos) {
  if (etapa.dependencias) {
    return Object.entries(etapa.dependencias).flatMap(([camada, nomes]) => (
      (nomes || []).map((nome) => ({ camada, nome }))
    ));
  }
  if (etapa.camada === 'silver') {
    const objeto = catalogos.silver[etapa.nome] || {};
    return [
      ...(objeto.fontesBronze || []).map((nome) => ({ camada: 'bronze', nome })),
      ...(objeto.fontesSilver || []).map((nome) => ({ camada: 'silver', nome }))
    ];
  }
  if (etapa.camada === 'gold') {
    const objeto = catalogos.gold[etapa.nome] || {};
    return [
      ...(objeto.fontesSilver || []).map((nome) => ({ camada: 'silver', nome })),
      ...(objeto.fontesGold || []).map((nome) => ({ camada: 'gold', nome }))
    ];
  }
  return [];
}

function registrarEtapaBloqueada(execucao, etapa, bloqueios, onEvento) {
  const agora = new Date().toISOString();
  const registro = {
    ...etapa,
    status: 'bloqueada',
    bloqueadaPor: bloqueios,
    motivo: `dependencias sem sucesso: ${bloqueios.map((item) => item.chave).join(', ')}`,
    iniciadoEm: agora,
    finalizadoEm: agora
  };
  execucao.etapas.push(registro);
  onEvento?.(`[${etapa.camada}/${etapa.nome}] Bloqueada por ${registro.motivo}.`);
  return registro;
}

function resumirStatusExecucao(execucao) {
  const falhas = execucao.etapas.filter((item) => item.status === 'erro');
  const bloqueios = execucao.etapas.filter((item) => item.status === 'bloqueada');
  const sucessos = execucao.etapas.filter((item) => item.status === 'sucesso');
  execucao.falhas = falhas.map((item) => ({
    etapa: chaveEtapa(item.camada, item.nome),
    erro: item.erro
  }));
  execucao.bloqueios = bloqueios.map((item) => ({
    etapa: chaveEtapa(item.camada, item.nome),
    bloqueadaPor: item.bloqueadaPor
  }));
  if (!falhas.length && !bloqueios.length) return 'sucesso';
  return sucessos.length ? 'parcial' : 'erro';
}

async function executarPipeline(opcoes = {}, dependencias = {}) {
  const raizLake = resolverRaizLake(opcoes);
  const estado = dependencias.estado || await (dependencias.lerEstado || lerEstado)(raizLake);
  const plano = await (dependencias.criarPlano || criarPlanoPipeline)(
    { ...opcoes, raizLake },
    { ...dependencias, estado }
  );
  if (opcoes.dryRun) return { plano, execucao: null };

  const errosPlanejamento = plano.etapas.bronze.filter((etapa) => etapa.acao === 'erro');
  if (errosPlanejamento.length) {
    throw new Error(
      errosPlanejamento.map((etapa) => `${etapa.nome}: ${etapa.motivo}`).join('; ')
    );
  }

  const agora = opcoes.agora || new Date();
  const execucao = {
    versao: 2,
    id: criarIdExecucao(agora),
    status: 'executando',
    modo: plano.modo,
    iniciadoEm: agora.toISOString(),
    finalizadoEm: null,
    plano,
    etapas: [],
    erro: null,
    falhas: [],
    bloqueios: []
  };
  const salvarRun = dependencias.salvarExecucao || salvarExecucao;
  const salvarWatermark = dependencias.salvarEstado || salvarEstado;
  const adquirir = dependencias.adquirirTrava || adquirirTrava;
  const liberar = dependencias.liberarTrava || liberarTrava;
  const onEvento = opcoes.onEvento;
  const inicioExecucaoMs = Date.now();
  let trava;

  try {
    trava = await adquirir(raizLake, {
      id: execucao.id,
      pid: process.pid,
      iniciadoEm: execucao.iniciadoEm
    });
    await salvarRun(raizLake, execucao);

    const catalogoBronze = dependencias.catalogoBronze || catalogoBronzePadrao;
    const catalogoSilver = dependencias.catalogoSilver || catalogoSilverPadrao;
    const catalogoGold = dependencias.catalogoGold || catalogoGoldPadrao;
    const catalogos = {
      bronze: catalogoBronze,
      silver: catalogoSilver,
      gold: catalogoGold
    };
    const etapasPlanejadas = new Set(
      Object.values(plano.etapas).flat().map((item) => chaveEtapa(item.camada, item.nome))
    );
    const statusEtapas = new Map();
    const executarComContinuidade = async (etapa, operacao) => {
      const bloqueios = listarDependencias(etapa, catalogos)
        .map(({ camada, nome }) => ({
          chave: chaveEtapa(camada, nome),
          status: statusEtapas.get(chaveEtapa(camada, nome))
        }))
        .filter((item) => (
          etapasPlanejadas.has(item.chave) &&
          ['erro', 'bloqueada'].includes(item.status)
        ));
      if (bloqueios.length) {
        const registro = registrarEtapaBloqueada(execucao, etapa, bloqueios, onEvento);
        statusEtapas.set(chaveEtapa(etapa.camada, etapa.nome), registro.status);
        await salvarRun(raizLake, execucao);
        return registro;
      }
      try {
        const { registro } = await executarEtapa(execucao, etapa, operacao, onEvento);
        statusEtapas.set(chaveEtapa(etapa.camada, etapa.nome), registro.status);
        await salvarRun(raizLake, execucao);
        return registro;
      } catch (_) {
        const registro = execucao.etapas.at(-1);
        statusEtapas.set(chaveEtapa(etapa.camada, etapa.nome), 'erro');
        await salvarRun(raizLake, execucao);
        return registro;
      }
    };
    const adaptadores = dependencias.adaptadoresFonte || ADAPTADORES_FONTE;
    for (const etapa of plano.etapas.bronze) {
      const entidade = catalogoBronze[etapa.nome];
      await executarComContinuidade(etapa, async () => {
        const exportar = adaptadores[entidade.fonte];
        if (!exportar) throw new Error(`Fonte sem adaptador de automacao: ${entidade.fonte}.`);
        const resultado = await exportar(entidade, {
          inicio: etapa.inicio,
          fim: etapa.fim,
          forcar: etapa.forcar
        });
        if (etapa.avancarWatermark) {
          const anterior = estado.entidades?.[entidade.nome]?.fim || null;
          estado.entidades ||= {};
          estado.entidades[entidade.nome] = {
            fim: !anterior || etapa.fim > anterior ? etapa.fim : anterior,
            atualizadoEm: new Date().toISOString(),
            execucao: execucao.id
          };
          estado.atualizadoEm = new Date().toISOString();
          await salvarWatermark(raizLake, estado);
        } else if (!estado.entidades?.[entidade.nome] && etapa.watermarkBase) {
          estado.entidades ||= {};
          estado.entidades[entidade.nome] = {
            fim: etapa.watermarkBase,
            atualizadoEm: new Date().toISOString(),
            execucao: execucao.id,
            observacao: 'watermark inicial preservado durante carga intradiaria'
          };
          estado.atualizadoEm = new Date().toISOString();
          await salvarWatermark(raizLake, estado);
        }
        return resultado;
      });
    }

    const construirObjetoSilver = dependencias.construirSilver || construirSilver;
    for (const etapa of plano.etapas.silver) {
      await executarComContinuidade(
        etapa,
        () => construirObjetoSilver(catalogoSilver[etapa.nome], { raizLake }),
      );
    }

    const construirObjetoGold = dependencias.construirGold || construirGold;
    for (const etapa of plano.etapas.gold) {
      await executarComContinuidade(
        etapa,
        () => construirObjetoGold(catalogoGold[etapa.nome], { raizLake }),
      );
    }

    execucao.status = resumirStatusExecucao(execucao);
    execucao.finalizadoEm = new Date().toISOString();
    execucao.duracaoMs = Date.now() - inicioExecucaoMs;
    await salvarRun(raizLake, execucao);
    if (execucao.status === 'erro') {
      const erro = new Error(
        execucao.falhas.map((item) => `${item.etapa}: ${item.erro.mensagem}`).join('; ') ||
        'Todas as etapas executaveis da pipeline falharam ou foram bloqueadas.'
      );
      erro.execucao = execucao;
      throw erro;
    }
    return { plano, execucao };
  } catch (erro) {
    execucao.status = 'erro';
    execucao.finalizadoEm = new Date().toISOString();
    execucao.duracaoMs = Date.now() - inicioExecucaoMs;
    execucao.erro = erroResumido(erro);
    if (trava) {
      try {
        await salvarRun(raizLake, execucao);
      } catch (_) {
        // Preserva o erro original quando nem o controle local pode ser gravado.
      }
    }
    throw erro;
  } finally {
    await liberar(trava);
  }
}

module.exports = {
  ADAPTADORES_FONTE,
  criarIdExecucao,
  executarEtapa,
  executarPipeline
};
