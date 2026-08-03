const { criarLeitorSilver } = require('../duckdb/silver');
const {
  serializar,
  validarLimite,
  validarObjeto
} = require('./core/validacao');

const TIPOS_IDENTIFICADOR = Object.freeze([
  'auto',
  'ean',
  'sku',
  'id_produto',
  'descricao'
]);

const STATUS_PRODUTO = Object.freeze([
  'ativos',
  'site',
  'todos'
]);

const COLUNAS_PRODUTO = Object.freeze([
  'id_produto',
  'descricao_produto',
  'sku',
  'ean',
  'grupo',
  'subgrupo',
  'marca',
  'categoria',
  'produto_ativo'
]);

const definicaoResolverProduto = {
  type: 'function',
  name: 'resolver_produto',
  description: `
Localiza e identifica um produto no cadastro da camada Silver.

Use esta ferramenta quando o usuário informar:
- EAN ou código de barras;
- SKU;
- ID interno do produto;
- descrição ou nome parcial do produto.

A ferramenta retorna os identificadores canônicos do produto, incluindo
id_produto, SKU, EAN e descrição.

Use resolver_produto antes de ferramentas que exigem um identificador
específico. Por exemplo: analisar_reposicoes consulta produtos por SKU.
Se o usuário informar um EAN, resolva primeiro o produto e depois utilize
o SKU retornado para consultar as reposições.

Quando tipo_identificador for "auto", a ferramenta tentará identificar
automaticamente se o valor é EAN, SKU, ID interno ou descrição.
`,
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      tipo_identificador: {
        type: 'string',
        enum: TIPOS_IDENTIFICADOR
      },
      valor: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      status: {
        type: 'string',
        enum: STATUS_PRODUTO
      },
      limite: {
        type: 'integer',
        minimum: 1,
        maximum: 10
      }
    },
    required: [
      'tipo_identificador',
      'valor',
      'status',
      'limite'
    ],
    additionalProperties: false
  }
};

function validarArgumentos(argumentos) {
  validarObjeto(argumentos);

  if (!TIPOS_IDENTIFICADOR.includes(argumentos.tipo_identificador)) {
    throw new Error(
      `Tipo de identificador invalido: ${argumentos.tipo_identificador}`
    );
  }

  if (!STATUS_PRODUTO.includes(argumentos.status)) {
    throw new Error(
      `Status de produto invalido: ${argumentos.status}`
    );
  }

  if (
    typeof argumentos.valor !== 'string'
    || !argumentos.valor.trim()
  ) {
    throw new Error('valor deve ser uma string nao vazia.');
  }
}

function montarFiltrosStatus(status) {
  if (status === 'ativos') {
    return {
      produto_ativo: {
        operador: 'igual',
        valor: 'true'
      }
    };
  }

  if (status === 'site') {
    return {
      catalogo_site_ativo: {
        operador: 'igual',
        valor: 'true'
      }
    };
  }

  return {};
}

function apenasDigitos(valor) {
  return String(valor).replace(/\D/g, '');
}

function pareceEan(valor) {
  const digitos = apenasDigitos(valor);

  return [8, 12, 13, 14].includes(digitos.length)
    && digitos === String(valor).trim();
}

function pareceIdProduto(valor) {
  return /^\d+$/.test(String(valor).trim());
}

function criarTentativas(tipoIdentificador, valor) {
  const valorLimpo = String(valor).trim();

  if (tipoIdentificador !== 'auto') {
    return [
      {
        tipo: tipoIdentificador,
        campo: tipoIdentificador === 'descricao'
          ? 'descricao_produto'
          : tipoIdentificador,
        operador: tipoIdentificador === 'descricao'
          ? 'contem'
          : 'igual',
        valor: valorLimpo
      }
    ];
  }

  const tentativas = [];

  /*
   * Um GTIN/EAN válido normalmente possui 8, 12, 13 ou 14 dígitos.
   * Mesmo assim, se não houver resultado, tentamos o mesmo valor como SKU.
   */
  if (pareceEan(valorLimpo)) {
    tentativas.push({
      tipo: 'ean',
      campo: 'ean',
      operador: 'igual',
      valor: apenasDigitos(valorLimpo)
    });
  }

  tentativas.push({
    tipo: 'sku',
    campo: 'sku',
    operador: 'igual',
    valor: valorLimpo
  });

  if (pareceIdProduto(valorLimpo)) {
    tentativas.push({
      tipo: 'id_produto',
      campo: 'id_produto',
      operador: 'igual',
      valor: valorLimpo
    });
  }

  tentativas.push({
    tipo: 'descricao',
    campo: 'descricao_produto',
    operador: 'contem',
    valor: valorLimpo
  });

  return tentativas;
}

