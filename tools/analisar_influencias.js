const { criarLeitorSilver } = require('../duckdb/silver');
const { serializar, validarLista, validarObjeto } = require('./core/validacao');

const DIMENSOES = Object.freeze({
  marca: { objeto: 'fato_nota_fiscal_item', campo: 'marca', valor: 'valor_total_item', base: 'itens_faturados' },
  produto: { objeto: 'fato_nota_fiscal_item', campo: 'descricao_produto', valor: 'valor_total_item', base: 'itens_faturados' },
  plataforma: { objeto: 'fato_nota_fiscal', campo: 'plataforma', valor: 'valor_total_venda', base: 'notas_fiscais' }
});

const definicaoAnalisarInfluencias = {
  type: 'function',
  name: 'analisar_influencias',
  description: 'Uma unica chamada compara o periodo informado com o anterior de mesma duracao e aponta dimensoes que influenciaram a variacao.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      data_inicial: { type: 'string' },
      data_final: { type: 'string' },
      dimensoes: {
        type: 'array', minItems: 1, maxItems: 3,
        items: { type: 'string', enum: Object.keys(DIMENSOES) }
      },
      limite_por_dimensao: { type: 'integer', minimum: 1, maximum: 10 }
    },
    required: ['data_inicial', 'data_final', 'dimensoes', 'limite_por_dimensao'],
    additionalProperties: false
  }
};

function dataIso(valor, rotulo) {
  const texto = String(valor || '');
  const data = new Date(`${texto}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== texto) {
    throw new Error(`${rotulo} deve usar uma data valida em AAAA-MM-DD.`);
  }
  return texto;
}

function deslocarData(valor, dias) {
  const data = new Date(`${valor}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function criarPeriodoAnterior(inicio, fim) {
  const dias = Math.round((new Date(`${fim}T00:00:00Z`) - new Date(`${inicio}T00:00:00Z`)) / 86400000) + 1;
  return { inicio: deslocarData(inicio, -dias), fim: deslocarData(inicio, -1) };
}

async function agregarPeriodo(leitor, regra, periodo) {
  const resultado = await leitor.agregar(regra.objeto, {
    agrupamentos: [{ campo: regra.campo, granularidade: 'valor' }],
    calculos: [{ operacao: 'somar', campo: regra.valor }],
    filtros: {
      data_emissao: { operador: 'entre', valor: periodo.inicio, valorFinal: periodo.fim },
      faturamento_valido: { operador: 'igual', valor: 'true' }
    },
    limite: 500
  });
  return new Map(resultado.dados.map((linha) => [
    String(linha.grupo_1 || 'NAO INFORMADO'), Number(linha.calculo_1 || 0)
  ]));
}

function compararGrupos(atual, anterior, limite) {
  const nomes = new Set([...atual.keys(), ...anterior.keys()]);
  const linhas = [...nomes].map((nome) => {
    const valorAtual = atual.get(nome) || 0;
    const valorAnterior = anterior.get(nome) || 0;
    const diferenca = Number((valorAtual - valorAnterior).toFixed(2));
    return {
      nome, atual: valorAtual, anterior: valorAnterior, diferenca,
      variacao_pct: valorAnterior ? Number((diferenca * 100 / valorAnterior).toFixed(4)) : null
    };
  });
  return {
    maiores_quedas: linhas.filter((item) => item.diferenca < 0).sort((a, b) => a.diferenca - b.diferenca).slice(0, limite),
    maiores_altas: linhas.filter((item) => item.diferenca > 0).sort((a, b) => b.diferenca - a.diferenca).slice(0, limite)
  };
}

async function executarAnalisarInfluencias(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  const inicio = dataIso(argumentos.data_inicial, 'data_inicial');
  const fim = dataIso(argumentos.data_final, 'data_final');
  if (inicio > fim) throw new Error('data_inicial nao pode ser posterior a data_final.');
  validarLista(argumentos.dimensoes, 'dimensoes', 1, 3);
  const dimensoes = [...new Set(argumentos.dimensoes)];
  for (const dimensao of dimensoes) if (!DIMENSOES[dimensao]) throw new Error(`Dimensao invalida: ${dimensao}.`);
  const limite = argumentos.limite_por_dimensao;
  if (!Number.isInteger(limite) || limite < 1 || limite > 10) throw new Error('limite_por_dimensao deve estar entre 1 e 10.');
  const atual = { inicio, fim };
  const anterior = criarPeriodoAnterior(inicio, fim);
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    const influencias = {};
    for (const dimensao of dimensoes) {
      const regra = DIMENSOES[dimensao];
      const [valoresAtuais, valoresAnteriores] = await Promise.all([
        agregarPeriodo(leitor, regra, atual), agregarPeriodo(leitor, regra, anterior)
      ]);
      influencias[dimensao] = {
        base_calculo: regra.base,
        ...compararGrupos(valoresAtuais, valoresAnteriores, limite)
      };
    }
    return serializar({ metrica: 'faturamento_emitido', periodo_atual: atual, periodo_anterior: anterior, influencias });
  } finally {
    await leitor.fechar();
  }
}

module.exports = { definicaoAnalisarInfluencias, executarAnalisarInfluencias, DIMENSOES };
