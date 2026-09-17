const test = require('node:test');
const assert = require('node:assert/strict');

const { criarProviderAnthropic } = require('../agentes/providers/anthropic');
const { criarProvider } = require('../agentes/providers');
const { criarProviderResiliente } = require('../agentes/providers/resiliente');
const {
  normalizarUsageAnthropic,
  normalizarUsageGemini,
  normalizarUsageOpenAI,
  executarChamadaAuditada
} = require('../agentes/providers/telemetria');
const { exigeFonteCorporativa } = require('../agentes/politica_fonte');
const {
  capacidadesGeneralistasHabilitadas,
  obterCapacidadeGeneralista
} = require('../agentes/capacidades_generalistas');
const {
  executarAssistente,
  construirObjetivoCorporativo,
  corrigirAlegacaoMemoria,
  normalizarHistoricoVisivel,
  possuiTextoResposta,
  resolverModoAssistente
} = require('../agentes/assistente_nexus');
const { sanitizarMetadados } = require('../nexus/auditoria_ia');
const { lerArgumentos } = require('../agentes/consultor_nexus');

function memoriaFalsa(tarefaAtiva = null) {
  return { obterTarefaAtiva: async () => tarefaAtiva, sessao: 'teste' };
}

test('registro generalista habilita conversa, consulta corporativa e revisao governada', () => {
  assert.deepEqual(
    capacidadesGeneralistasHabilitadas().map((item) => item.id),
    ['ia.conversar', 'ia.nexus.consultar', 'ia.memoria.revisar']
  );
  assert.equal(obterCapacidadeGeneralista('ia.imagem.analisar').habilitada, false);
  assert.equal(obterCapacidadeGeneralista('ia.planilha.criar').executor, 'nexus_local');
});

test('guarda de fonte exige Nexus para identificador, fato mutavel e tarefa ativa', () => {
  assert.equal(exigeFonteCorporativa('Explique EBITDA').obrigatoria, false);
  assert.equal(exigeFonteCorporativa('Como esta meu faturamento hoje?').obrigatoria, true);
  assert.equal(exigeFonteCorporativa(
    'Quais pedidos estavam bloqueados em 17/08/2026?'
  ).obrigatoria, true);
  assert.equal(exigeFonteCorporativa('Veja o produto 7899552110892').obrigatoria, true);
  assert.equal(exigeFonteCorporativa('Crie uma query SQL de produtos').obrigatoria, true);
  assert.equal(exigeFonteCorporativa('sim', { tarefaAtiva: { id: '1' } }).obrigatoria, true);
});

test('guarda de fonte distingue conversa, web e continuacao corporativa', () => {
  assert.equal(exigeFonteCorporativa('Bom dia, como vai?').obrigatoria, false);
  assert.equal(exigeFonteCorporativa('Quais são as últimas notícias da FID?').obrigatoria, false);
  assert.equal(exigeFonteCorporativa('Explique o conceito de estoque de segurança.').obrigatoria, false);
  assert.equal(exigeFonteCorporativa('Verifique nossos bloqueios de estoque.').obrigatoria, true);
  assert.equal(exigeFonteCorporativa('Outros bloqueios também.', {
    ultimaProveniencia: 'dados_nexus'
  }).motivo, 'continuacao_corporativa');
  assert.equal(exigeFonteCorporativa(
    'Me dê os top 15 produtos por receita dos pedidos pagos desse período.'
  ).obrigatoria, true);
  assert.equal(exigeFonteCorporativa('Gere o mesmo relatório com filtro de período.', {
    ultimaPergunta: 'Top produtos por receita', ultimaProveniencia: 'dados_nexus'
  }).motivo, 'continuacao_corporativa');
  assert.equal(exigeFonteCorporativa('Sim', {
    ultimaPergunta: 'SKU é código auxiliar?',
    ultimaResposta: 'Quer que eu reconsulte o Nexus?'
  }).motivo, 'continuacao_corporativa');
  assert.equal(exigeFonteCorporativa('e de fato 2026.', {
    ultimaPergunta: 'Quais produtos mais venderam no mês de julho?',
    ultimaResposta: 'Poderia confirmar o ano desejado?',
    ultimaProveniencia: 'dados_nexus'
  }).motivo, 'continuacao_corporativa');
});