function normalizarProduto(produto) {
  return {
    id_produto: produto.id_produto ?? null,
    descricao_produto: produto.descricao_produto ?? null,
    sku: produto.sku ?? null,
    ean: produto.ean ?? null,
    grupo: produto.grupo ?? null,
    subgrupo: produto.subgrupo ?? null,
    marca: produto.marca ?? null,
    categoria: produto.categoria ?? null,
    produto_ativo: produto.produto_ativo ?? null
  };
}

function removerDuplicados(produtos) {
  const encontrados = new Map();

  for (const produto of produtos) {
    const chave = produto.id_produto != null
      ? `id:${produto.id_produto}`
      : `sku:${produto.sku ?? ''}|ean:${produto.ean ?? ''}`;

    if (!encontrados.has(chave)) {
      encontrados.set(chave, produto);
    }
  }

  return [...encontrados.values()];
}

async function consultarTentativa(
  leitor,
  tentativa,
  filtrosStatus,
  limite
) {
  const resultado = await leitor.consultar('dim_produto', {
    filtros: {
      ...filtrosStatus,
      [tentativa.campo]: {
        operador: tentativa.operador,
        valor: tentativa.valor
      }
    },
    colunas: [...COLUNAS_PRODUTO],
    ordenacao: {
      campo: 'descricao_produto',
      direcao: 'asc'
    },
    limite
  });

  return {
    dados: resultado.dados ?? [],
    atualizadoEm: resultado.ultimaConstrucao ?? null
  };
}

async function executarResolverProduto(argumentos, dependencias = {}) {
  validarArgumentos(argumentos);

  const valor = argumentos.valor.trim();
  const limite = validarLimite(argumentos.limite, 5, 10);
  const filtrosStatus = montarFiltrosStatus(argumentos.status);

  const tentativas = criarTentativas(
    argumentos.tipo_identificador,
    valor
  );

  const leitor = (
    dependencias.criarLeitor
    || criarLeitorSilver
  )();

  try {
    let atualizadoEm = null;

    for (const tentativa of tentativas) {
      const resultado = await consultarTentativa(
        leitor,
        tentativa,
        filtrosStatus,
        limite
      );

      atualizadoEm = resultado.atualizadoEm ?? atualizadoEm;

      const produtos = removerDuplicados(
        resultado.dados.map(normalizarProduto)
      );

      /*
       * Em modo automático, só seguimos para a próxima tentativa
       * quando a tentativa atual não encontra nenhum produto.
       */
      if (produtos.length === 0) {
        continue;
      }

      if (produtos.length === 1) {
        const produto = produtos[0];

        return serializar({
          status: 'encontrado',
          identificador_recebido: {
            tipo: argumentos.tipo_identificador,
            valor
          },
          identificador_resolvido_por: tentativa.tipo,
          produto,
          sku_resolvido: produto.sku,
          atualizado_em: atualizadoEm
        });
      }

      return serializar({
        status: 'multiplos_resultados',
        identificador_recebido: {
          tipo: argumentos.tipo_identificador,
          valor
        },
        identificador_resolvido_por: tentativa.tipo,
        quantidade_resultados: produtos.length,
        dados: produtos,
        atualizado_em: atualizadoEm
      });
    }

    return serializar({
      status: 'nao_encontrado',
      identificador_recebido: {
        tipo: argumentos.tipo_identificador,
        valor
      },
      mensagem: 'Nenhum produto correspondente foi encontrado.',
      atualizado_em: atualizadoEm
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoResolverProduto,
  executarResolverProduto,
  TIPOS_IDENTIFICADOR,
  STATUS_PRODUTO
};