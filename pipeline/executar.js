const path = require('node:path');

const { entidades: catalogoBronzePadrao } = require('../exportadores/catalogo');
const { exportarPostgres } = require('../exportadores/postgres/exportar');
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

const ADAPTADORES_FONTE = Object.freeze({
  postgres: exportarPostgres
});

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

async function executarPipeline(opcoes = {}, dependencias = {}) {
  const raizLake = path.resolve(opcoes.raizLake || path.join(__dirname, '..', 'lake'));
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
    versao: 1,
    id: criarIdExecucao(agora),
    status: 'executando',
    modo: plano.modo,
    iniciadoEm: agora.toISOString(),
    finalizadoEm: null,
    plano,
    etapas: [],
    erro: null
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
    const adaptadores = dependencias.adaptadoresFonte || ADAPTADORES_FONTE;
    for (const etapa of plano.etapas.bronze) {
      const entidade = catalogoBronze[etapa.nome];
      await executarEtapa(execucao, etapa, async () => {
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
      }, onEvento);
      await salvarRun(raizLake, execucao);
    }

    const catalogoSilver = dependencias.catalogoSilver || catalogoSilverPadrao;
    const construirObjetoSilver = dependencias.construirSilver || construirSilver;
    for (const etapa of plano.etapas.silver) {
      await executarEtapa(
        execucao,
        etapa,
        () => construirObjetoSilver(catalogoSilver[etapa.nome], { raizLake }),
        onEvento
      );
      await salvarRun(raizLake, execucao);
    }

    const catalogoGold = dependencias.catalogoGold || catalogoGoldPadrao;
    const construirObjetoGold = dependencias.construirGold || construirGold;
    for (const etapa of plano.etapas.gold) {
      await executarEtapa(
        execucao,
        etapa,
        () => construirObjetoGold(catalogoGold[etapa.nome], { raizLake }),
        onEvento
      );
      await salvarRun(raizLake, execucao);
    }

    execucao.status = 'sucesso';
    execucao.finalizadoEm = new Date().toISOString();
    execucao.duracaoMs = Date.now() - inicioExecucaoMs;
    await salvarRun(raizLake, execucao);
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