test('objetivo corporativo preserva pergunta atual e contexto que resolve o periodo', () => {
  const objetivo = construirObjetivoCorporativo(
    'Faça o mesmo relatório desse período.',
    'ranking de produtos',
    [
      { role: 'user', content: 'Analise de 01/08 a 25/08.' },
      { role: 'assistant', content: 'Período analisado.' }
    ]
  );
  assert.match(objetivo, /01\/08 a 25\/08/);
  assert.match(objetivo, /Pergunta atual do usuario: Faça o mesmo relatório desse período/);
  assert.match(objetivo, /A pergunta atual prevalece/);
});

test('objetivo corporativo preserva resultado anterior para operacao de continuidade', () => {
  const objetivo = construirObjetivoCorporativo(
    'Divida esse resultado por 2.',
    'dividir o resultado anterior por dois',
    [
      { role: 'user', content: 'Qual foi o total?' },
      { role: 'assistant', content: 'O total comprovado foi 120.' }
    ]
  );
  assert.match(objetivo, /total comprovado foi 120/);
  assert.match(objetivo, /Divida esse resultado por 2/);
});

test('nao afirma que uma memoria foi registrada quando houve apenas sinal em observe', () => {
  assert.match(corrigirAlegacaoMemoria(
    'Correção registrada para avaliação. Quer que eu reconsulte?',
    { motivo: 'correcao' },
    { modo: 'observe', oferecida: false }
  ), /nenhuma memória foi criada ou aprovada/i);
});

test('nao afirma que sinal foi enviado ou aceito sem candidatura governada', () => {
  for (const alegacao of [
    'Pronto — o sinal foi enviado para avaliação governada, mas nada foi memorizado ainda.',
    'O pedido foi aceito para avaliação e entrará no painel administrativo.'
  ]) {
    const corrigido = corrigirAlegacaoMemoria(alegacao, { motivo: 'regra_estavel' }, {
      modo: 'propose', oferecida: false
    });
    assert.match(corrigido, /não gerou uma candidatura disponível para aprovação/i);
    assert.match(corrigido, /nada foi enviado ao painel administrativo/i);
    assert.doesNotMatch(corrigido, /foi enviado para avaliação|aceito para avaliação/i);
  }
});

test('normaliza usage sem inventar campos ausentes ou contar cache duas vezes', () => {
  assert.deepEqual(normalizarUsageAnthropic({
    input_tokens: 100, output_tokens: 20,
    cache_read_input_tokens: 50, cache_creation_input_tokens: 10
  }), {
    inputTokens: 100, uncachedInputTokens: 100, outputTokens: 20,
    cacheReadTokens: 50, cacheWriteTokens: 10, serviceUsage: {},
    raw: {
      input_tokens: 100, output_tokens: 20,
      cache_read_input_tokens: 50, cache_creation_input_tokens: 10
    }
  });
  const openai = normalizarUsageOpenAI({
    input_tokens: 120, output_tokens: 30,
    input_tokens_details: { cached_tokens: 40 }
  });
  assert.equal(openai.uncachedInputTokens, 80);
  assert.equal(openai.cacheReadTokens, 40);
  assert.equal(normalizarUsageGemini({ promptTokenCount: 70 }).outputTokens, null);
});

test('auditoria falha fechada antes de executar a chamada paga', async () => {
  let executou = false;
  await assert.rejects(executarChamadaAuditada({
    telemetria: { async iniciarChamada() { throw new Error('db offline'); } },
    provider: 'teste', modelo: 'm', stage: 'generalist_response', purpose: 'general_chat',
    executar: async () => { executou = true; }, normalizarResposta: () => ({})
  }), /db offline/);
  assert.equal(executou, false);
});

