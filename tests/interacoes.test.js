const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { criarMemoria } = require('../agentes/memoria');
const { executarAgente } = require('../agentes/consultor_nexus');
const {
  MAX_PERGUNTAS_RODADA,
  criarTarefaSql,
  processarMensagemInterativa,
  registrarEsclarecimentoRota
} = require('../agentes/interacoes');

function memoriaTemporaria(t) {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-interacao-'));
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));
  return criarMemoria({
    sessao: 'interacao',
    caminhoCurta: path.join(diretorio, 'curta.json'),
    caminhoLonga: path.join(diretorio, 'longa.json')
  });
}

test('cria tarefa SQL e limita esclarecimentos a tres perguntas', async (t) => {
  const memoria = memoriaTemporaria(t);
  const resultado = await processarMensagemInterativa(
    'Crie um SQL de faturamento por marketplace.',
    { memoria, interactionMode: 'v1', dataReferencia: '2026-08-11' }
  );
  assert.equal(resultado.status, 'precisa_esclarecimento');
  assert.equal(resultado.tarefa.tipo, 'construir_sql');
  assert.equal(resultado.tarefa.perguntas.length, MAX_PERGUNTAS_RODADA);
  assert.deepEqual(resultado.tarefa.camposPendentes, [
    'periodo', 'campo_temporal', 'tratamento_canceladas'
  ]);
  assert.equal(memoria.obterTarefaAtiva().id, resultado.tarefa.id);
});

test('tarefa SQL persiste apenas especificacao estruturada, sem pergunta ou SQL bruto', () => {
  const tarefa = criarTarefaSql('Crie uma query SELECT * FROM segredo.', '2026-08-11');
  assert.equal(tarefa.contexto.destino, 'postgresql_sysemp');
  assert.doesNotMatch(JSON.stringify(tarefa), /SELECT \* FROM segredo/i);
  assert.equal(tarefa.contexto.perguntaOriginal, undefined);
});

