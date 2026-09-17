const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { Document, ImageRun, Packer, Paragraph } = require('docx');

const { obterCapacidade, extrairReferenciasResultado } = require('../agentes/capacidades');
const { classificarPergunta, referenciaContextual } = require('../agentes/roteador');
const { aplicarPoliticaArgumentos, consultaDocumentalAncorada } = require('../agentes/politicas_tools');
const { exigeFonteCorporativa } = require('../agentes/politica_fonte');
const { permissaoDaFerramenta } = require('../nexus/governanca');
const { criarFileSystemKnowledgeStorage } = require('../nexus/knowledge_storage');
const { embeddingHash, DIMENSOES } = require('../nexus/embeddings');
const { gerarDocx, gerarPdf, normalizarConteudo } = require('../nexus/document_builder');
const { extrairDocumento, renderizarPaginaPdf, renderizarVisualDocx } = require('../nexus/document_parser');
const { baixarItemComRetry, classificarPasta, lerFontesOneDrive,
  listarArquivosFontesGraph, reconciliarOrigensDuplicadas,
  registrarImportacaoComRetry, removerDocumentosAusentes } = require('../nexus/documentacao_onedrive');
const { textoEstruturadoParaBusca } = require('../nexus/documentacao');
const { executarAgente, respostaIndisponibilidadeDocumental } = require('../agentes/consultor_nexus');
const { executarConsultarDocumentacao, interpretarPaginas } = require('../tools/consultar_documentacao');
const { caminhoRelativoSeguro, criarClienteGraphEscrita } = require('../integracoes/microsoft/graph');

test('roteador e politica de fonte reconhecem procedimento interno', () => {
  assert.equal(classificarPergunta('Qual é o procedimento para cadastrar um novo fornecedor?'), 'documentacao');
  assert.equal(classificarPergunta('Pode consultar se a política diz algo sobre isso?'), 'documentacao');
  assert.equal(exigeFonteCorporativa('Como faço este processo interno?').obrigatoria, true);
  assert.equal(permissaoDaFerramenta('consultar_documentacao'), 'documentacao.consultar');
  const capacidade = obterCapacidade('consultar_documentacao');
  assert.equal(capacidade.dominio, 'documentacao');
  assert.ok(capacidade.campos.includes('pagina_documento'));
});

test('status SSE reconhece validacao contextual de politicas', () => {
  const { statusDoCheckpoint } = require('../services/nexus-api/server');
  assert.equal(statusDoCheckpoint({ tipo: 'validacao_politica_iniciada' }), 'validando_politicas');
});

test('pergunta operacional sobre como desbloquear pedido consulta documentacao', () => {
  const pergunta = 'Estou com um pedido bloqueado com bloqueio de Pessoa Jurídica, como desbloqueio?';
  assert.equal(classificarPergunta(pergunta), 'documentacao');
  assert.deepEqual(exigeFonteCorporativa(pergunta), {
    obrigatoria: true, motivo: 'documentacao_corporativa'
  });
});

test('modo dados nao atravessa silenciosamente para a base documental', async () => {
  let chamouProvider = false;
  const resultado = await executarAgente(
    'Como desbloqueio um pedido com bloqueio de Pessoa Jurídica?',
    { sourceMode: 'dados', routerMode: 'legacy', memoria: false, auditoriaIA: false,
      provider: { nome: 'mock', modelo: 'mock', async executar() {
        chamouProvider = true; return { texto: 'nao deveria chamar' };
      } } }
  );
  assert.equal(chamouProvider, false);
  assert.equal(resultado.interacao.status, 'precisa_esclarecimento');
  assert.match(resultado.texto, /Verificar documentação/);
});

test('indice documental inclui todos os campos estruturados e nao apenas passos', () => {
  const texto = textoEstruturadoParaBusca({
    titulo: 'Rotina de liberação', resumo: 'Resumo confirmado.',
    conteudo_estruturado: {
      objetivo: 'Conteúdo principal sobre bloqueio de Pessoa Jurídica.',
      publico: 'Comercial', preRequisitos: ['ERP SYSEMP'],
      passos: [{ titulo: 'Localizar pedido', descricao: 'Abra a aplicação de desbloqueio.' }],
      alertas: ['Confirme o LOG PRINCIPAL'], referencias: ['Manual interno']
    }
  });
  for (const esperado of ['Resumo confirmado', 'Pessoa Jurídica', 'Comercial', 'ERP SYSEMP',
    'Localizar pedido', 'LOG PRINCIPAL', 'Manual interno']) assert.match(texto, new RegExp(esperado));
});

