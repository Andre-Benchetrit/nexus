const test = require('node:test');
const assert = require('node:assert/strict');
const { criarEstadoExecucao } = require('../agentes/execucao_turno');
const { criarProviderResiliente } = require('../agentes/providers/resiliente');

test('ledger reutiliza leituras e preserva identificadores no handoff', () => {
  const estado = criarEstadoExecucao({ objetivo: 'listar pedidos', modo: 'v1' });
  const args = { pedidos: ['701-3552839-4859420'] };
  estado.prepararTool('consultar_bloqueios_sem_estoque', args, {
    efeito: 'leitura', idempotencia: true
  });
  estado.concluirTool('consultar_bloqueios_sem_estoque', args, {
    itens: [{ marketplace_pedido: '701-3552839-4859420' }], sql: 'SELECT segredo'
  });
  const reutilizada = estado.prepararTool('consultar_bloqueios_sem_estoque', args, {
    efeito: 'leitura', idempotencia: true
  });
  assert.equal(reutilizada.reutilizar, true);
  const handoff = estado.criarHandoff({ providerAnterior: 'a', providerDestino: 'b' });
  assert.equal(handoff.toolsConcluidas[0].resultado.itens[0].marketplace_pedido,
    '701-3552839-4859420');
  assert.equal('sql' in handoff.toolsConcluidas[0].resultado, false);
});

test('ledger bloqueia repeticao de escrita e chamada invalida', () => {
  const estado = criarEstadoExecucao({ objetivo: 'teste', modo: 'v1' });
  estado.prepararTool('escrever', { id: 1 }, { efeito: 'escrita' });
  estado.concluirTool('escrever', { id: 1 }, { ok: true });
  assert.throws(() => estado.prepararTool('escrever', { id: 1 }, { efeito: 'escrita' }),
    /nao pode ser repetida/);
  estado.falharTool('ler', { limite: 500 }, Object.assign(new Error('argumento invalido'), {
    codigo: 'ARGUMENTO_INVALIDO'
  }), { validacao: true });
  assert.throws(() => estado.prepararTool('ler', { limite: 500 }), /invalida repetida/);
});

test('fallback v1 recebe checkpoint limpo e usa um unico provider substituto', async () => {
  const estado = criarEstadoExecucao({ objetivo: 'consultar pedido', modo: 'v1' });
  estado.prepararTool('consulta', { id: 'ABC123456' }, { efeito: 'leitura', idempotencia: true });
  estado.concluirTool('consulta', { id: 'ABC123456' }, { encontrado: true });
  let handoffObservado;
  const provider = criarProviderResiliente({
    nome: 'primario', modelo: 'p', async executar() {
      const erro = new Error('rate limit'); erro.status = 429; throw erro;
    }
  }, {
    nome: 'fallback', modelo: 'f', async executar(contexto) {
      assert.ok(contexto.handoff);
      assert.match(contexto.mensagens.at(-1).content, /Nao repita tools concluidas/);
      return { texto: 'concluido', provider: 'fallback', modelo: 'f' };
    }
  }, { tentativasExtras: 0 });
  const resultado = await provider.executar({
    pergunta: 'x', mensagens: [{ role: 'user', content: 'x' }],
    estadoExecucao: estado, handoffMode: 'v1',
    onHandoff: (evento) => { handoffObservado = evento; }
  });
  assert.equal(resultado.texto, 'concluido');
  assert.equal(handoffObservado.handoff.toolsConcluidas.length, 1);
});

test('autorizacao 403 nao aciona fallback', async () => {
  let chamouFallback = false;
  const provider = criarProviderResiliente({
    nome: 'primario', modelo: 'p', async executar() {
      const erro = new Error('forbidden'); erro.status = 403; throw erro;
    }
  }, {
    nome: 'fallback', modelo: 'f', async executar() { chamouFallback = true; }
  }, { tentativasExtras: 0 });
  await assert.rejects(provider.executar({ pergunta: 'x' }), /forbidden/);
  assert.equal(chamouFallback, false);
});

test('falha estrutural TOOL_USE_FAILED aciona fallback controlado', async () => {
  let chamouFallback = false;
  let chamadasPrimario = 0;
  const provider = criarProviderResiliente({
    nome: 'primario', modelo: 'p', async executar() {
      chamadasPrimario += 1;
      const erro = new Error('Failed to call a function');
      erro.code = 'TOOL_USE_FAILED';
      throw erro;
    }
  }, {
    nome: 'fallback', modelo: 'f', async executar() {
      chamouFallback = true;
      return { texto: 'recuperado' };
    }
  }, { tentativasExtras: 0 });
  const resultado = await provider.executar({ pergunta: 'x' });
  assert.equal(chamouFallback, true);
  assert.equal(chamadasPrimario, 1);
  assert.equal(resultado.texto, 'recuperado');
});
