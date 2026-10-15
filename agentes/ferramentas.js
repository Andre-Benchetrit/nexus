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
  definicaoListarProdutosAtivosComCubagem,
  executarListarProdutosAtivosComCubagem
} = require('../tools/listar_produtos_ativos_com_cubagem');
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
const {
  definicaoConsultarDocumentacao,
  executarConsultarDocumentacao
} = require('../tools/consultar_documentacao');
const {
  definicaoConsultarConjuntoNexus,
  executarConsultarConjuntoNexus
} = require('../tools/consultar_conjunto_nexus');
const {
  definicaoConsultarResultadoNexus,
  executarConsultarResultadoNexus
} = require('../tools/consultar_resultado_nexus');
const {
  definicaoAnalisarEvolucaoProduto,
  executarAnalisarEvolucaoProduto
} = require('../tools/analisar_evolucao_produto');
const {
  definicaoDiagnosticarProduto360,
  executarDiagnosticarProduto360
} = require('../tools/diagnosticar_produto_360');
const {
  definicaoDetectarExcecoesProduto,
  executarDetectarExcecoesProduto
} = require('../tools/detectar_excecoes_produto');
const {
  definicaoCompararCanaisProduto,
  executarCompararCanaisProduto
} = require('../tools/comparar_canais_produto');

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
  'listar_produtos_ativos_com_cubagem',
  'analisar_pessoas',
  'analisar_evolucao_produto',
  'diagnosticar_produto_360',
  'detectar_excecoes_produto',
  'comparar_canais_produto',
  'consultar_documentacao',
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
  listar_produtos_ativos_com_cubagem: 'catalogo',
  analisar_pessoas: 'pessoas',
  analisar_evolucao_produto: 'inteligencia_produto',
  diagnosticar_produto_360: 'inteligencia_produto',
  detectar_excecoes_produto: 'inteligencia_produto',
  comparar_canais_produto: 'inteligencia_produto',
  consultar_documentacao: 'documentacao',
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
  inteligencia_produto: [
    'analisar_evolucao_produto',
    'diagnosticar_produto_360',
    'detectar_excecoes_produto',
    'comparar_canais_produto'
  ],
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
  catalogo: ['analisar_catalogo', 'listar_produtos_ativos_com_cubagem'],
  pessoas: ['analisar_pessoas'],
  documentacao: ['consultar_documentacao'],
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
    ['listar_produtos_ativos_com_cubagem', {
      definicao: definicaoListarProdutosAtivosComCubagem,
      terminal: true,
      executar: dependencias.executarListarProdutosAtivosComCubagemTool || ((argumentos) =>
        executarListarProdutosAtivosComCubagem(argumentos, dependencias))
    }],
    ['analisar_pessoas', {
      definicao: definicaoAnalisarPessoas,
      terminal: true,
      executar: dependencias.executarAnalisarPessoasTool || executarAnalisarPessoas
    }],
    ['analisar_evolucao_produto', {
      definicao: definicaoAnalisarEvolucaoProduto,
      terminal: true,
      executar: dependencias.executarAnalisarEvolucaoProdutoTool || ((argumentos) =>
        executarAnalisarEvolucaoProduto(argumentos, dependencias))
    }],
    ['diagnosticar_produto_360', {
      definicao: definicaoDiagnosticarProduto360,
      terminal: true,
      executar: dependencias.executarDiagnosticarProduto360Tool || ((argumentos) =>
        executarDiagnosticarProduto360(argumentos, dependencias))
    }],
    ['detectar_excecoes_produto', {
      definicao: definicaoDetectarExcecoesProduto,
      terminal: true,
      executar: dependencias.executarDetectarExcecoesProdutoTool || ((argumentos) =>
        executarDetectarExcecoesProduto(argumentos, dependencias))
    }],
    ['comparar_canais_produto', {
      definicao: definicaoCompararCanaisProduto,
      terminal: true,
      executar: dependencias.executarCompararCanaisProdutoTool || ((argumentos) =>
        executarCompararCanaisProduto(argumentos, dependencias))
    }],
    ['consultar_documentacao', {
      definicao: definicaoConsultarDocumentacao,
      terminal: true,
      executar: dependencias.executarConsultarDocumentacaoTool || ((argumentos) =>
        executarConsultarDocumentacao(argumentos, dependencias))
    }],
    ['consultar_conjunto_nexus', {
      definicao: definicaoConsultarConjuntoNexus,
      terminal: true,
      executar: dependencias.executarConsultarConjuntoNexusTool || ((argumentos) =>
        executarConsultarConjuntoNexus(argumentos, dependencias))
    }],
    ['consultar_resultado_nexus', {
      definicao: definicaoConsultarResultadoNexus,
      terminal: false,
      executar: dependencias.executarConsultarResultadoNexusTool || ((argumentos) =>
        executarConsultarResultadoNexus(argumentos, dependencias))
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
  const nomesBase = PERFIS_TOOLS[perfil];
  if (!nomesBase) throw new Error(`Perfil de tools desconhecido: ${perfil}`);
  const pergunta = String(dependencias.perguntaRoteamento || dependencias.perguntaAtual || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const pedeCatalogoLogistico = /\b(cubagem|cubico|volume da embalagem|dimens(?:ao|oes) da embalagem|medidas? da embalagem|dimens(?:ao|oes) embalad[oa]s?)\b/i.test(pergunta) &&
    /\b(produto|produtos|sku|ean|embalagem)\b/i.test(pergunta);
  const nomes = pedeCatalogoLogistico
    ? nomesBase.filter((nome) => nome === 'listar_produtos_ativos_com_cubagem')
    : nomesBase.filter((nome) => nome !== 'listar_produtos_ativos_com_cubagem');
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

const CONTROLES_VOLUME_NORMALIZAVEIS = new Set(['limite', 'limite_por_dimensao']);

function normalizarControlesVolume(argumentos, schema = {}) {
  const normalizados = { ...(argumentos || {}) };
  const ajustes = [];
  for (const campo of CONTROLES_VOLUME_NORMALIZAVEIS) {
    const definicao = schema.properties?.[campo];
    const recebido = normalizados[campo];
    if (!definicao || !Number.isInteger(recebido)) continue;
    let valor = recebido;
    if (Number.isFinite(definicao.minimum)) valor = Math.max(valor, definicao.minimum);
    if (Number.isFinite(definicao.maximum)) valor = Math.min(valor, definicao.maximum);
    if (valor !== recebido) {
      normalizados[campo] = valor;
      ajustes.push({ campo, recebido, aplicado: valor });
    }
  }
  return { argumentos: normalizados, ajustes };
}

function instrumentarFerramentas(ferramentas, onEvento, opcoes = {}) {
  return ferramentas.map((ferramenta) => ({
    ...ferramenta,
    async executar(argumentos) {
      const inicio = Date.now();
      let sucesso = false;
      let contextoExecucao = null;
      let preparacaoEstado = null;
      const argumentosPolitica = opcoes.normalizarArgumentos
        ? opcoes.normalizarArgumentos(ferramenta.definicao.name, argumentos)
        : argumentos;
      const ajustesPolitica = ['visao'].filter((campo) =>
        argumentos?.[campo] !== argumentosPolitica?.[campo]
      ).map((campo) => ({
        campo,
        recebido: argumentos?.[campo] ?? null,
        aplicado: argumentosPolitica?.[campo] ?? null,
        motivo: 'politica_de_consulta'
      }));
      const normalizacaoVolume = normalizarControlesVolume(
        argumentosPolitica,
        ferramenta.definicao.parameters || {}
      );
      const argumentosEfetivos = normalizacaoVolume.argumentos;
      const ajustesArgumentos = [...ajustesPolitica, ...normalizacaoVolume.ajustes];
      try {
        if (ajustesArgumentos.length) {
          onEvento?.(`Argumentos normalizados para ${ferramenta.definicao.name}: ${JSON.stringify(ajustesArgumentos)}.`);
          opcoes.estadoExecucao?.checkpoint('tool_arguments_normalized', {
            dados: { nome: ferramenta.definicao.name, ajustes: ajustesArgumentos }
          });
          await opcoes.onArgumentosNormalizados?.(
            ferramenta.definicao.name,
            ajustesArgumentos
          );
        }
        const politica = {
          ...(opcoes.obterPolitica?.(ferramenta.definicao.name) || {}),
          argumentosHandoff: Object.keys(ferramenta.definicao.parameters?.properties || {})
        };
        preparacaoEstado = opcoes.estadoExecucao?.prepararTool(
          ferramenta.definicao.name, argumentosEfetivos, politica
        ) || null;
        if (preparacaoEstado?.reutilizar) {
          await opcoes.onResultado?.(
            ferramenta.definicao.name,
            preparacaoEstado.resultado,
            argumentosEfetivos,
            { contextoExecucao: null, duracaoMs: 0, reutilizado: true }
          );
          sucesso = true;
          return preparacaoEstado.resultado;
        }
        contextoExecucao = await opcoes.antesDeExecutar?.(
          ferramenta.definicao.name, argumentosEfetivos
        );
        onEvento?.(`Executando tool ${ferramenta.definicao.name}...`);
        if (opcoes.mostrarArgumentos) {
          onEvento?.(`Argumentos: ${JSON.stringify(argumentosEfetivos).slice(0, 1200)}`);
        }
        const resultado = await ferramenta.executar(argumentosEfetivos);
        opcoes.estadoExecucao?.concluirTool(
          ferramenta.definicao.name,
          argumentosEfetivos,
          opcoes.extrairResultadoHandoff?.(ferramenta.definicao.name, resultado) ?? resultado,
          {
            politica,
            execucaoId: contextoExecucao?.execucaoId || null,
            referencias: opcoes.extrairReferencias?.(resultado) || {}
          }
        );
        await opcoes.onResultado?.(
          ferramenta.definicao.name, resultado, argumentosEfetivos,
          { contextoExecucao, duracaoMs: Date.now() - inicio }
        );
        sucesso = true;
        return resultado;
      } catch (erro) {
        opcoes.estadoExecucao?.falharTool(
          ferramenta.definicao.name,
          argumentosEfetivos,
          erro,
          {
            validacao: /argument|schema|inval|invál|deve |limite|desconhecid|rejeitad/i
              .test(String(erro.message || ''))
          }
        );
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
  normalizarControlesVolume,
  obterFerramentaPorNome,
  obterPerfilDaFerramenta,
  PERFIS_TOOLS,
  criarRegistroFerramentas,
  instrumentarFerramentas,
  obterFerramentasDoPerfil
};