test('falha ao concluir auditoria nao reclassifica a resposta paga e deixa a chamada pendente', async () => {
  let executou = 0;
  let conclusoes = 0;
  await assert.rejects(executarChamadaAuditada({
    telemetria: {
      async iniciarChamada() { return { id: 'call-1' }; },
      async concluirChamada() { conclusoes += 1; throw new Error('db offline'); }
    },
    provider: 'teste', modelo: 'm', stage: 'generalist_response', purpose: 'general_chat',
    executar: async () => { executou += 1; return { id: 'resposta' }; },
    normalizarResposta: () => ({ usage: {} })
  }), (erro) => erro.codigo === 'AUDITORIA_LLM_INCOMPLETA');
  assert.equal(executou, 1);
  assert.equal(conclusoes, 3);
});

test('telemetria sanitiza metadados sem remover indicadores operacionais', () => {
  assert.deepEqual(sanitizarMetadados({
    duracao_ms: 10, provider: 'anthropic', prompt: 'segredo',
    nested: { password: 'x', status: 'ok' }
  }), { duracao_ms: 10, provider: 'anthropic', nested: { status: 'ok' } });
});

test('provider Anthropic executa tool_use e devolve tool_result na rodada seguinte', async () => {
  const requisicoes = [];
  const respostas = [{
    id: 'msg_1', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 4 },
    content: [{ type: 'tool_use', id: 'tool_1', name: 'consultar_nexus', input: { objetivo: 'pedidos' } }]
  }, {
    id: 'msg_2', stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 8 },
    content: [{ type: 'text', text: 'Resposta final.' }]
  }];
  const cliente = { messages: { async create(req) { requisicoes.push(req); return respostas.shift(); } } };
  const chamadas = [];
  const provider = criarProviderAnthropic({ cliente, modelo: 'claude-teste' });
  const resultado = await provider.executar({
    pergunta: 'Quais pedidos?', instrucoes: 'Use a capability.', maxRodadas: 3,
    tools: [{
      definicao: {
        name: 'consultar_nexus', description: 'consulta',
        parameters: { type: 'object', properties: { objetivo: { type: 'string' } }, required: ['objetivo'] }
      },
      executar: async (args) => { chamadas.push(args); return '{"ok":true}'; }, terminal: false
    }]
  });
  assert.equal(resultado.texto, 'Resposta final.');
  assert.deepEqual(chamadas, [{ objetivo: 'pedidos' }]);
  const retorno = requisicoes[1].messages.at(-1).content[0];
  assert.equal(retorno.type, 'tool_result');
  assert.equal(retorno.tool_use_id, 'tool_1');
});

test('provider Anthropic e selecionavel e exige modelo', async (t) => {
  assert.equal(criarProvider({ nome: 'anthropic', modelo: 'claude-teste', cliente: {}, semFallback: true }).nome, 'anthropic');
  const modeloAmbiente = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  t.after(() => {
    if (modeloAmbiente === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = modeloAmbiente;
  });
  const provider = criarProviderAnthropic({ cliente: {} });
  await assert.rejects(provider.executar({ pergunta: 'x', instrucoes: 'x', tools: [], maxRodadas: 1 }), /exige um modelo/);
});

test('assistente responde conversa geral sem executar agente corporativo', async () => {
  let corporativo = false;
  const resultado = await executarAssistente('Explique EBITDA', {
    memoria: memoriaFalsa(), auditoriaIA: false, knowledgeMode: 'v1',
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar({ tools }) {
        assert.deepEqual(tools.map((item) => item.definicao.name), ['consultar_documentacao']);
        return { texto: 'EBITDA e um indicador.', provider: 'mock', modelo: 'mock' };
      }
    },
    executarAgenteCorporativo: async () => { corporativo = true; }
  });
  assert.equal(resultado.proveniencia, 'conhecimento_geral');
  assert.equal(corporativo, false);
});

