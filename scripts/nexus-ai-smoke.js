const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { criarServicoAuditoriaIA } = require('../nexus/auditoria_ia');
const { relatorioTrace } = require('../nexus/relatorios_uso');

async function main() {
  const pool = criarPoolNexus();
  const sessao = `smoke-ia-${Date.now()}`;
  let turno;
  try {
    const auditoria = criarServicoAuditoriaIA({ pool, sessao, modo: 'observe' });
    turno = await auditoria.iniciarTurno({ finalidade: 'smoke_test' });
    const telemetria = auditoria.paraTelemetria(turno, { stage: 'generalist_response' });
    const chamada = await telemetria.iniciarChamada({
      provider: 'smoke', modelo: 'smoke-model', stage: 'generalist_response',
      purpose: 'smoke_test', composicao: { usuario: 3, instrucoes: 5 }
    });
    await telemetria.concluirChamada(chamada.id, {
      sucesso: true, duracaoMs: 1, responseId: 'smoke-response', stopReason: 'end_turn',
      usage: {
        inputTokens: 12, uncachedInputTokens: 12, outputTokens: 4,
        cacheReadTokens: 0, cacheWriteTokens: 0, serviceUsage: {}, raw: { input_tokens: 12, output_tokens: 4 }
      }
    });
    await auditoria.registrarMensagem(turno, {
      papel: 'user', conteudo: 'mensagem de smoke sem dado corporativo'
    });
    await auditoria.registrarMensagem(turno, {
      papel: 'assistant', conteudo: 'resposta de smoke', proveniencia: 'conhecimento_geral'
    });
    const mensagens = await auditoria.listarMensagens();
    if (mensagens.length !== 2) throw new Error('Historico visivel do smoke nao foi persistido.');
    await auditoria.concluirTurno(turno, {
      sucesso: true, proveniencia: 'conhecimento_geral'
    });
    const trace = await relatorioTrace(pool, turno.traceId);
    if (trace.chamadas.length !== 1) throw new Error('Trace smoke nao conciliou uma chamada.');
    console.log(JSON.stringify({
      status: 'ok', chamadas: trace.chamadas.length,
      input_tokens: String(trace.turno.input_tokens_total),
      output_tokens: String(trace.turno.output_tokens_total),
      pricing_complete: trace.turno.pricing_complete
    }));
    await auditoria.excluirConversa();
    if ((await auditoria.listarMensagens()).length !== 0) {
      throw new Error('Exclusao do conteudo da conversa falhou.');
    }
  } finally {
    if (turno) {
      await pool.query("DELETE FROM nexus.audit_events WHERE tipo='turn_summary' AND recurso=$1", [turno.traceId]);
      await pool.query('DELETE FROM nexus.ai_turns WHERE id=$1', [turno.id]);
      await pool.query('DELETE FROM nexus.conversations WHERE id=$1', [turno.conversationId]);
    }
    await pool.end();
  }
}

main().catch((erro) => { console.error(`Erro: ${erro.message}`); process.exitCode = 1; });
