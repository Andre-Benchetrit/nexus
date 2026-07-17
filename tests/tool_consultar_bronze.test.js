const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoConsultarBronze,
  executarConsultarBronze,
  ENTIDADES_PERMITIDAS_AGENTE
} = require('../tools/consultar_bronze');
const { entidades } = require('../exportadores/catalogo');

function argumentos(sobrescritas = {}) {
  return {
    operacao: 'consultar',
    entidade: 'cliente',
    visao: 'atual',
    id: null,
    colunas: null,
    filtros: null,
    combinacao_filtros: null,
    ordenacao: null,
    deslocamento: null,
    limite: 10,
    ...sobrescritas
  };
}

function criarLeitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async listarEntidades() { chamadas.push(['listar']); return [{ entidade: 'cliente' }]; },
      async descreverEntidade() {
        chamadas.push(['descrever']);
        return [
          { nome: 'id_cliente', tipo: 'INTEGER' },
          { nome: 'razsocial', tipo: 'VARCHAR' },
          { nome: 'cpf', tipo: 'VARCHAR' }
        ];
      },
      async contar(nome, opcoes) { chamadas.push(['contar', nome, opcoes]); return { total: 2n }; },
      async consultar(nome, opcoes) { chamadas.push(['consultar', nome, opcoes]); return { dados: [] }; },
      async buscarPorId(nome, id, opcoes) {
        chamadas.push(['buscarPorId', nome, id, opcoes]);
        return { dados: [{ id_cliente: 1 }] };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expõe um schema estrito compatível com function calling', () => {
  assert.equal(definicaoConsultarBronze.type, 'function');
  assert.equal(definicaoConsultarBronze.strict, true);
  assert.equal(definicaoConsultarBronze.parameters.additionalProperties, false);
  assert.deepEqual(
    new Set(definicaoConsultarBronze.parameters.required),
    new Set(Object.keys(definicaoConsultarBronze.parameters.properties))
  );
});

test('deriva as entidades permitidas diretamente do catálogo', () => {
  const esperadas = Object.values(entidades)
    .filter((entidade) => entidade.consulta?.habilitadaParaAgente === true)
    .map((entidade) => entidade.nome);

  assert.deepEqual(ENTIDADES_PERMITIDAS_AGENTE, esperadas);
  assert.deepEqual(
    definicaoConsultarBronze.parameters.properties.entidade.enum,
    [...esperadas, null]
  );
  assert.ok(ENTIDADES_PERMITIDAS_AGENTE.includes('produto'));
});

test('transforma filtros estruturados e fecha o leitor', async () => {
  const falso = criarLeitorFalso();
  const saida = await executarConsultarBronze(argumentos({
    operacao: 'contar',
    entidade: 'nota_saida',
    filtros: [{ campo: 'situacao', operador: 'igual', valor: 'B' }]
  }), { criarLeitor: () => falso.leitor });

  assert.deepEqual(JSON.parse(saida), { total: '2' });
  assert.deepEqual(falso.chamadas[0], [
    'contar',
    'nota_saida',
    {
      visao: 'atual',
      filtros: { situacao: { operador: 'igual', valor: 'B' } },
      combinacaoFiltros: 'todos'
    }
  ]);
  assert.equal(falso.fechado, true);
});

test('aceita busca textual parcial combinada com OU', async () => {
  const falso = criarLeitorFalso();
  await executarConsultarBronze(argumentos({
    operacao: 'contar',
    filtros: [
      { campo: 'fantasia', operador: 'contem', valor: 'MMA' },
      { campo: 'razsocial', operador: 'contem', valor: 'MMA' }
    ],
    combinacao_filtros: 'qualquer'
  }), { criarLeitor: () => falso.leitor });

  assert.deepEqual(falso.chamadas[0], [
    'contar',
    'cliente',
    {
      visao: 'atual',
      filtros: {
        fantasia: { operador: 'contem', valor: 'MMA' },
        razsocial: { operador: 'contem', valor: 'MMA' }
      },
      combinacaoFiltros: 'qualquer'
    }
  ]);
});

test('valida e encaminha ordenação somente por campo permitido', async () => {
  const falso = criarLeitorFalso();
  await executarConsultarBronze(argumentos({
    ordenacao: { campo: 'razsocial', direcao: 'desc' }
  }), { criarLeitor: () => falso.leitor });

  assert.deepEqual(falso.chamadas[0][2].ordenacao, {
    campo: 'razsocial',
    direcao: 'desc'
  });

  await assert.rejects(
    executarConsultarBronze(argumentos({
      ordenacao: { campo: 'cpf', direcao: 'desc' }
    }), { criarLeitor: () => falso.leitor }),
    /Campo de ordenação não permitido/
  );
});

test('encaminha comparação numérica segura', async () => {
  const falso = criarLeitorFalso();
  await executarConsultarBronze(argumentos({
    operacao: 'contar',
    entidade: 'nota_saida',
    filtros: [{ campo: 'id_nr_nf', operador: 'maior_que', valor: '0' }]
  }), { criarLeitor: () => falso.leitor });

  assert.deepEqual(falso.chamadas[0][2].filtros, {
    id_nr_nf: { operador: 'maior_que', valor: '0' }
  });
});

test('expõe somente colunas permitidas ao agente', async () => {
  const falso = criarLeitorFalso();
  const saida = await executarConsultarBronze(argumentos({
    operacao: 'descrever_entidade'
  }), { criarLeitor: () => falso.leitor });

  const colunas = JSON.parse(saida).colunas.map((coluna) => coluna.nome);
  assert.deepEqual(colunas, ['id_cliente', 'razsocial']);
  assert.equal(falso.fechado, true);
});

test('bloqueia acesso do agente a uma coluna não aprovada', async () => {
  const falso = criarLeitorFalso();
  await assert.rejects(
    executarConsultarBronze(argumentos({ colunas: ['id_cliente', 'cpf'] }), {
      criarLeitor: () => falso.leitor
    }),
    /Coluna não permitida/
  );
  assert.equal(falso.fechado, true);
});
