const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoConsultarSilver,
  executarConsultarSilver,
  OBJETOS_PERMITIDOS_AGENTE
} = require('../tools/consultar_silver');

function argumentos(sobrescritas = {}) {
  return {
    operacao: 'consultar',
    objeto: 'dim_produto',
    visao: 'atual',
    id: null,
    colunas: ['id_produto', 'descricao_produto', 'grupo'],
    filtros: null,
    combinacao_filtros: null,
    ordenacao: null,
    deslocamento: 0,
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
      async listarObjetos() {
        return [{ objeto: 'dim_produto' }, { objeto: 'interno' }];
      },
      async descreverObjeto() {
        return [
          { nome: 'id_produto', tipo: 'INTEGER' },
          { nome: 'descricao_produto', tipo: 'VARCHAR' },
          { nome: 'processado_em', tipo: 'TIMESTAMP' }
        ];
      },
      async consultar(nome, opcoes) {
        chamadas.push(['consultar', nome, opcoes]);
        return { dados: [{ id_produto: 1 }] };
      },
      async buscarPorId(nome, id, opcoes) {
        chamadas.push(['buscarPorId', nome, id, opcoes]);
        return { dados: [{ id_produto: Number(id) }] };
      },
      async contar(nome, opcoes) {
        chamadas.push(['contar', nome, opcoes]);
        return { total: 1n };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expoe somente objetos Silver aprovados em schema estrito', () => {
  assert.equal(definicaoConsultarSilver.name, 'consultar_silver');
  assert.equal(definicaoConsultarSilver.strict, true);
  assert.deepEqual(OBJETOS_PERMITIDOS_AGENTE, [
    'dim_cliente',
    'dim_funcionario',
    'dim_transportadora',
    'dim_grupo',
    'dim_subgrupo',
    'dim_marca',
    'dim_categoria',
    'dim_tipo_pedido',
    'dim_transporte_regra',
    'dim_plataforma_ecommerce',
    'dim_produto',
    'dim_bloqueio',
    'fato_venda',
    'fato_venda_item',
    'fato_pedido',
    'fato_nota_fiscal',
    'fato_pedido_item',
    'fato_nota_fiscal_item',
    'fato_agendamento_compra',
    'fato_nota_saida_bloqueio_item',
    'fato_nota_saida_bloqueio'
  ]);
  assert.deepEqual(
    new Set(definicaoConsultarSilver.parameters.required),
    new Set(Object.keys(definicaoConsultarSilver.parameters.properties))
  );
});

test('normaliza filtros e encaminha consulta Silver segura', async () => {
  const falso = criarLeitorFalso();
  await executarConsultarSilver(argumentos({
    filtros: [{
      campo: 'descricao_produto',
      operador: 'contem',
      valor: 'geladeira',
      valor_final: null,
      valores: null
    }]
  }), { criarLeitor: () => falso.leitor });

  assert.deepEqual(falso.chamadas[0][2].filtros, {
    descricao_produto: {
      operador: 'contem',
      valor: 'geladeira',
      valorFinal: null,
      valores: null
    }
  });
  assert.equal(falso.fechado, true);
});

test('bloqueia coluna Silver fora do contrato do agente', async () => {
  const falso = criarLeitorFalso();
  await assert.rejects(
    executarConsultarSilver(argumentos({ colunas: ['processado_em'] }), {
      criarLeitor: () => falso.leitor
    }),
    /Coluna Silver nao permitida/
  );
  assert.equal(falso.fechado, true);
});

test('filtra a listagem e descricao pelo catalogo Silver', async () => {
  const falso = criarLeitorFalso();
  const lista = JSON.parse(await executarConsultarSilver(argumentos({
    operacao: 'listar_objetos',
    objeto: null
  }), { criarLeitor: () => falso.leitor }));
  assert.deepEqual(lista, [{ objeto: 'dim_produto' }]);

  const outro = criarLeitorFalso();
  const descricao = JSON.parse(await executarConsultarSilver(argumentos({
    operacao: 'descrever_objeto',
    colunas: null
  }), { criarLeitor: () => outro.leitor }));
  assert.deepEqual(
    descricao.colunas.map((coluna) => coluna.nome),
    ['id_produto', 'descricao_produto']
  );
});