test('mapeia as pastas oficiais sem misturar setores', () => {
  assert.deepEqual(classificarPasta('PROCEDIMENTOS FINANCEIRO'), {
    escopo: 'setor', setorSlug: 'financeiro', tipo: 'procedimento'
  });
  assert.deepEqual(classificarPasta('PROCEDIMENTOS TECNOLOGIA'), {
    escopo: 'setor', setorSlug: 'ti', tipo: 'procedimento'
  });
  assert.deepEqual(classificarPasta('POLITICAS'), { escopo: 'global', tipo: 'politica' });
  assert.deepEqual(classificarPasta('POLITICAS INTERNAS'), { escopo: 'global', tipo: 'politica' });
  assert.equal(classificarPasta('PASTA DESCONHECIDA'), null);
});

test('catalogo Graph aceita varias raizes e arquivos globais sem perder o modo legado', () => {
  const fontes = lerFontesOneDrive({ sourcesJson: JSON.stringify([
    { key: 'procedimentos', rootItemId: 'pasta-1' },
    { key: 'politica-ti', itemId: 'arquivo-1', tipo: 'politica', escopo: 'global',
      titulo: 'Responsabilidade e uso de ativos' }
  ]) });
  assert.equal(fontes.length, 2);
  assert.equal(fontes[0].rootItemId, 'pasta-1');
  assert.deepEqual({ tipo: fontes[1].tipo, escopo: fontes[1].escopo },
    { tipo: 'politica', escopo: 'global' });
  assert.deepEqual(lerFontesOneDrive({ rootItemId: 'pasta-legada', sourcesJson: '' })
    .map(({ key, rootItemId }) => ({ key, rootItemId })),
  [{ key: 'legado', rootItemId: 'pasta-legada' }]);
  assert.throws(() => lerFontesOneDrive({ sources: [
    { key: 'duplicada', rootItemId: '1' }, { key: 'duplicada', rootItemId: '2' }
  ] }), /duplicada/);
});

test('fontes Graph exatas recebem classificacao governada e pastas continuam automaticas', async () => {
  const itens = {
    politica: { id: 'politica', name: 'Politica.pdf', file: { mimeType: 'application/pdf' } }
  };
  const graph = {
    async obterItem(id) { return itens[id]; },
    async listarFilhos({ itemId }) {
      if (itemId === 'procedimentos') return [{ id: 'financeiro', name: 'PROCEDIMENTOS FINANCEIRO', folder: {} }];
      if (itemId === 'financeiro') return [{ id: 'procedimento', name: 'Fechamento.pdf',
        file: { mimeType: 'application/pdf' } }];
      return [];
    }
  };
  const fontes = lerFontesOneDrive({ sources: [
    { key: 'procedimentos', rootItemId: 'procedimentos' },
    { key: 'politica', itemId: 'politica', tipo: 'politica', escopo: 'global' }
  ] });
  const resultado = await listarArquivosFontesGraph(graph, { driveId: 'drive', fontes });
  assert.equal(resultado.arquivos.length, 2);
  assert.deepEqual(resultado.arquivos.find((arquivo) => arquivo.item.id === 'procedimento').classificacao,
    { escopo: 'setor', setorSlug: 'financeiro', tipo: 'procedimento' });
  assert.deepEqual(resultado.arquivos.find((arquivo) => arquivo.item.id === 'politica').classificacao,
    { tipo: 'politica', escopo: 'global', setorSlug: null });
});

