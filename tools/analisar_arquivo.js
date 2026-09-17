const { complementarAnaliseDuckDb, extrairImagensDocxBuffers,
  renderizarPaginasSelecionadas, selecionarConteudo } = require('../nexus/file_processing');
const { classificarSensibilidade, processarImagemLocal } = require('../agentes/image_processing');

const definicaoAnalisarArquivo = Object.freeze({
  type: 'function', name: 'analisar_arquivo', strict: true,
  description: 'Analisa localmente arquivos PDF, DOCX ou XLSX já anexados e autorizados. Use para responder perguntas sobre documentos e planilhas.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      pergunta: { type: 'string', minLength: 2, maxLength: 2000 },
      attachmentIds: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
      profundidade: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
      analisarVisual: { type: 'boolean' }
    },
    required: ['pergunta', 'attachmentIds', 'profundidade', 'analisarVisual']
  }
});

async function executarAnalisarArquivo(argumentos, dependencias = {}) {
  const anexos = (dependencias.anexos || []).filter((x) => x.item?.kind === 'document');
  const permitidos = new Map(anexos.map((x) => [String(x.item.id), x]));
  const ids = [...new Set((argumentos.attachmentIds || []).map(String))];
  if (!ids.length || ids.some((id) => !permitidos.has(id))) {
    const erro = new Error('Um ou mais arquivos não pertencem a esta conversa ou não estão autorizados.');
    erro.codigo = 'ATTACHMENT_SCOPE_DENIED'; erro.status = 403; throw erro;
  }
  const resultados = [];
  for (const id of ids) {
    const anexo = permitidos.get(id);
    if (!anexo.extraido) throw new Error('O conteúdo local extraído do arquivo está indisponível.');
    let analise = selecionarConteudo(anexo.extraido, argumentos.pergunta, argumentos.profundidade);
    if (['xls', 'xlsx'].includes(anexo.item.format)) analise = await complementarAnaliseDuckDb(anexo.extraido, analise);
    const sensibilidade = classificarSensibilidade(JSON.stringify(analise));
    if (sensibilidade.sensivel) {
      if (analise.trechos) analise.trechos = analise.trechos.map((trecho) => ({
        ...trecho, texto: '[Conteúdo sensível preservado no processamento local.]'
      }));
      if (analise.amostra) analise.amostra = [];
    }
    resultados.push({ attachmentId: id, arquivo: anexo.item.file_name, formato: anexo.item.format,
      analise, envioExternoBloqueado: sensibilidade.sensivel,
      codigoSensibilidade: sensibilidade.codigo });
  }
  const visuais = [];
  for (const resultado of resultados) {
    const anexo = permitidos.get(resultado.attachmentId);
    let candidatos = [];
    if (anexo.item.format === 'pdf') {
      candidatos = (await renderizarPaginasSelecionadas(anexo.buffer,
        resultado.analise.paginasOcrPendente || [])).map((item) => ({
        buffer: item.buffer, referencia: `${anexo.item.file_name}, página ${item.numero}`
      }));
    } else if (anexo.item.format === 'docx' && argumentos.analisarVisual === true) {
      candidatos = (await extrairImagensDocxBuffers(anexo.buffer, 6)).map((item, indice) => ({
        buffer: item.buffer, referencia: `${anexo.item.file_name}, imagem incorporada ${indice + 1}`
      }));
    }
    for (const candidato of candidatos) {
      const local = await processarImagemLocal(candidato.buffer, {
        ocrWorker: dependencias.ocrWorker, detectarCodigo: dependencias.detectarCodigo
      });
      visuais.push({ attachmentId: resultado.attachmentId, referencia: candidato.referencia,
        textoOcr: local.texto || '', sensivel: local.sensibilidade?.sensivel === true,
        codigoSensibilidade: local.sensibilidade?.codigo || null,
        _buffer: local.buffer, _mime: local.mime });
    }
  }
  let interpretacaoVisual = null;
  const autorizadosVisao = visuais.filter((item) => !item.sensivel);
  if (argumentos.analisarVisual === true && autorizadosVisao.length && dependencias.interpretarVisuais) {
    interpretacaoVisual = await dependencias.interpretarVisuais({ pergunta: argumentos.pergunta,
      imagens: autorizadosVisao.map((item) => ({ referencia: item.referencia, buffer: item._buffer, mime: item._mime })) });
  }
  return { status: 'sucesso', pergunta: argumentos.pergunta, analisarVisual: argumentos.analisarVisual === true,
    resultados, ocrVisual: visuais.map(({ _buffer, _mime, ...item }) => item), interpretacaoVisual,
    regra: 'Cálculos, filtros e OCR foram executados localmente; use somente as referências retornadas.' };
}

module.exports = { definicaoAnalisarArquivo, executarAnalisarArquivo };
