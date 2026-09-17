const test = require('node:test');
const assert = require('node:assert/strict');

const { instrumentarFerramentas } = require('../agentes/ferramentas');
const {
  chavesArgumentosSeguras,
  criarServicoGovernanca,
  permissaoDaFerramenta,
  permissaoDoDominioDataset,
  permissoesDaFerramenta,
  resolverDecisaoAutorizacao,
  resolverModoAutorizacao
} = require('../nexus/governanca');

function poolGovernanca(permissoesPermitidas = []) {
  const permitidas = new Set(permissoesPermitidas);
  const registros = { decisoes: [], execucoes: [], conclusoes: [], auditoria: [] };
  let sequencia = 0;
  return {
    registros,
    async query(sql, parametros = []) {
      if (/SELECT id, ativo FROM nexus\.principals/.test(sql)) {
        return { rows: [{ id: 'principal-1', ativo: true }] };
      }
      if (/FROM nexus\.permission_overrides/.test(sql)) return { rows: [] };
      if (/FROM nexus\.role_assignments/.test(sql)) {
        return { rows: permitidas.has(parametros[1]) ? [{ department_id: null }] : [] };
      }
      if (/INSERT INTO nexus\.authorization_decisions/.test(sql)) {
        const id = `decisao-${++sequencia}`;
        registros.decisoes.push({ id, permissao: parametros[2], decisao: parametros[6] });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (/INSERT INTO nexus\.tool_executions/.test(sql)) {
        const id = `execucao-${++sequencia}`;
        registros.execucoes.push({ id, permissao: parametros[4],
          status: /'bloqueada'/.test(sql) ? 'bloqueada' : 'iniciada' });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (/UPDATE nexus\.tool_executions/.test(sql)) {
        registros.conclusoes.push({ id: parametros[0], status: parametros[1] });
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO nexus\.audit_events/.test(sql)) {
        registros.auditoria.push(JSON.parse(parametros[4]));
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`SQL inesperado no teste: ${sql}`);
    }
  };
}

test('auditoria conserva somente nomes de argumentos nao sensiveis', () => {
  assert.deepEqual(chavesArgumentosSeguras({
    limite: 10, token: 'segredo', sql_livre: 'select', marketplace_pedidos: []
  }), ['limite', 'marketplace_pedidos']);
});

test('mapeia fachadas para permissoes explicitas', () => {
  assert.equal(permissaoDaFerramenta('analisar_vendas'), 'vendas.consultar');
  assert.equal(permissaoDaFerramenta('analisar_giro_estoque'), 'estoque.consultar');
  assert.equal(permissaoDaFerramenta('construir_sql'), 'sql.gerar');
  assert.equal(permissaoDaFerramenta('consultar_bronze'), 'bronze.auditar');
});

test('cruzamento de dataset combina permissao da IA com permissao do dominio', () => {
  assert.equal(permissaoDoDominioDataset('VENDAS'), 'vendas.consultar');
  assert.equal(permissaoDoDominioDataset('estoque'), 'estoque.consultar');
  assert.equal(permissaoDoDominioDataset('catalogo'), 'catalogo.consultar');
  assert.equal(permissaoDoDominioDataset('desconhecido'), null);
  assert.deepEqual(permissoesDaFerramenta('consultar_conjunto_nexus', { dominio: 'vendas' }),
    ['ia.nexus.consultar', 'vendas.consultar']);
  assert.deepEqual(permissoesDaFerramenta('consultar_nexus', { dominio: 'vendas' }),
    ['ia.nexus.consultar']);
});

test('negacao da permissao especifica impede o cruzamento antes de executar a tool', async () => {
  const pool = poolGovernanca(['ia.nexus.consultar']);
  const governanca = criarServicoGovernanca({ pool, principalId: 'principal-1',
    conversationId: 'conversa-1', modo: 'enforce' });
  let executada = false;
  const [tool] = instrumentarFerramentas([{
    definicao: { name: 'consultar_conjunto_nexus' },
    async executar() { executada = true; return 'nao deveria executar'; }
  }], null, {
    antesDeExecutar: (nome, argumentos) => governanca.iniciarTool(nome, argumentos)
  });

  await assert.rejects(tool.executar({ dominio: 'vendas' }), (erro) => {
    assert.equal(erro.codigo, 'ACESSO_NEGADO');
    assert.equal(erro.permissao, 'vendas.consultar');
    return true;
  });
  assert.equal(executada, false);
  assert.deepEqual(pool.registros.decisoes.map((item) => item.permissao),
    ['ia.nexus.consultar', 'vendas.consultar']);
  assert.deepEqual(pool.registros.execucoes,
    [{ id: 'execucao-3', permissao: 'vendas.consultar', status: 'bloqueada' }]);
});

test('allow do dominio executa uma vez e audita as duas permissoes', async () => {
  const pool = poolGovernanca(['ia.nexus.consultar', 'estoque.consultar']);
  const governanca = criarServicoGovernanca({ pool, principalId: 'principal-1',
    conversationId: 'conversa-1', modo: 'enforce' });
  let quantidadeExecucoes = 0;
  const [tool] = instrumentarFerramentas([{
    definicao: { name: 'consultar_conjunto_nexus' },
    async executar() { quantidadeExecucoes += 1; return 'ok'; }
  }], null, {
    antesDeExecutar: (nome, argumentos) => governanca.iniciarTool(nome, argumentos),
    async onResultado(_nome, _resultado, _argumentos, { contextoExecucao }) {
      await governanca.concluirTool(contextoExecucao, { sucesso: true, duracaoMs: 5 });
    }
  });

  assert.equal(await tool.executar({ dominio: 'estoque' }), 'ok');
  assert.equal(quantidadeExecucoes, 1);
  assert.deepEqual(pool.registros.execucoes.map((item) => item.permissao),
    ['ia.nexus.consultar', 'estoque.consultar']);
  assert.equal(pool.registros.conclusoes.length, 2);
  assert.deepEqual(pool.registros.auditoria.map((item) => item.permissao),
    ['ia.nexus.consultar', 'estoque.consultar']);
});

test('precedencia de autorizacao respeita inatividade, override e papeis', () => {
  assert.equal(resolverDecisaoAutorizacao({
    ativo: false, modo: 'audit', override: 'permitir', papel: 'global'
  }).motivo, 'principal_inativo');
  assert.equal(resolverDecisaoAutorizacao({
    ativo: true, modo: 'audit', override: 'negar', papel: 'global'
  }).motivo, 'override_negacao');
  assert.equal(resolverDecisaoAutorizacao({
    ativo: true, modo: 'audit', override: 'permitir'
  }).motivo, 'override_permissao');
  assert.equal(resolverDecisaoAutorizacao({
    ativo: true, modo: 'audit', papel: 'setor'
  }).motivo, 'papel_setor');
  assert.equal(resolverDecisaoAutorizacao({
    ativo: true, modo: 'audit', papel: 'global'
  }).motivo, 'papel_global');
  assert.equal(resolverDecisaoAutorizacao({ ativo: true, modo: 'audit' }).permitida, false);
});

test('modo de autorizacao padrao e audit e valores invalidos falham', () => {
  assert.equal(resolverModoAutorizacao(undefined), 'audit');
  assert.throws(() => resolverModoAutorizacao('talvez'), /invalido/);
});

test('instrumentacao aguarda autorizacao antes de executar e audita resultado', async () => {
  const eventos = [];
  const [tool] = instrumentarFerramentas([{
    definicao: { name: 'analisar_vendas' },
    async executar() { eventos.push('tool'); return 'ok'; }
  }], null, {
    async antesDeExecutar() { eventos.push('autorizar'); return { id: 'execucao' }; },
    async onResultado(_nome, _resultado, _argumentos, contexto) {
      eventos.push(`auditar:${contexto.contextoExecucao.id}`);
    }
  });
  assert.equal(await tool.executar({ limite: 10 }), 'ok');
  assert.deepEqual(eventos, ['autorizar', 'tool', 'auditar:execucao']);
});

test('negacao anterior impede que a tool seja executada', async () => {
  let executada = false;
  const [tool] = instrumentarFerramentas([{
    definicao: { name: 'analisar_vendas' },
    async executar() { executada = true; }
  }], null, {
    async antesDeExecutar() { throw new Error('Acesso negado'); }
  });
  await assert.rejects(tool.executar({}), /Acesso negado/);
  assert.equal(executada, false);
});
