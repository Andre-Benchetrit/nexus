const fs = require('node:fs/promises');
const path = require('node:path');

const { entidades: catalogoBronzePadrao } = require('../exportadores/catalogo');
const {
  objetos: catalogoSilverPadrao,
  ordenarObjetosPorDependencias: ordenarSilverPadrao
} = require('../silver/catalogo');
const {
  objetos: catalogoGoldPadrao,
  ordenarObjetosPorDependencias: ordenarGoldPadrao
} = require('../gold/catalogo');

const FUSO_NEGOCIO = 'America/Sao_Paulo';
const CAMADAS_VALIDAS = Object.freeze(['bronze', 'silver', 'gold']);

function dataNoFuso(data = new Date(), fuso = FUSO_NEGOCIO) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(data);
  const porTipo = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${porTipo.year}-${porTipo.month}-${porTipo.day}`;
}

function validarDataISO(valor, rotulo) {
  const texto = String(valor || '');
  const data = new Date(`${texto}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(texto) ||
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== texto
  ) {
    throw new Error(`${rotulo} deve usar AAAA-MM-DD.`);
  }
  return texto;
}

function deslocarData(valor, dias) {
  const data = new Date(`${validarDataISO(valor, 'data')}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

async function listarArquivos(diretorio, nome) {
  let entradas;
  try {
    entradas = await fs.readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT') return [];
    throw erro;
  }
  const encontrados = [];
  for (const entrada of entradas) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...await listarArquivos(caminho, nome));
    else if (entrada.isFile() && entrada.name === nome) encontrados.push(caminho);
  }
  return encontrados;
}

async function obterUltimoFimExportado(raizLake, entidade) {
  const raiz = path.join(raizLake, 'bronze', entidade.fonte, entidade.nome);
  const manifestos = await listarArquivos(raiz, 'manifest.json');
  let maior = null;
  for (const caminho of manifestos) {
    const manifesto = JSON.parse(await fs.readFile(caminho, 'utf8'));
    const fim = manifesto.status === 'sucesso' ? manifesto.janela?.fim : null;
    if (fim && (!maior || fim > maior)) maior = fim;
  }
  return maior;
}

function normalizarLista(valor) {
  if (valor == null) return null;
  const itens = Array.isArray(valor) ? valor : String(valor).split(',');
  return [...new Set(itens.map((item) => String(item).trim()).filter(Boolean))];
}

function selecionarCatalogo(catalogo, nomes, rotulo) {
  const selecionados = normalizarLista(nomes);
  if (!selecionados) return Object.values(catalogo);
  return selecionados.map((nome) => {
    if (!catalogo[nome]) throw new Error(`${rotulo} desconhecido: ${nome}.`);
    return catalogo[nome];
  });
}

function validarCamadas(valor) {
  const camadas = normalizarLista(valor) || [...CAMADAS_VALIDAS];
  for (const camada of camadas) {
    if (!CAMADAS_VALIDAS.includes(camada)) {
      throw new Error(`Camada invalida: ${camada}. Use ${CAMADAS_VALIDAS.join(', ')}.`);
    }
  }
  return camadas;
}

async function planejarBronze(entidades, contexto) {
  const etapas = [];
  for (const entidade of entidades) {
    if (entidade.automacao?.habilitada === false) {
      etapas.push({
        camada: 'bronze',
        nome: entidade.nome,
        fonte: entidade.fonte,
        acao: 'ignorar',
        motivo: 'automacao desabilitada no catalogo'
      });
      continue;
    }

    const modo = entidade.extracao?.modo || 'snapshot';
    if (modo !== 'incremental_data') {
      etapas.push({
        camada: 'bronze',
        nome: entidade.nome,
        fonte: entidade.fonte,
        modo,
        acao: 'exportar',
        forcar: contexto.forcar
      });
      continue;
    }

    const fimManifesto = await contexto.obterUltimoFimExportado(
      contexto.raizLake,
      entidade
    );
    const fimEstado = contexto.estado.entidades?.[entidade.nome]?.fim || null;
    const inicioBase = contexto.inicio || fimEstado || fimManifesto;
    if (!inicioBase) {
      etapas.push({
        camada: 'bronze',
        nome: entidade.nome,
        fonte: entidade.fonte,
        modo,
        acao: 'erro',
        motivo: 'primeira carga incremental exige --inicio'
      });
      continue;
    }

    const inicio = contexto.incluirHoje && !contexto.inicio
      ? deslocarData(inicioBase, -contexto.sobreposicaoDias)
      : inicioBase;
    if (inicio >= contexto.fim) {
      etapas.push({
        camada: 'bronze',
        nome: entidade.nome,
        fonte: entidade.fonte,
        modo,
        acao: 'ignorar',
        inicio,
        fim: contexto.fim,
        motivo: 'janela ja esta atualizada'
      });
      continue;
    }
    etapas.push({
      camada: 'bronze',
      nome: entidade.nome,
      fonte: entidade.fonte,
      modo,
      acao: 'exportar',
      inicio,
      fim: contexto.fim,
      watermarkBase: inicioBase,
      forcar: contexto.forcar || contexto.incluirHoje,
      avancarWatermark: !contexto.incluirHoje
    });
  }
  return etapas;
}

async function criarPlanoPipeline(opcoes = {}, dependencias = {}) {
  const agora = opcoes.agora || new Date();
  const raizLake = path.resolve(opcoes.raizLake || path.join(__dirname, '..', 'lake'));
  const hoje = dataNoFuso(agora, opcoes.fuso || FUSO_NEGOCIO);
  const incluirHoje = opcoes.incluirHoje === true;
  const fim = validarDataISO(
    opcoes.fim || (incluirHoje ? deslocarData(hoje, 1) : hoje),
    'fim'
  );
  const inicio = opcoes.inicio ? validarDataISO(opcoes.inicio, 'inicio') : null;
  if (inicio && inicio >= fim) throw new Error('inicio deve ser anterior a fim.');
  const sobreposicaoDias = Number(opcoes.sobreposicaoDias ?? 2);
  if (!Number.isInteger(sobreposicaoDias) || sobreposicaoDias < 0 || sobreposicaoDias > 30) {
    throw new Error('sobreposicaoDias deve ser inteiro entre 0 e 30.');
  }

  const camadas = validarCamadas(opcoes.camadas);
  const catalogoBronze = dependencias.catalogoBronze || catalogoBronzePadrao;
  const catalogoSilver = dependencias.catalogoSilver || catalogoSilverPadrao;
  const catalogoGold = dependencias.catalogoGold || catalogoGoldPadrao;
  const estado = dependencias.estado || { versao: 1, entidades: {} };
  const obterFim = dependencias.obterUltimoFimExportado || obterUltimoFimExportado;

  const bronze = camadas.includes('bronze')
    ? await planejarBronze(
      selecionarCatalogo(catalogoBronze, opcoes.entidades, 'Entidade Bronze'),
      {
        raizLake,
        estado,
        inicio,
        fim,
        incluirHoje,
        sobreposicaoDias,
        forcar: opcoes.forcar === true,
        obterUltimoFimExportado: obterFim
      }
    )
    : [];

  const nomesSilver = normalizarLista(opcoes.objetosSilver);
  const ordenarSilver = dependencias.ordenarSilver || ordenarSilverPadrao;
  const silver = camadas.includes('silver')
    ? (
      nomesSilver
        ? ordenarSilver(nomesSilver)
        : ordenarSilver()
    ).map((objeto) => ({
      camada: 'silver',
      nome: objeto.nome,
      tipo: objeto.tipo,
      acao: 'construir'
    }))
    : [];

  const nomesGold = normalizarLista(opcoes.objetosGold);
  const ordenarGold = dependencias.ordenarGold || ordenarGoldPadrao;
  const gold = camadas.includes('gold')
    ? (
      nomesGold
        ? ordenarGold(nomesGold)
        : ordenarGold()
    ).map((objeto) => ({
      camada: 'gold',
      nome: objeto.nome,
      tipo: objeto.tipo,
      acao: 'construir'
    }))
    : [];

  return {
    versao: 1,
    criadoEm: agora.toISOString(),
    fuso: opcoes.fuso || FUSO_NEGOCIO,
    modo: incluirHoje ? 'intradiario_sobreposto' : 'dias_completos',
    hoje,
    janelaPadrao: { inicio, fim },
    sobreposicaoDias: incluirHoje ? sobreposicaoDias : 0,
    camadas,
    etapas: { bronze, silver, gold }
  };
}

module.exports = {
  CAMADAS_VALIDAS,
  FUSO_NEGOCIO,
  criarPlanoPipeline,
  dataNoFuso,
  deslocarData,
  normalizarLista,
  obterUltimoFimExportado,
  validarDataISO
};