test('mescla resposta parcial e executa somente quando todos os slots estao completos', async (t) => {
  const memoria = memoriaTemporaria(t);
  await processarMensagemInterativa('Gere SQL de faturamento por marketplace.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  const parcial = await processarMensagemInterativa('Use a data de emissão e exclua canceladas.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  assert.equal(parcial.status, 'precisa_esclarecimento');
  assert.deepEqual(parcial.tarefa.camposPendentes, ['periodo']);

  const pronto = await processarMensagemInterativa('De 01/08/2026 a 11/08/2026.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  assert.equal(pronto.status, 'pronto');
  assert.equal(pronto.argumentos.periodo.campo, 'data_emissao');
  assert.deepEqual(pronto.argumentos.metricas, ['faturamento']);
});

test('pausa SQL ao mudar de assunto e retoma preservando slots', async (t) => {
  const memoria = memoriaTemporaria(t);
  const criada = await processarMensagemInterativa('Gere SQL de faturamento por marketplace.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  const outroAssunto = await processarMensagemInterativa('Quais pedidos estão com bloqueio?', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  assert.equal(outroAssunto.acao, 'continuar');
  assert.equal(memoria.listarTarefas()[0].estado, 'pausada');

  const retomada = await processarMensagemInterativa('Retome o SQL.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  assert.equal(retomada.status, 'precisa_esclarecimento');
  assert.deepEqual(retomada.tarefa.slots.metricas, ['faturamento']);
  assert.equal(retomada.tarefa.id, criada.tarefa.id);
});

test('cancela e expira tarefas sem retoma-las silenciosamente', async (t) => {
  const memoria = memoriaTemporaria(t);
  await processarMensagemInterativa('Crie um SQL de faturamento.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  const cancelada = await processarMensagemInterativa('Cancele essa tarefa.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  assert.equal(cancelada.status, 'cancelado');
  assert.equal(memoria.obterTarefaAtiva(), null);

  const expirada = criarTarefaSql('Crie um SQL de faturamento.', '2026-08-11');
  expirada.expiraEm = '2026-08-10T00:00:00.000Z';
  memoria.salvarTarefa(expirada);
  memoria.expirarTarefas(new Date('2026-08-11T00:00:00.000Z'));
  assert.equal(memoria.obterTarefaAtiva(), null);
  assert.equal(memoria.listarTarefas({ incluirFinalizadas: true })
    .find((item) => item.id === expirada.id).estado, 'expirada');
});

test('esclarecimento de rota vira tarefa e recompõe a pergunta original', async (t) => {
  const memoria = memoriaTemporaria(t);
  const tarefa = registrarEsclarecimentoRota(memoria, {
    perguntaOriginal: 'Como estamos?',
    perguntaEsclarecimento: 'Você quer vendas, estoque ou operação?'
  });
  assert.equal(tarefa.estado, 'aguardando_usuario');
  const resultado = await processarMensagemInterativa('Quero estoque.', {
    memoria, interactionMode: 'v1', dataReferencia: '2026-08-11'
  });
  assert.equal(resultado.acao, 'continuar');
  assert.equal(resultado.texto, 'Como estamos? Quero estoque.');
  assert.equal(memoria.obterTarefaAtiva(), null);
});

test('conversa SQL esclarece antes de executar e preserva a consulta fora da memoria', async (t) => {
  const memoria = memoriaTemporaria(t);
  let providerExecutado = false;
  const cliente = {
    async query(sql) {
      if (/^EXPLAIN/.test(sql)) {
        return { rows: [{ 'QUERY PLAN': [{ Plan: {
          'Node Type': 'Aggregate', 'Startup Cost': 1, 'Total Cost': 2,
          'Plan Rows': 3, 'Plan Width': 16
        } }] }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const dependencias = {
    memoria,
    interactionMode: 'v1',
    dataReferencia: '2026-08-11',
    provider: { async executar() { providerExecutado = true; } },
    sqlDependencias: { pool: { async connect() { return cliente; } } }
  };

  const pergunta = await executarAgente('Crie um SQL de faturamento por marketplace.', dependencias);
  assert.equal(pergunta.interacao.status, 'precisa_esclarecimento');
  assert.equal(providerExecutado, false);

  const resposta = await executarAgente(
    'De 01/08/2026 a 11/08/2026, por data de emissão e exclua canceladas.',
    dependencias
  );
  assert.match(resposta.texto, /SQL validado/);
  assert.match(resposta.texto, /```sql/);
  assert.match(resposta.texto, /plataforma_ecommerce/);
  assert.match(resposta.texto, /GROUP BY 1/);
  assert.equal(providerExecutado, false);
  assert.equal(memoria.listarTarefas({ incluirFinalizadas: true }).at(-1).estado, 'concluida');
  assert.doesNotMatch(memoria.listarCurta().at(-1).resposta, /SELECT|FROM "sysemp"/);
});

test('esse mesmo SQL por produto herda slots e troca para a receita no grao dos itens', async (t) => {
  const memoria = memoriaTemporaria(t);
  const cliente = {
    async query(sql) {
      if (/^EXPLAIN/.test(sql)) {
        return { rows: [{ 'QUERY PLAN': [{ Plan: {
          'Node Type': 'Aggregate', 'Startup Cost': 1, 'Total Cost': 2,
          'Plan Rows': 3, 'Plan Width': 16
        } }] }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const dependencias = {
    memoria,
    interactionMode: 'v1',
    dataReferencia: '2026-08-11',
    provider: { async executar() { throw new Error('Provider não deveria ser executado.'); } },
    sqlDependencias: { pool: { async connect() { return cliente; } } }
  };

  await executarAgente('Crie um SQL de faturamento por marketplace.', dependencias);
  await executarAgente(
    '01/08/2026 a 10/08/2026, data do pedido e exclua canceladas.',
    dependencias
  );
  const alterada = await executarAgente('Consegue fazer esse mesmo SQL, mas por produto?', dependencias);

  assert.match(alterada.texto, /FROM "sysemp"\."nota_saida_itens" nsi/);
  assert.match(alterada.texto, /JOIN "sysemp"\."produto" p/);
  assert.match(alterada.texto, /AS "faturamento"/);
  assert.match(alterada.texto, /ns\."data_pedido"/);
  assert.match(alterada.texto, /'2026-08-01'::date/);
  assert.doesNotMatch(alterada.texto, /sum\(ns\.total_nota_fiscal\)/);
  const tarefas = memoria.listarTarefas({ incluirFinalizadas: true });
  assert.equal(tarefas.at(-1).contexto.tarefaOrigem, tarefas.at(-2).id);
});

test('listagem de produtos ativos traduz todas as restrições explícitas', async (t) => {
  const memoria = memoriaTemporaria(t);
  const resultado = await processarMensagemInterativa(
    'Me dê um SQL para mostrar meus produtos ativos, que não tenham _ ou _OUT no final do SKU.',
    { memoria, interactionMode: 'v1', dataReferencia: '2026-08-11' }
  );
  assert.equal(resultado.status, 'pronto');
  assert.deepEqual(resultado.argumentos.regras, [
    'produto_ativo_vendavel', 'sku_sem_sufixo_variacao'
  ]);
  assert.deepEqual(resultado.argumentos.campos, [
    'codigo_barra', 'sku', 'codigo_fabricante', 'id_produto',
    'tipo_produto', 'descricao_produto', 'volume'
  ]);
});

test('restrição explícita desconhecida pede esclarecimento em vez de ser ignorada', async (t) => {
  const memoria = memoriaTemporaria(t);
  const resultado = await processarMensagemInterativa(
    'Crie um SQL para mostrar produtos que tenham margem secreta positiva.',
    { memoria, interactionMode: 'v1', dataReferencia: '2026-08-11' }
  );
  assert.equal(resultado.status, 'precisa_esclarecimento');
  assert.deepEqual(resultado.tarefa.camposPendentes, ['restricoes']);
  assert.match(resultado.texto, /Não consegui representar/);
});