test('generalista valida politica dinamicamente sem passar pelo roteador corporativo', async () => {
  let corporativo = false;
  let consultaRecebida = null;
  const resultado = await executarAssistente('Vou solicitar a senha dele pelo WhatsApp.', {
    memoria: memoriaFalsa(), auditoriaIA: false, knowledgeMode: 'v1',
    executarConsultarDocumentacaoTool: async (argumentos) => {
      consultaRecebida = argumentos;
      return { status: 'sucesso', resultados: [{
        titulo: 'Responsabilidade e uso de ativos', versao: 1, pagina: 3,
        trecho: 'Credenciais são pessoais e intransferíveis.',
        citacao: 'Responsabilidade e uso de ativos - versao 1, pagina 3'
      }] };
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar({ tools, instrucoes }) {
        assert.match(instrucoes, /compartilhar senha ou acesso/);
        const tool = tools.find((item) => item.definicao.name === 'consultar_documentacao');
        assert.ok(tool);
        const evidencia = JSON.parse(await tool.executar({
          consulta: 'compartilhamento de senha pelo WhatsApp', limite: 4,
          analisar_visual: false
        }));
        assert.equal(evidencia.status, 'sucesso');
        return { texto: 'Isso pode contrariar a política: credenciais são pessoais. Responsabilidade e uso de ativos - versao 1, pagina 3.', provider: 'mock', modelo: 'mock' };
      }
    },
    executarAgenteCorporativo: async () => { corporativo = true; }
  });
  assert.equal(corporativo, false);
  assert.equal(consultaRecebida.consulta, 'compartilhamento de senha pelo WhatsApp');
  assert.equal(resultado.documentacaoConsultada, true);
  assert.equal(resultado.proveniencia, 'dados_nexus');
});

test('guarda corporativa consulta o agente existente antes da resposta final', async () => {
  let perguntaCorporativa;
  let buscasWeb = 0;
  const resultado = await executarAssistente('Quais pedidos estão bloqueados hoje?', {
    memoria: memoriaFalsa(), auditoriaIA: false, webMode: 'v1',
    webSearchProvider: { nome: 'mock', async pesquisar() { buscasWeb += 1; return { status: 'empty', fontes: [] }; } },
    governanca: {
      async avaliar() { return { permitida: true }; },
      async iniciarTool() { return { callId: '00000000-0000-0000-0000-000000000001' }; },
      async concluirTool() {}
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar({ tools, mensagens }) {
        assert.equal(tools.length, 0);
        assert.match(mensagens.at(-1).content, /Evidencia corporativa/);
        return { texto: 'O produto foi localizado.', provider: 'mock', modelo: 'mock' };
      }
    },
    executarAgenteCorporativo: async (pergunta) => {
      perguntaCorporativa = pergunta;
      return {
        texto: 'Produto localizado.',
        roteamento: { perfilInicial: 'produto', ferramentasExecutadas: ['resolver_produto'] }
      };
    }
  });
  assert.equal(perguntaCorporativa, 'Quais pedidos estão bloqueados hoje?');
  assert.equal(buscasWeb, 0);
  assert.equal(resultado.proveniencia, 'dados_nexus');
  assert.deepEqual(resultado.evidencia.toolsUsed, ['resolver_produto']);
});

test('SQL corporativo e entregue diretamente sem passar por outra LLM', async () => {
  let chamouGeneralista = false;
  const resultado = await executarAssistente('Crie um SQL para meus produtos', {
    memoria: memoriaFalsa(), auditoriaIA: false,
    governanca: {
      async avaliar() { return { permitida: true }; },
      async iniciarTool() { return { callId: '00000000-0000-0000-0000-000000000001' }; },
      async concluirTool() {}
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar() { chamouGeneralista = true; return { texto: 'nao deveria ocorrer' }; }
    },
    executarAgenteCorporativo: async () => ({
      texto: 'SELECT sku FROM produto',
      roteamento: { perfilInicial: 'sql', ferramentasExecutadas: ['construir_sql'] }
    })
  });
  assert.equal(chamouGeneralista, false);
  assert.equal(resultado.texto, 'SELECT sku FROM produto');
  assert.equal(resultado.provider, 'nexus');
});