test('sincronizacao remove somente rascunhos ausentes de pastas lidas com sucesso', async () => {
  const removidos = [];
  const resultado = await removerDocumentosAusentes({
    driveId: 'drive',
    fontes: [
      { key: 'procedimentos', rootItemId: 'pasta' },
      { key: 'politica', itemId: 'politica', caminho: 'POLITICAS/Politica.pdf' }
    ],
    estados: [{ key: 'procedimentos', status: 'concluido' }, { key: 'politica', status: 'erro' }],
    arquivos: [{ sourceKey: 'procedimentos', caminho: 'PROCEDIMENTOS RH/Atual.pdf',
      item: { id: 'atual' } }],
    pool: { async query() { return { rows: [
      { id: 'mantido', external_item_id: 'atual', external_path: 'PROCEDIMENTOS RH/Atual.pdf' },
      { id: 'ausente', external_item_id: 'removido', external_path: 'PROCEDIMENTOS RH/Antigo.pdf' },
      { id: 'outro-setor', external_item_id: 'outro', external_path: 'PROCEDIMENTOS FINANCEIRO/Antigo.pdf' },
      { id: 'fonte-exata', external_item_id: 'politica', external_path: 'POLITICAS/Politica.pdf' }
    ] }; } },
    servico: { async removerRascunhoSincronizado(id) {
      removidos.push(id); return { documentId: id, removido: true, falhasArquivos: [] };
    } }
  });
  assert.deepEqual(removidos, ['ausente']);
  assert.deepEqual(resultado, { candidatos: 1, removidos: 1, protegidos: 0, falhas: [] });
});

test('reconciliacao de origem preserva o destino administrativo publicado', async () => {
  const caminho = 'PROCEDIMENTOS TECNOLOGIA/Manual.pdf';
  const resultado = await reconciliarOrigensDuplicadas({ principalId: 'principal', dryRun: true,
    pool: { async query() { return { rows: [
      { id: 'publicado', tipo: 'procedimento', escopo: 'global', external_path: caminho,
        external_drive_id: 'local-onedrive-sync', current_published_version_id: 'versao' },
      { id: 'novo', tipo: 'procedimento', escopo: 'setor', external_path: caminho,
        external_drive_id: 'graph', external_item_id: 'item', current_published_version_id: null }
    ] }; } } });
  assert.deepEqual(resultado, { encontrados: 1, consolidados: 0, candidatos: [{
    caminho: caminho.toLowerCase(), destinoId: 'publicado', origemId: 'novo',
    escopoPreservado: 'global'
  }] });
});

test('download documental repete somente falhas transitorias do Graph', async () => {
  let chamadas = 0;
  const resultado = await baixarItemComRetry({ async baixarItem() {
    chamadas += 1;
    if (chamadas === 1) throw new TypeError('terminated');
    return { buffer: Buffer.from('ok') };
  } }, 'item', 'drive', 2);
  assert.equal(resultado.buffer.toString(), 'ok');
  assert.equal(chamadas, 2);
  await assert.rejects(() => baixarItemComRetry({ async baixarItem() {
    throw new Error('Acesso negado');
  } }, 'item', 'drive', 3), /Acesso negado/);
});

test('registro documental repete queda transitoria do PostgreSQL sem mascarar erro permanente', async () => {
  let chamadas = 0;
  const resultado = await registrarImportacaoComRetry({ async registrarImportacao() {
    chamadas += 1;
    if (chamadas === 1) throw new Error('Connection terminated unexpectedly');
    return { duplicada: true };
  } }, { externalItemId: 'item' }, 2);
  assert.equal(resultado.duplicada, true);
  assert.equal(chamadas, 2);
});

test('storage documental restringe chaves a raiz autorizada', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-knowledge-'));
  const storage = criarFileSystemKnowledgeStorage({ root });
  const documentId = '11111111-1111-4111-8111-111111111111';
  const versionId = '22222222-2222-4222-8222-222222222222';
  const salvo = await storage.salvar({ buffer: Buffer.from('conteudo'), categoria: 'sources',
    documentId, versionId, extensao: 'pdf' });
  assert.equal((await storage.abrir(salvo.chave)).toString(), 'conteudo');
  await assert.rejects(() => storage.abrir('../../.env'), /Chave de conhecimento invalida/);
  await fs.rm(root, { recursive: true, force: true });
});

test('embedding local preserva contrato de 384 dimensoes', () => {
  const vetor = embeddingHash('procedimento de fechamento financeiro');
  assert.equal(vetor.length, DIMENSOES);
  const norma = Math.sqrt(vetor.reduce((soma, item) => soma + item * item, 0));
  assert.ok(Math.abs(norma - 1) < 0.0001);
});

