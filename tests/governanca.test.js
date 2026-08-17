const test = require('node:test');
const assert = require('node:assert/strict');

const { instrumentarFerramentas } = require('../agentes/ferramentas');
const {
  chavesArgumentosSeguras,
  permissaoDaFerramenta,
  resolverDecisaoAutorizacao,
  resolverModoAutorizacao
} = require('../nexus/governanca');

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
