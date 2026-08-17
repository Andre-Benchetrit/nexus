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
  definicaoConsultarGold,
  executarConsultarGold
} = require('../tools/consultar_gold');
const {
  definicaoAgregarGold,
  executarAgregarGold
} = require('../tools/agregar_gold');
const {
  definicaoSolicitarAprofundamento,
  executarSolicitarAprofundamento
} = require('../tools/solicitar_aprofundamento');
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
  definicaoAnalisarGiroEstoque,
  executarAnalisarGiroEstoque
} = require('../tools/analisar_giro_estoque');
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
const {
  definicaoResolverProduto,
  executarResolverProduto
} = require('../tools/resolver_produto');
const {
  definicaoConsultarBloqueiosSemEstoque,
  executarConsultarBloqueiosSemEstoque
} = require('../tools/consultar_bloqueios_sem_estoque');
const {
  definicaoDiagnosticarBloqueioSemEstoque,
  executarDiagnosticarBloqueioSemEstoque
} = require('../tools/diagnosticar_bloqueio_sem_estoque');
const {
  definicaoConstruirSql,
  executarConstruirSql
} = require('../tools/construir_sql');

const FERRAMENTAS_NEGOCIO = Object.freeze([
  'analisar_indicadores',
  'analisar_influencias',
  'analisar_rupturas',
  'analisar_giro_estoque',
  'analisar_reposicoes',
  'analisar_desempenho',
  'analisar_frete',
  'analisar_operacao',
  'analisar_vendas',
  'analisar_catalogo',
  'analisar_pessoas',
  'consultar_bloqueios_sem_estoque',
  'diagnosticar_bloqueio_sem_estoque',
  'construir_sql'
]);

const PERFIL_POR_FERRAMENTA = Object.freeze({
  analisar_indicadores: 'indicadores',
  analisar_influencias: 'influencias',
  analisar_rupturas: 'estoque',
  analisar_giro_estoque: 'estoque',
  analisar_reposicoes: 'reposicoes',
  analisar_desempenho: 'desempenho',
  analisar_frete: 'frete',
  analisar_operacao: 'operacao',
  analisar_vendas: 'vendas',
  analisar_catalogo: 'catalogo',
  analisar_pessoas: 'pessoas',
  consultar_bloqueios_sem_estoque: 'bloqueios_estoque',
  diagnosticar_bloqueio_sem_estoque: 'bloqueios_estoque',
  resolver_produto: 'produto',
  construir_sql: 'sql',
  consultar_gold: 'gold',
  agregar_gold: 'gold',
  consultar_silver: 'silver',
  agregar_silver: 'silver',
  consultar_bronze: 'bronze',
  agregar_bronze: 'bronze'
});

const PERFIS_TOOLS = Object.freeze({
  produto: ['resolver_produto'],
  indicadores: ['analisar_indicadores'],
  influencias: ['analisar_influencias'],
  estoque: ['resolver_produto', 'analisar_rupturas', 'analisar_giro_estoque'],
  estoque_reposicoes: ['resolver_produto', 'analisar_rupturas', 'analisar_reposicoes'],
  reposicoes: ['resolver_produto', 'analisar_reposicoes'],
  bloqueios_estoque: [
    'consultar_bloqueios_sem_estoque',
    'diagnosticar_bloqueio_sem_estoque'
  ],
  desempenho: ['analisar_desempenho'],
  frete: ['analisar_frete'],
  operacao: ['analisar_operacao'],
  vendas: ['analisar_vendas'],
  catalogo: ['analisar_catalogo'],
  pessoas: ['analisar_pessoas'],
  sql: ['construir_sql'],
  negocio: ['analisar_vendas', 'analisar_catalogo'],
  hibrido: FERRAMENTAS_NEGOCIO,
  gold: ['consultar_gold', 'agregar_gold'],
  silver: ['consultar_silver', 'agregar_silver'],
  bronze: ['consultar_bronze', 'agregar_bronze'],
  completo: [
    ...FERRAMENTAS_NEGOCIO,
    'consultar_gold', 'agregar_gold',
    'consultar_silver', 'agregar_silver',
    'consultar_bronze', 'agregar_bronze'
  ]
});