test('perguntas do protocolo corporativo chegam intactas sem sintese generalista', async () => {
  let chamouGeneralista = false;
  const perguntas = [
    'Em qual campo devo verificar o espaço ao final?',
    'Você quer verificar codigo_auxiliar, cod_fabrica ou ambos?'
  ].join('\n');
  const resultado = await executarAssistente(
    'Gere uma query para produtos ativos com espaço no final do código.',
    {
      memoria: memoriaFalsa(), auditoriaIA: false,
      governanca: {
        async avaliar() { return { permitida: true }; },
        async iniciarTool() { return { callId: '00000000-0000-0000-0000-000000000001' }; },
        async concluirTool() {}
      },
      generalistProvider: {
        nome: 'mock', modelo: 'mock',
        async executar() { chamouGeneralista = true; return { texto: 'perguntas alteradas' }; }
      },
      executarAgenteCorporativo: async () => ({
        texto: perguntas,
        provider: 'protocolo_interacao',
        interacao: {
          status: 'precisa_esclarecimento',
          tarefa: { tipo: 'construir_sql', camposPendentes: ['filtros'] }
        },
        roteamento: { esclarecimento: true }
      })
    }
  );
  assert.equal(chamouGeneralista, false);
  assert.equal(resultado.texto, perguntas);
  assert.equal(resultado.provider, 'nexus');
  assert.equal(resultado.evidencia.status, 'partial');
});

test('nao suportado pode receber orientacao limitada do generalista', async () => {
  let chamouGeneralista = false;
  const resultado = await executarAssistente('Gere uma query SQL de produtos usando uma fonte não catalogada.', {
    memoria: memoriaFalsa(), auditoriaIA: false,
    governanca: {
      async avaliar() { return { permitida: true }; },
      async iniciarTool() { return { callId: '00000000-0000-0000-0000-000000000001' }; },
      async concluirTool() {}
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar({ mensagens }) {
        chamouGeneralista = true;
        assert.match(mensagens.at(-1).content, /nao_suportado/);
        return {
          texto: 'Essa fonte ainda não está catalogada. Posso ajudar a definir os campos necessários.',
          provider: 'mock', modelo: 'mock'
        };
      }
    },
    executarAgenteCorporativo: async () => ({
      texto: 'A fonte solicitada não faz parte do catálogo aprovado.',
      interacao: { status: 'nao_suportado' },
      roteamento: { esclarecimento: false }
    })
  });
  assert.equal(chamouGeneralista, true);
  assert.match(resultado.texto, /ainda não está catalogada/i);
});

test('fallback generalista reutiliza a consulta Nexus feita no turno', async () => {
  let consultasCorporativas = 0;
  const primario = {
    nome: 'primario', modelo: 'p',
    async executar() {
      const erro = new Error('rate limit');
      erro.status = 429;
      throw erro;
    }
  };
  const fallback = {
    nome: 'fallback', modelo: 'f',
    async executar(contexto) {
      assert.equal(contexto.tools.length, 0);
      assert.match(
        contexto.mensagens.map((item) => String(item.content)).join('\n'),
        /Evidencia corporativa|Nao repita tools concluidas/
      );
      return { texto: 'Resposta preservada.', provider: 'fallback', modelo: 'f' };
    }
  };
  const resultado = await executarAssistente('Analise minhas vendas de hoje.', {
    memoria: memoriaFalsa(), auditoriaIA: false,
    governanca: {
      async avaliar() { return { permitida: true }; },
      async iniciarTool() { return { callId: '00000000-0000-0000-0000-000000000001' }; },
      async concluirTool() {}
    },
    generalistProvider: criarProviderResiliente(primario, fallback, { tentativasExtras: 0 }),
    executarAgenteCorporativo: async () => {
      consultasCorporativas += 1;
      return { texto: 'Dados localizados.', roteamento: { perfilInicial: 'vendas' } };
    }
  });
  assert.equal(consultasCorporativas, 1);
  assert.equal(resultado.fallbackDe, 'primario');
  assert.equal(resultado.proveniencia, 'dados_nexus');
});