test('texto longo colado como passo vira descricao sem causar erro operacional', () => {
  const texto = `4. Notificacoes ${'Detalhes do procedimento. '.repeat(18)}`;
  const conteudo = normalizarConteudo({ passos: [{ titulo: texto, descricao: '' }] });
  assert.equal(conteudo.passos[0].titulo, 'Passo 1');
  assert.equal(conteudo.passos[0].descricao, texto.trim());
  assert.throws(() => normalizarConteudo({ objetivo: 'x'.repeat(5001) }), (erro) => {
    assert.equal(erro.status, 400);
    assert.equal(erro.codigo, 'CONTEUDO_DOCUMENTO_INVALIDO');
    return true;
  });
});

test('gera e extrai DOCX e PDF estruturados, incluindo pagina visual', async () => {
  const entrada = { titulo: 'Procedimento de teste', tipo: 'procedimento', versao: 1,
    conteudo: { objetivo: 'Validar o fluxo documental.', publico: 'Tecnologia',
      preRequisitos: ['Acesso autorizado'], passos: [{ titulo: 'Abrir o sistema', descricao: 'Entre com sua conta.' }],
      alertas: ['Nao compartilhar credenciais'], referencias: [] } };
  const [docx, pdf] = await Promise.all([gerarDocx(entrada), gerarPdf(entrada)]);
  const docxExtraido = await extrairDocumento({ buffer: docx, nomeArquivo: 'teste.docx' });
  const pdfExtraido = await extrairDocumento({ buffer: pdf, nomeArquivo: 'teste.pdf' });
  assert.match(docxExtraido.texto, /Validar o fluxo documental/);
  assert.match(pdfExtraido.texto, /Procedimento de teste/);
  const png = await renderizarPaginaPdf(pdf, 1, { larguraMaxima: 700 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('tool documental injeta o setor do servidor e preserva citacoes', async () => {
  let recebido;
  const resultado = await executarConsultarDocumentacao({ consulta: 'fechamento', limite: 4 }, {
    knowledgeMode: 'v1', departamentoId: '33333333-3333-4333-8333-333333333333',
    servicoDocumentacao: { async buscar(entrada) { recebido = entrada; return {
      status: 'sucesso', resultados: [{ citacao: 'Fechamento - versao 2, pagina 4' }]
    }; } }
  });
  assert.equal(recebido.departmentId, '33333333-3333-4333-8333-333333333333');
  assert.equal(resultado.resultados[0].citacao, 'Fechamento - versao 2, pagina 4');
});

test('cartao da fonte publicada preserva o setor para revalidar o download', async () => {
  const departmentId = '33333333-3333-4333-8333-333333333333';
  const resultado = await executarConsultarDocumentacao({
    consulta: 'Quero baixar o documento original', limite: 4, analisar_visual: false
  }, {
    knowledgeMode: 'v1', departamentoId: departmentId,
    servicoDocumentacao: { async buscar() { return { status: 'sucesso', resultados: [{
      documento_id: '11111111-1111-4111-8111-111111111111', titulo: 'Manual aprovado',
      versao: 3, formato: 'pdf', trecho: 'Conteúdo autorizado.'
    }] }; } }
  });
  assert.equal(resultado.fontes_download.length, 1);
  assert.equal(resultado.fontes_download[0].url,
    `/v1/knowledge/11111111-1111-4111-8111-111111111111/download/source?departmentId=${departmentId}`);
});

test('tool documental repete uma falha tecnica e preserva o resultado recuperado', async () => {
  let tentativas = 0;
  const eventos = [];
  const auditados = [];
  const resultado = await executarConsultarDocumentacao({
    consulta: 'procedimento Leroy Merlin', limite: 8, analisar_visual: false
  }, {
    knowledgeMode: 'v1', departamentoId: 'setor-comercial',
    onEvento: (evento) => eventos.push(evento),
    turnoIA: { id: 'turno-1' },
    auditoriaIA: { async registrarEvento(_turno, evento) { auditados.push(evento); } },
    servicoDocumentacao: { async buscar() {
      tentativas += 1;
      if (tentativas === 1) {
        const erro = new Error('conexao encerrada');
        erro.code = 'ECONNRESET';
        throw erro;
      }
      return { status: 'sucesso', resultados: [{ titulo: 'Procedimento Portal Leroy Merlin' }] };
    } }
  });
  assert.equal(tentativas, 2);
  assert.equal(resultado.status, 'sucesso');
  assert.match(eventos.join(' '), /repetindo uma vez/i);
  assert.equal(auditados[0].tipo, 'document_retrieval_retry');
  assert.equal(auditados[0].metadados.erro_codigo, 'DOCUMENTACAO_DEPENDENCIA_INDISPONIVEL');
});

test('modo documental inativo falha como configuracao sem repetir a consulta', async () => {
  let tentativas = 0;
  await assert.rejects(() => executarConsultarDocumentacao({
    consulta: 'politica de credenciais', limite: 8, analisar_visual: false
  }, {
    knowledgeMode: 'shadow',
    servicoDocumentacao: { async buscar() {
      tentativas += 1;
      return { status: 'sucesso', resultados: [] };
    } }
  }), (erro) => {
    assert.equal(erro.codigo, 'KNOWLEDGE_MODE_INACTIVE');
    assert.match(erro.message, /ainda nao esta ativa/i);
    return true;
  });
  assert.equal(tentativas, 0);
});

test('falha documental persistente vira indisponibilidade e nunca ausencia de documento', async () => {
  let tentativas = 0;
  await assert.rejects(() => executarConsultarDocumentacao({
    consulta: 'procedimento Leroy Merlin', limite: 8, analisar_visual: false
  }, {
    knowledgeMode: 'v1', departamentoId: 'setor-comercial',
    servicoDocumentacao: { async buscar() {
      tentativas += 1;
      const erro = new Error('timeout do banco');
      erro.code = 'ETIMEDOUT';
      throw erro;
    } }
  }), (erro) => {
    assert.equal(erro.codigo, 'DOCUMENTACAO_TIMEOUT');
    assert.match(erro.message, /temporariamente indisponivel/i);
    return true;
  });
  assert.equal(tentativas, 2);
  assert.match(respostaIndisponibilidadeDocumental(), /não significa que o procedimento não exista/i);
});

test('continuacao documental preserva o documento e encaminha a busca de acesso', async () => {
  const documentoId = '11111111-1111-4111-8111-111111111111';
  const referencias = extrairReferenciasResultado({ resultados: [{
    documento_id: documentoId, trecho: 'Acesse https://intranet.exemplo/chamados.'
  }] });
  assert.deepEqual(referencias.documento_id, [documentoId]);
  assert.equal(referenciaContextual('Tá, mas onde devo fazer tudo isso?'), true);
  const argumentos = aplicarPoliticaArgumentos('consultar_documentacao', {
    consulta: 'onde devo fazer tudo isso?', limite: 8, analisar_visual: false
  }, {
    pergunta: 'Tá, mas onde devo fazer tudo isso?', referenciasAnteriores: referencias
  });
  assert.equal(argumentos.documento_id, documentoId);

  let recebido;
  await executarConsultarDocumentacao(argumentos, {
    knowledgeMode: 'v1', departamentoId: '33333333-3333-4333-8333-333333333333',
    servicoDocumentacao: { async buscar(entrada) { recebido = entrada;
      return { status: 'sucesso', resultados: [] }; } }
  });
  assert.equal(recebido.documentId, documentoId);
});

test('nova busca documental nao fica presa ao documento irrelevante anterior', () => {
  const documentoAnterior = '11111111-1111-4111-8111-111111111111';
  const argumentos = aplicarPoliticaArgumentos('consultar_documentacao', {
    consulta: 'reutilizar busca anterior', documento_id: documentoAnterior,
    limite: 8, analisar_visual: false
  }, {
    perguntaAtual: 'Busque por manual de marca',
    referenciasAnteriores: { documento_id: [documentoAnterior] }
  });
  assert.equal(argumentos.documento_id, undefined);
  assert.equal(argumentos.consulta, 'Busque por manual de marca');
});

test('expansao de marca exige intencao explicita e ignora cor ou logo isolados', () => {
  assert.match(consultaDocumentalAncorada(
    'Preciso fazer um banner da FID seguindo o padrão da marca.'
  ), /manual de marca; identidade visual/i);
  assert.match(consultaDocumentalAncorada('Quero o manual de marca da FID.'),
    /Termos de recuperação/i);
  assert.equal(consultaDocumentalAncorada('Qual cor combina com azul?'), null);
  assert.equal(consultaDocumentalAncorada('Pode aumentar esse logo?'), null);
});

test('renderiza imagens incorporadas no Word e envia somente paginas autorizadas para visao', async () => {
  const imagem = await sharp({ create: { width: 80, height: 40, channels: 3,
    background: '#42ff9b' } }).png().toBuffer();
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('Exemplo visual'),
    new Paragraph({ children: [new ImageRun({ data: imagem, transformation: { width: 80, height: 40 } })] })
  ] }] }));
  const pagina = await renderizarVisualDocx(docx);
  assert.deepEqual([...pagina.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let mensagem;
  const resultado = await interpretarPaginas([{
    documento_id: 'doc-1', titulo: 'Procedimento', versao: 2, pagina: 3,
    pagina_visual_disponivel: true, citacao: 'Procedimento - versao 2, pagina 3'
  }], 'Onde clico?', { async abrirPaginaVisual() { return pagina; } }, {
    departamentoId: 'setor-1', knowledgeVisionModelo: 'modelo-teste',
    ocrWorker: { async recognize() { return { data: { text: '', confidence: 99 } }; } },
    detectarCodigo: async () => [],
    knowledgeVisionProvider: { async executar(entrada) { mensagem = entrada.mensagens;
      return { texto: 'Clique no botao verde.' }; } }
  });
  assert.equal(resultado.status, 'sucesso');
  assert.equal(resultado.paginas[0].citacao, 'Procedimento - versao 2, pagina 3');
  assert.ok(mensagem[0].content.some((bloco) => bloco.type === 'image'));
});

