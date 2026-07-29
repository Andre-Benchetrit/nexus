const {
  definicaoConsultarBronze,
  executarConsultarBronze
} = require('../tools/consultar_bronze');
const {
  definicaoAgregarBronze,
  executarAgregarBronze
} = require('../tools/agregar_bronze');
const {
  definicaoConsultarSilver,
  executarConsultarSilver
} = require('../tools/consultar_silver');
const {
  definicaoAgregarSilver,
  executarAgregarSilver
} = require('../tools/agregar_silver');
const {
  definicaoAnalisarVendas,
  executarAnalisarVendas
} = require('../tools/analisar_vendas');
const {
  definicaoAnalisarCatalogo,
  executarAnalisarCatalogo
} = require('../tools/analisar_catalogo');
const {
  definicaoAnalisarPessoas,
  executarAnalisarPessoas
} = require('../tools/analisar_pessoas');
const {
  definicaoAnalisarIndicadores,
  executarAnalisarIndicadores
} = require('../tools/analisar_indicadores');
const {
  definicaoAnalisarInfluencias,
  executarAnalisarInfluencias
} = require('../tools/analisar_influencias');
const {
  definicaoAnalisarRupturas,
  executarAnalisarRupturas
} = require('../tools/analisar_rupturas');
const {
  definicaoAnalisarReposicoes,
  executarAnalisarReposicoes
} = require('../tools/analisar_reposicoes');
const {
  definicaoAnalisarDesempenho,
  executarAnalisarDesempenho
} = require('../tools/analisar_desempenho');
const {
  definicaoAnalisarFrete,
  executarAnalisarFrete
} = require('../tools/analisar_frete');
const {
  definicaoAnalisarOperacao,
  executarAnalisarOperacao
} = require('../tools/analisar_operacao');

const FERRAMENTAS_NEGOCIO = Object.freeze([
  'analisar_indicadores',
  'analisar_influencias',
  'analisar_rupturas',
  'analisar_reposicoes',
  'analisar_desempenho',
  'analisar_frete',
  'analisar_operacao',
  'analisar_vendas',
  'analisar_catalogo',
  'analisar_pessoas'
]);

const PERFIL_POR_FERRAMENTA = Object.freeze({
  analisar_indicadores: 'indicadores',
  analisar_influencias: 'influencias',
  analisar_rupturas: 'estoque',
  analisar_reposicoes: 'reposicoes',
  analisar_desempenho: 'desempenho',
  analisar_frete: 'frete',
  analisar_operacao: 'operacao',
  analisar_vendas: 'vendas',
  analisar_catalogo: 'catalogo',
  analisar_pessoas: 'pessoas'
});

const PERFIS_TOOLS = Object.freeze({
  indicadores: ['analisar_indicadores'],
  influencias: ['analisar_influencias'],
  estoque: ['analisar_rupturas'],
  estoque_reposicoes: ['analisar_rupturas', 'analisar_reposicoes'],
  reposicoes: ['analisar_reposicoes'],
  desempenho: ['analisar_desempenho'],
  frete: ['analisar_frete'],
  operacao: ['analisar_operacao'],
  vendas: ['analisar_vendas'],
  catalogo: ['analisar_catalogo'],
  pessoas: ['analisar_pessoas'],
  negocio: ['analisar_vendas', 'analisar_catalogo'],
  hibrido: FERRAMENTAS_NEGOCIO,
  silver: ['consultar_silver', 'agregar_silver'],
  bronze: ['consultar_bronze', 'agregar_bronze'],
  completo: [
    ...FERRAMENTAS_NEGOCIO,
    'consultar_silver', 'agregar_silver',
    'consultar_bronze', 'agregar_bronze'
  ]
});