test('historico visivel remove inicio invalido e combina papeis consecutivos', () => {
  assert.deepEqual(normalizarHistoricoVisivel([
    { role: 'assistant', content: 'orfao' },
    { role: 'user', content: 'parte 1' },
    { role: 'user', content: 'parte 2' },
    { role: 'tool', content: 'interno' },
    { role: 'assistant', content: 'resposta' }
  ]), [
    { role: 'user', content: 'parte 1\n\nparte 2' },
    { role: 'assistant', content: 'resposta' }
  ]);
});

test('assistente nunca conclui com resposta textual vazia', async () => {
  assert.equal(possuiTextoResposta('  '), false);
  assert.equal(possuiTextoResposta('Resposta'), true);
  await assert.rejects(executarAssistente('Explique EBITDA', {
    memoria: memoriaFalsa(), auditoriaIA: false,
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar() { return { texto: '', provider: 'mock', modelo: 'mock' }; }
    }
  }), (erro) => erro.codigo === 'RESPOSTA_VAZIA');
});

test('sintese invalida nao usa resposta corporativa vazia como fallback', async () => {
  await assert.rejects(executarAssistente('Quais pedidos internos estao bloqueados?', {
    memoria: memoriaFalsa(), auditoriaIA: false,
    governanca: {
      async avaliar() { return { permitida: true }; },
      async iniciarTool() { return { callId: '00000000-0000-0000-0000-000000000001' }; },
      async concluirTool() {}
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar() {
        return { texto: 'O pedido 701-3552839-4859420 esta bloqueado.', provider: 'mock', modelo: 'mock' };
      }
    },
    executarAgenteCorporativo: async () => ({
      texto: '',
      roteamento: {
        perfilInicial: 'bloqueios_estoque', ferramentasExecutadas: ['consultar_bloqueios_sem_estoque'],
        exigeSintese: true, evidenciaFactual: { status: 'partial', manifesto: { identificadores: [] } }
      }
    })
  }), (erro) => erro.codigo === 'RESPOSTA_CORPORATIVA_VAZIA');
});

test('CLI le configuracoes independentes da IA generalista', () => {
  const recebido = lerArgumentos([
    '--assistant-mode', 'generalist', '--generalist-provider', 'anthropic',
    '--generalist-model', 'claude-x', '--provider', 'groq',
    '--handoff-mode', 'v1', '--playbook-mode', 'assist',
    '--memory-automation-mode', 'propose', '--memory-review-provider', 'openai',
    '--memory-review-model', 'revisor-x', 'Ola'
  ]);
  assert.equal(recebido.opcoes.assistantMode, 'generalist');
  assert.equal(recebido.opcoes.generalistProviderNome, 'anthropic');
  assert.equal(recebido.opcoes.generalistModelo, 'claude-x');
  assert.equal(recebido.opcoes.providerNome, 'groq');
  assert.equal(recebido.opcoes.handoffMode, 'v1');
  assert.equal(recebido.opcoes.playbookMode, 'assist');
  assert.equal(recebido.opcoes.memoryAutomationMode, 'propose');
  assert.equal(recebido.opcoes.memoryReviewProviderNome, 'openai');
  assert.equal(recebido.opcoes.memoryReviewModelo, 'revisor-x');
  assert.equal(resolverModoAssistente('corporate'), 'corporate');
});