function criarRegistroFerramentas(dependencias = {}) {
  return new Map([
    ['solicitar_aprofundamento', {
      definicao: definicaoSolicitarAprofundamento,
      terminal: false,
      executar: dependencias.executarSolicitarAprofundamentoTool || ((argumentos) => (
        executarSolicitarAprofundamento(argumentos, {
          liberar: dependencias.liberarAprofundamento
        })
      ))
    }],
    ['resolver_produto', {
      definicao: definicaoResolverProduto,
      terminal: false,
      executar: dependencias.executarResolverProdutoTool || executarResolverProduto
    }],
    ['construir_sql', {
      definicao: definicaoConstruirSql,
      terminal: true,
      executar: dependencias.executarConstruirSqlTool || ((argumentos) => (
        executarConstruirSql(argumentos, dependencias.sqlDependencias || dependencias)
      ))
    }],
    ['consultar_bloqueios_sem_estoque', {
      definicao: definicaoConsultarBloqueiosSemEstoque,
      terminal: true,
      executar: dependencias.executarConsultarBloqueiosSemEstoqueTool ||
        executarConsultarBloqueiosSemEstoque
    }],
    ['diagnosticar_bloqueio_sem_estoque', {
      definicao: definicaoDiagnosticarBloqueioSemEstoque,
      terminal: true,
      executar: dependencias.executarDiagnosticarBloqueioSemEstoqueTool ||
        executarDiagnosticarBloqueioSemEstoque
    }],
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
    ['analisar_giro_estoque', {
      definicao: definicaoAnalisarGiroEstoque,
      terminal: true,
      executar: dependencias.executarAnalisarGiroEstoqueTool || executarAnalisarGiroEstoque
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
      terminal: ({ operacao } = {}) => !['listar_objetos', 'descrever_objeto'].includes(operacao),
      executar: dependencias.executarConsultarSilverTool || executarConsultarSilver
    }],
    ['agregar_silver', {
      definicao: definicaoAgregarSilver,
      terminal: true,
      executar: dependencias.executarAgregarSilverTool || executarAgregarSilver
    }],
    ['consultar_gold', {
      definicao: definicaoConsultarGold,
      terminal: ({ operacao } = {}) => !['listar_objetos', 'descrever_objeto'].includes(operacao),
      executar: dependencias.executarConsultarGoldTool || executarConsultarGold
    }],
    ['agregar_gold', {
      definicao: definicaoAgregarGold,
      terminal: true,
      executar: dependencias.executarAgregarGoldTool || executarAgregarGold
    }],
    ['consultar_bronze', {
      definicao: definicaoConsultarBronze,
      terminal: ({ operacao } = {}) => !['listar_entidades', 'descrever_entidade'].includes(operacao),
      executar: dependencias.executarTool || executarConsultarBronze
    }],
    ['agregar_bronze', {
      definicao: definicaoAgregarBronze,
      terminal: true,
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
    if (permiteMultiplasChamadas && ferramentaDeNegocio(nome)) {
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

function ferramentaTecnica(nome) {
  return /^(consultar|agregar)_(gold|silver|bronze)$/.test(nome);
}

function instrumentarFerramentas(ferramentas, onEvento, opcoes = {}) {
  return ferramentas.map((ferramenta) => ({
    ...ferramenta,
    async executar(argumentos) {
      const inicio = Date.now();
      let sucesso = false;
      let contextoExecucao = null;
      const argumentosEfetivos = opcoes.normalizarArgumentos
        ? opcoes.normalizarArgumentos(ferramenta.definicao.name, argumentos)
        : argumentos;
      try {
        contextoExecucao = await opcoes.antesDeExecutar?.(
          ferramenta.definicao.name, argumentosEfetivos
        );
        onEvento?.(`Executando tool ${ferramenta.definicao.name}...`);
        if (opcoes.mostrarArgumentos) {
          onEvento?.(`Argumentos: ${JSON.stringify(argumentosEfetivos).slice(0, 1200)}`);
        }
        const resultado = await ferramenta.executar(argumentosEfetivos);
        await opcoes.onResultado?.(
          ferramenta.definicao.name, resultado, argumentosEfetivos,
          { contextoExecucao, duracaoMs: Date.now() - inicio }
        );
        sucesso = true;
        return resultado;
      } catch (erro) {
        await opcoes.onErro?.(
          ferramenta.definicao.name, erro, argumentosEfetivos,
          { contextoExecucao, duracaoMs: Date.now() - inicio }
        );
        const resumo = JSON.stringify(argumentosEfetivos).slice(0, 700);
        onEvento?.(`Tool ${ferramenta.definicao.name} rejeitada: ${erro.message} Argumentos: ${resumo}`);
        throw erro;
      } finally {
        onEvento?.(
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
  ferramentaTecnica,
  obterFerramentaPorNome,
  obterPerfilDaFerramenta,
  PERFIS_TOOLS,
  criarRegistroFerramentas,
  instrumentarFerramentas,
  obterFerramentasDoPerfil
};
