const { criarLeitorGold } = require('../duckdb/gold');
const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB
} = require('../duckdb/connections');
const { serializar, validarObjeto } = require('./core/validacao');

const definicaoAnalisarGiroEstoque = {
  type: 'function',
  name: 'analisar_giro_estoque',
  description: 'Compara o estoque atual da empresa 10 com as vendas faturadas de um periodo e retorna os produtos de menor giro. O ranking favorece mais estoque e menos unidades vendidas.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      data_inicial: { type: 'string', description: 'Data inicial inclusiva em AAAA-MM-DD.' },
      data_final: { type: 'string', description: 'Data final inclusiva em AAAA-MM-DD.' },
      marca: { type: ['string', 'null'] },
      produto: { type: ['string', 'null'], description: 'Trecho opcional da descricao do produto.' },
      limite: { type: 'integer', minimum: 1, maximum: 20 }
    },
    required: ['data_inicial', 'data_final', 'marca', 'produto', 'limite'],
    additionalProperties: false
  }
};

function dataIso(valor, rotulo) {
  const texto = String(valor || '');
  const data = new Date(`${texto}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(texto) ||
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== texto
  ) throw new Error(`${rotulo} deve usar uma data valida em AAAA-MM-DD.`);
  return texto;
}

function citarVisao(nome) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(nome || '')) {
    throw new Error('A visao interna do Gold possui identificador invalido.');
  }
  return `"${nome}"`;
}

function consultarComParametros(conexao, sql, parametros) {
  return new Promise((resolve, reject) => {
    conexao.all(sql, ...parametros, (erro, linhas) => (
      erro ? reject(erro) : resolve(linhas)
    ));
  });
}

function numero(valor) {
  return valor == null ? 0 : Number(valor);
}

function normalizarLinha(linha) {
  return {
    id_produto: numero(linha.id_produto),
    descricao_produto: linha.descricao_produto,
    sku: linha.sku,
    ean: linha.ean,
    marca: linha.marca,
    estoque_total: numero(linha.estoque_total),
    quantidade_reservada: numero(linha.quantidade_reservada),
    quantidade_vendida_periodo: numero(linha.quantidade_vendida_periodo),
    faturamento_periodo: numero(linha.faturamento_periodo),
    indice_baixo_giro: numero(linha.indice_baixo_giro),
    sem_venda_periodo: linha.sem_venda_periodo === true ||
      String(linha.sem_venda_periodo).toLowerCase() === 'true'
  };
}

async function executarAnalisarGiroEstoque(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  const inicio = dataIso(argumentos.data_inicial, 'data_inicial');
  const fim = dataIso(argumentos.data_final, 'data_final');
  if (inicio > fim) throw new Error('data_inicial nao pode ser posterior a data_final.');
  const limite = argumentos.limite ?? 10;
  if (!Number.isInteger(limite) || limite < 1 || limite > 20) {
    throw new Error('limite deve ser um inteiro entre 1 e 20.');
  }

  const criarConexao = dependencias.criarConexao || criarConexaoDuckDB;
  const fecharConexao = dependencias.fecharConexao || fecharConexaoDuckDB;
  const executarConsulta = dependencias.executarConsulta || consultarComParametros;
  const conexao = criarConexao();
  const leitor = (dependencias.criarLeitor || criarLeitorGold)({ conexao });
  try {
    const estoque = await leitor.prepararObjeto('risco_ruptura_produto');
    const vendas = await leitor.prepararObjeto('desempenho_produto_diario');
    const filtros = [];
    const parametros = [inicio, fim];
    if (argumentos.marca?.trim()) {
      parametros.push(`%${argumentos.marca.trim()}%`);
      filtros.push(`e.marca ILIKE ?`);
    }
    if (argumentos.produto?.trim()) {
      parametros.push(`%${argumentos.produto.trim()}%`);
      filtros.push(`e.descricao_produto ILIKE ?`);
    }
    parametros.push(limite);
    const sql = `
      WITH vendas_periodo AS (
        SELECT
          id_produto,
          sum(coalesce(quantidade_faturada, 0)) AS quantidade_vendida_periodo,
          sum(coalesce(faturamento_emitido, 0)) AS faturamento_periodo
        FROM ${citarVisao(vendas.viewAtual)}
        WHERE id_empresa = 10
          AND data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        GROUP BY id_produto
      ), comparacao AS (
        SELECT
          e.id_produto,
          e.descricao_produto,
          e.sku,
          e.ean,
          e.marca,
          e.estoque_disponivel AS estoque_total,
          e.quantidade_reservada,
          coalesce(v.quantidade_vendida_periodo, 0) AS quantidade_vendida_periodo,
          coalesce(v.faturamento_periodo, 0) AS faturamento_periodo,
          CAST(
            e.estoque_disponivel /
            greatest(coalesce(v.quantidade_vendida_periodo, 0), 1)
            AS DECIMAL(18,4)
          ) AS indice_baixo_giro,
          coalesce(v.quantidade_vendida_periodo, 0) = 0 AS sem_venda_periodo
        FROM ${citarVisao(estoque.viewAtual)} e
        LEFT JOIN vendas_periodo v ON v.id_produto = e.id_produto
        WHERE e.estoque_disponivel > 0
          AND e.composicao_estoque IN (0, 6, 50)
          ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
      )
      SELECT * FROM comparacao
      ORDER BY indice_baixo_giro DESC, estoque_total DESC,
        quantidade_vendida_periodo ASC, id_produto ASC
      LIMIT ?
    `;
    const linhas = await executarConsulta(conexao, sql, parametros);
    return serializar({
      operacao: 'ranquear_menor_giro',
      empresa: 10,
      periodo_vendas: { inicio, fim },
      criterio: 'indice_baixo_giro = estoque_total / max(quantidade_vendida_periodo, 1); ordem decrescente',
      conceito_estoque: 'estoque atual disponivel no Sysemp para a empresa 10; reposicoes futuras nao sao somadas',
      conceito_vendas: 'quantidade faturada pela data de emissao no periodo informado',
      regra_elegibilidade: 'somente produtos vendaveis com composicao_estoque 0, 6 ou 50; kits participam, enquanto embalagens, materiais externos e consumos ficam excluidos',
      dados: linhas.map(normalizarLinha),
      atualizado_em: {
        estoque: estoque.execucoes.at(-1)?.manifesto.fim || null,
        vendas: vendas.execucoes.at(-1)?.manifesto.fim || null
      }
    });
  } finally {
    await leitor.fechar();
    await fecharConexao(conexao);
  }
}

module.exports = {
  definicaoAnalisarGiroEstoque,
  executarAnalisarGiroEstoque,
  dataIso,
  normalizarLinha
};