test('negacao da visao preserva os trechos documentais autorizados', async () => {
  const resultado = await executarConsultarDocumentacao({
    consulta: 'procedimento visual', limite: 2, analisar_visual: true
  }, {
    knowledgeMode: 'v1', departamentoId: 'setor-1', knowledgeVisionModelo: 'modelo-teste',
    governanca: { async iniciarTool() { const erro = new Error('Acesso negado.');
      erro.codigo = 'ACESSO_NEGADO'; throw erro; } },
    servicoDocumentacao: { async buscar() { return { status: 'sucesso', resultados: [{
      documento_id: 'doc-1', titulo: 'Procedimento', versao: 1, pagina: 2,
      pagina_visual_disponivel: true, trecho: 'Etapa textual comprovada.',
      citacao: 'Procedimento - versao 1, pagina 2'
    }] }; } }
  });
  assert.equal(resultado.status, 'sucesso');
  assert.equal(resultado.resultados[0].trecho, 'Etapa textual comprovada.');
  assert.equal(resultado.analise_visual.status, 'indisponivel');
  assert.equal(resultado.analise_visual.codigo, 'ACESSO_NEGADO');
});

test('migration documental instala vetores, versoes e permissoes', async () => {
  const sql = await fs.readFile(path.join(__dirname, '..', 'nexus', 'migrations',
    '011_documentacao_governada.sql'), 'utf8');
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /knowledge_document_versions/);
  assert.match(sql, /documentacao\.publicar\.setor/);
  assert.match(sql, /vector\(384\)/);
});

test('cliente Graph de escrita fica restrito a raiz documental', async () => {
  assert.throws(() => caminhoRelativoSeguro('../segredo'), /Caminho de publicacao invalido/);
  let requisicao;
  const cliente = criarClienteGraphEscrita({ driveId: 'drive', credenciais: {} }, {
    rootPath: 'Base Nexus', obterToken: async () => 'token',
    fetchImpl: async (url, init) => {
      requisicao = { url, init };
      return { ok: true, json: async () => ({ id: '1', name: 'arquivo.pdf' }) };
    }
  });
  await cliente.enviarArquivo({ caminho: 'POLITICAS/Teste.pdf', buffer: Buffer.from('pdf'),
    contentType: 'application/pdf' });
  assert.match(requisicao.url, /Base%20Nexus\/POLITICAS\/Teste\.pdf/);
  assert.equal(requisicao.init.method, 'PUT');
});