function criarRegistroFerramentas(dependencias = {}) {
  return new Map([
    ['analisar_indicadores', {
      definicao: definicaoAnalisarIndicadores,
      terminal: true,
      executar: dependencias.executarAnalisarIndicadoresTool || executarAnalisarIndicadores
    }],
    ['analisar_influencias', {
      definicao: definicaoAnalisarInfluencias,
      terminal: true,
      executar: dependencias.executarAnalisarInfluenciasTool || executarAnalisarInfluencias
    }],
    ['analisar_rupturas', {
      definicao: definicaoAnalisarRupturas,
      terminal: true,
      executar: dependencias.executarAnalisarRupturasTool || executarAnalisarRupturas
    }],
    ['analisar_reposicoes', {
      definicao: definicaoAnalisarReposicoes,
      terminal: true,
      executar: dependencias.executarAnalisarReposicoesTool || executarAnalisarReposicoes
    }],
    ['analisar_desempenho', {
      definicao: definicaoAnalisarDesempenho,
      terminal: true,
      executar: dependencias.executarAnalisarDesempenhoTool || executarAnalisarDesempenho
    }],
    ['analisar_frete', {
      definicao: definicaoAnalisarFrete,
      terminal: true,
      executar: dependencias.executarAnalisarFreteTool || executarAnalisarFrete
    }],
    ['analisar_operacao', {
      definicao: definicaoAnalisarOperacao,
      terminal: true,
      executar: dependencias.executarAnalisarOperacaoTool || executarAnalisarOperacao
    }],
    ['analisar_vendas', {
      definicao: definicaoAnalisarVendas,
      terminal: true,
      executar: dependencias.executarAnalisarVendasTool || executarAnalisarVendas
    }],
    ['analisar_catalogo', {
      definicao: definicaoAnalisarCatalogo,
      terminal: true,
      executar: dependencias.executarAnalisarCatalogoTool || executarAnalisarCatalogo
    }],
    ['analisar_pessoas', {
      definicao: definicaoAnalisarPessoas,
      terminal: true,
      executar: dependencias.executarAnalisarPessoasTool || executarAnalisarPessoas
    }],
    ['consultar_silver', {
      definicao: definicaoConsultarSilver,
      executar: dependencias.executarConsultarSilverTool || executarConsultarSilver
    }],
    ['agregar_silver', {
      definicao: definicaoAgregarSilver,
      executar: dependencias.executarAgregarSilverTool || executarAgregarSilver
    }],
    ['consultar_bronze', {
      definicao: definicaoConsultarBronze,
      executar: dependencias.executarTool || executarConsultarBronze
    }],
    ['agregar_bronze', {
      definicao: definicaoAgregarBronze,
      executar: dependencias.executarAgregarTool || executarAgregarBronze
    }]
  ]);
}

function obterFerramentasDoPerfil(perfil, dependencias = {}) {
  const nomes = PERFIS_TOOLS[perfil];
  if (!nomes) throw new Error(`Perfil de tools desconhecido: ${perfil}`);
  const registro = criarRegistroFerramentas(dependencias);
  const permiteMultiplasChamadas = nomes.length > 1;
  return nomes.map((nome) => {
    const ferramenta = registro.get(nome);
    if (permiteMultiplasChamadas) {
      return { ...ferramenta, terminal: false };
    }
    return ferramenta;
  });
}

function obterFerramentaPorNome(nome, dependencias = {}) {
  return criarRegistroFerramentas(dependencias).get(nome) || null;
}

function obterPerfilDaFerramenta(nome) {
  return PERFIL_POR_FERRAMENTA[nome] || null;
}

function ferramentaDeNegocio(nome) {
  return FERRAMENTAS_NEGOCIO.includes(nome);
}

function instrumentarFerramentas(ferramentas, onEvento, opcoes = {}) {
  if (!onEvento) return ferramentas;
  return ferramentas.map((ferramenta) => ({
    ...ferramenta,
    async executar(argumentos) {
      const inicio = Date.now();
      let sucesso = false;
      onEvento(`Executando tool ${ferramenta.definicao.name}...`);
      if (opcoes.mostrarArgumentos) {
        onEvento(`Argumentos: ${JSON.stringify(argumentos).slice(0, 1200)}`);
      }
      try {
        const resultado = await ferramenta.executar(argumentos);
        opcoes.onResultado?.(ferramenta.definicao.name, resultado);
        sucesso = true;
        return resultado;
      } catch (erro) {
        const resumo = JSON.stringify(argumentos).slice(0, 700);
        onEvento(`Tool ${ferramenta.definicao.name} rejeitada: ${erro.message} Argumentos: ${resumo}`);
        throw erro;
      } finally {
        onEvento(
          `Tool ${ferramenta.definicao.name} ${sucesso ? 'concluida' : 'finalizada com erro'} ` +
          `em ${Date.now() - inicio} ms.`
        );
      }
    }
  }));
}

module.exports = {
  FERRAMENTAS_NEGOCIO,
  ferramentaDeNegocio,
  obterFerramentaPorNome,
  obterPerfilDaFerramenta,
  PERFIS_TOOLS,
  criarRegistroFerramentas,
  instrumentarFerramentas,
  obterFerramentasDoPerfil
};
