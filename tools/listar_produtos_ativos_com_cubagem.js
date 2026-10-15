const crypto = require('node:crypto');
const { criarLeitorGold } = require('../duckdb/gold');

const OBJETO = 'catalogo_produto_logistico';
const MAX_LINHAS = 50_000;
const COLUNAS = Object.freeze([
  'id_produto', 'descricao_produto', 'sku', 'ean',
  'embalagem_altura_m', 'embalagem_largura_m', 'embalagem_comprimento_m',
  'cubagem_m3', 'status_cubagem', 'peso_bruto', 'peso_liquido',
  'grupo', 'subgrupo', 'marca', 'categoria'
]);

const definicaoListarProdutosAtivosComCubagem = Object.freeze({
  type: 'function',
  name: 'listar_produtos_ativos_com_cubagem',
  description: 'Lista todos os produtos ativos no Sysemp com dimensões da embalagem em metros e cubagem em m3. Use para solicitações explícitas de dimensões de embalagem ou cubagem; não substitua dimensões do produto sem embalagem.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  }
});

function normalizarLinha(linha) {
  return Object.fromEntries(Object.entries(linha).map(([campo, valor]) => [campo,
    typeof valor === 'bigint' ? valor.toString() : valor
  ]));
}

function resumir(linhas) {
  const resumo = { total_produtos_ativos: linhas.length,
    cubagens_completas: 0, cubagens_incompletas: 0, cubagens_invalidas: 0 };
  for (const linha of linhas) {
    if (linha.status_cubagem === 'completa') resumo.cubagens_completas += 1;
    else if (linha.status_cubagem === 'incompleta') resumo.cubagens_incompletas += 1;
    else if (linha.status_cubagem === 'invalida') resumo.cubagens_invalidas += 1;
  }
  return resumo;
}

async function executarListarProdutosAtivosComCubagem(_argumentos, dependencias = {}) {
  const datasets = dependencias.servicoDatasets;
  if (!datasets?.criarDeLinhas || !dependencias.conversationId || !dependencias.turnoIA?.id) {
    const erro = new Error('O serviço de resultados completos não está disponível neste turno.');
    erro.codigo = 'CATALOGO_LOGISTICO_DATASETS_INDISPONIVEL';
    throw erro;
  }
  const modoDatasets = String(dependencias.datasetsMode || process.env.NEXUS_DATASETS_MODE || 'off').toLowerCase();
  if (modoDatasets !== 'v1') {
    const erro = new Error('A geração da lista completa exige NEXUS_DATASETS_MODE=v1.');
    erro.codigo = 'CATALOGO_LOGISTICO_DATASETS_DESATIVADOS';
    throw erro;
  }

  const leitor = (dependencias.criarLeitor || criarLeitorGold)();
  try {
    const consulta = await leitor.comObjeto(OBJETO, async ({ contexto, consultarSql, conexao }) => {
      const vista = `"${contexto.viewAtual.replace(/"/g, '""')}"`;
      const linhas = await consultarSql(`SELECT ${COLUNAS.map((x) => `"${x}"`).join(', ')}
        FROM ${vista} WHERE produto_ativo = true ORDER BY id_produto LIMIT ${MAX_LINHAS + 1}`);
      const [contagem] = await consultarSql(`SELECT count(*) AS total
        FROM ${vista} WHERE produto_ativo = true`);
      return {
        linhas: linhas.map(normalizarLinha),
        total: Number(contagem.total),
        atualizado_em: contexto.execucoes.at(-1)?.manifesto?.fim || null,
        conexao
      };
    });

    if (consulta.total > MAX_LINHAS || consulta.linhas.length > MAX_LINHAS) {
      const erro = new Error(`Há ${consulta.total} produtos ativos; o limite integral é ${MAX_LINHAS}. Nenhum resultado parcial foi exportado.`);
      erro.codigo = 'CATALOGO_LOGISTICO_LIMITE_EXCEDIDO';
      throw erro;
    }

    const contagens = resumir(consulta.linhas);
    if (consulta.total === 0) {
      return JSON.stringify({ status: 'sem_produtos', ...contagens,
        atualizado_em: consulta.atualizado_em, previa: [], resultado_truncado_no_prompt: false });
    }

    const assinatura = crypto.createHash('sha256').update(JSON.stringify({
      ferramenta: definicaoListarProdutosAtivosComCubagem.name,
      gold: OBJETO,
      atualizado_em: consulta.atualizado_em
    })).digest('hex');
    const resultRef = await datasets.criarDeLinhas(
      dependencias.conversationId,
      dependencias.turnoIA.id,
      consulta.linhas,
      {
        assinatura,
        queryManifest: { tipo: 'corporate_tool', ferramenta: definicaoListarProdutosAtivosComCubagem.name,
          argumentos: {}, objeto: `gold.${OBJETO}` },
        lineage: { ferramenta: definicaoListarProdutosAtivosComCubagem.name,
          fonte: `gold.${OBJETO}` },
        corporateUpdatedAt: consulta.atualizado_em,
        classification: 'dados_nexus'
      }
    );
    return JSON.stringify({
      status: 'sucesso',
      ...contagens,
      atualizado_em: consulta.atualizado_em,
      result_ref: resultRef.id,
      previa: consulta.linhas.slice(0, 20),
      resultado_truncado_no_prompt: consulta.linhas.length > 20,
      regra: 'O conjunto integral foi persistido em result_ref; a prévia contém no máximo 20 produtos.'
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  COLUNAS,
  definicaoListarProdutosAtivosComCubagem,
  executarListarProdutosAtivosComCubagem,
  resumir
};
