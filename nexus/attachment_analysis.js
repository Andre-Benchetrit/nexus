const crypto = require('node:crypto');
const { classificarSensibilidade } = require('../agentes/image_processing');
const { selecionarConteudo, complementarAnaliseDuckDb } = require('./file_processing');
const { classificacaoMaisRestrita } = require('./attachment_intelligence_store');
const { validarAttachmentEvidence, validarAttachmentIr } = require('./attachment_evidence_schema');
const { detectarMelhorTabela, detectarTabelaEmAba } = require('./spreadsheet_table_detection');

const ANALYZER_VERSION = 'attachment-analysis-v3';
const IR_VERSION = 'attachment-ir-v3';
const DEFAULT_EVIDENCE_BYTES = 32 * 1024;
const PROMPT_INJECTION = /\b(?:ignore|ignorar|desconsidere|esque[cç]a|revele|mostre|exiba|substitua|finja|aja como|execute|chame|use)\b[\s\S]{0,90}\b(?:instru[cç][oõ]es?|prompt|sistema|system|developer|ferramenta|tool|pol[ií]tica|permiss[aã]o|senha|segredo|token)\b|\b(?:system|assistant|developer)\s*:/gi;

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function resolverModoInteligenciaAnexos(valor = process.env.NEXUS_ATTACHMENT_INTELLIGENCE_MODE) {
  const inferido = String(process.env.NEXUS_FILES_MODE || 'off').toLowerCase() === 'v1' ? 'v1' : 'off';
  const modo = String(valor || inferido).toLowerCase();
  if (!['off', 'shadow', 'v1'].includes(modo)) {
    const erro = new Error(`NEXUS_ATTACHMENT_INTELLIGENCE_MODE invalido: ${modo}.`);
    erro.codigo = 'ATTACHMENT_INTELLIGENCE_MODE_INVALID';
    throw erro;
  }
  return modo;
}

function hashJson(valor) {
  return crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex');
}

function valorCelula(valor) {
  if (valor == null) return null;
  if (typeof valor !== 'object') return valor;
  if (Object.hasOwn(valor, 'valorCalculado')) return valor.valorCalculado;
  if (Object.hasOwn(valor, 'valor')) return valor.valor;
  return String(valor.result ?? valor.text ?? '');
}

function letraColuna(indice) {
  let numero = Number(indice); let saida = '';
  while (numero > 0) { numero -= 1; saida = String.fromCharCode(65 + numero % 26) + saida; numero = Math.floor(numero / 26); }
  return saida || String(indice);
}

function textoCompleto(extraido) {
  if (!extraido) return '';
  if (extraido.tipo === 'pdf') return (extraido.paginas || []).map((pagina) => pagina.texto || '').join('\n');
  if (extraido.tipo === 'docx') return [
    ...(extraido.secoes || []).flatMap((secao) => [
      secao.titulo || '', ...(secao.blocos || []).map((bloco) => bloco.texto || '')
    ]),
    ...(extraido.imagens || []).flatMap((imagem) => [
      imagem.textoOcr || '', ...(imagem.codigos || []).map((item) => item.valor || '')
    ])
  ].join('\n');
  if (extraido.tipo === 'xlsx') return (extraido.abas || []).flatMap((aba) => [
    aba.nome || '', ...(aba.linhas || []).flatMap((linha) => Object.values(linha.valores || {}).map((valor) => {
      if (valor?.tipo === 'formula') return `${valor.formula || ''}\n${valorCelula(valor) ?? ''}`;
      return String(valorCelula(valor) ?? '');
    }))
  ]).concat((extraido.nomesDefinidos || []).flatMap((item) => [
    item.nome || '', ...(item.referencias || [])
  ])).join('\n');
  if (extraido.tipo === 'image') return [extraido.texto || '', ...(extraido.codigos || []).map((item) => item.valor || '')].join('\n');
  return '';
}

function detectarRiscosConteudo(extraido, contexto = {}) {
  const texto = [textoCompleto(extraido), contexto.fileName || contexto.nome || '',
    JSON.stringify(contexto.safeMetadata || contexto.metadados || {})].join('\n');
  const sensibilidade = classificarSensibilidade(texto);
  const verificacaoIncompleta = extraido?.ocrIncomplete === true || extraido?.ocrFalhou === true;
  const matches = texto.match(PROMPT_INJECTION) || [];
  PROMPT_INJECTION.lastIndex = 0;
  return {
    classification: sensibilidade.sensivel || verificacaoIncompleta ? 'sensivel' : 'conversa_privada',
    sensitive: sensibilidade.sensivel || verificacaoIncompleta,
    sensitivityCode: sensibilidade.codigo || (verificacaoIncompleta ? 'DLP_INCOMPLETE' : null),
    promptInjectionSuspected: matches.length > 0,
    promptInjectionMatches: Math.min(1000, matches.length),
    taint: 'untrusted_attachment_evidence'
  };
}

function classificarIntencaoUsuario(pergunta, sourceMode = 'automatico') {
  const texto = normalizar(pergunta);
  const artifact = /\b(?:gere|crie|monte|exporte|produza|faca)\b[\s\S]{0,100}\b(?:arquivo|planilha|xlsx|excel|docx|word|pdf|relatorio|documento)\b/.test(texto) ||
    /\b(?:quero|preciso)\s+(?:de\s+)?(?:um|uma)?\s*(?:arquivo|planilha|xlsx|excel|docx|word|pdf|relatorio|documento)\b/.test(texto);
  const compare = /\b(?:compare|comparar|diferenca|divergencia|cruze|cruzar)\b/.test(texto);
  const formula = /\b(?:formula|funcao|calculo|celula|referencia)\b/.test(texto);
  const count = /\b(?:quantas?|contagem|numero|total)\b[\s\S]{0,50}\b(?:linhas?|colunas?|abas?|paginas?|registros?|celulas?)\b/.test(texto) ||
    /\b(?:linhas?|colunas?|abas?|paginas?|registros?|celulas?)\b[\s\S]{0,50}\b(?:tem|existem|possui)\b/.test(texto);
  const documentation = sourceMode === 'documentacao' || /\b(?:politica|procedimento|manual|documentacao)\b/.test(texto);
  const web = sourceMode === 'web' || /\b(?:pesquise|pesquisar|busque na web|internet|site publico)\b/.test(texto);
  const domains = [];
  if (/\b(?:venda|vendas|faturamento|receita|pedido pago)\b/.test(texto)) domains.push('vendas');
  if (/\b(?:estoque|saldo|reservado|ruptura)\b/.test(texto)) domains.push('estoque');
  if (/\b(?:catalogo|cadastro|sku|ean|codigo auxiliar|codigo de barras)\b/.test(texto)) domains.push('catalogo');
  const corporateExplicit = sourceMode === 'dados' ||
    /\b(?:sysemp|dados internos|base interna|base corporativa|dados corporativos|sistema da empresa|cadastro da empresa|no nexus|do nexus)\b/.test(texto);
  const enrichment = /\b(?:consulte|consultar|busque|buscar|puxe|puxar|traga|trazer|ao lado|adicione|adicionar|inclua|incluir|enrique[cç]a|enriquecer|cruze|cruzar)\b/.test(texto);
  const currentStock = domains.includes('estoque') && /\b(?:estoque atual|saldo atual|sem estoque|ruptura)\b/.test(texto);
  const currentSales = domains.includes('vendas') && /\b(?:este|neste|ultimo|ultimos|mes atual|hoje|agora)\b/.test(texto) &&
    /\b(?:mais vendeu|mais vendido|vendas?|faturamento|receita)\b/.test(texto);
  const mixedCorporate = domains.length > 0 && (corporateExplicit || enrichment || currentStock || currentSales);
  const action = artifact ? 'gerar_arquivo' : compare ? 'comparar' : formula ? 'explicar_formula'
    : count ? 'contar' : /\b(?:resuma|resumir|resumo)\b/.test(texto) ? 'resumir' : 'analisar';
  const route = sourceMode === 'web' ? 'web' : sourceMode === 'documentacao' ? 'documentation'
    : mixedCorporate || sourceMode === 'dados' ? 'mixed_corporate'
      : artifact ? 'artifact' : web ? 'web' : documentation ? 'documentation' : 'local_file';
  return Object.freeze({ action, route, domains: [...new Set(domains)], compare, formula, count,
    artifact, documentation, web, sourceMode, source: 'user_message_only' });
}

function referenciasFormula(formula) {
  const texto = String(formula || '');
  const externa = /\[[^\]]+\]|https?:\/\//i.test(texto);
  const funcoes = [...texto.matchAll(/\b([A-Z][A-Z0-9._]*)\s*\(/gi)].map((item) => item[1].toUpperCase());
  const referencias = [...texto.matchAll(/(?:(?:'([^']+)'|([A-Za-z0-9_ ]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g)]
    .map((item) => ({ sheet: (item[1] || item[2] || '').trim() || null,
      from: `${item[3].toUpperCase()}${item[4]}`,
      to: item[5] ? `${item[5].toUpperCase()}${item[6]}` : null }));
  return { formula: texto.slice(0, 4000), functions: [...new Set(funcoes)].slice(0, 30),
    references: referencias.slice(0, 100), externalReference: externa, executed: false };
}

function manifestoXlsx(extraido) {
  let formulas = 0;
  const sheets = (extraido.abas || []).map((aba) => {
    let cells = 0; let sheetFormulas = 0;
    for (const linha of aba.linhas || []) for (const valor of Object.values(linha.valores || {})) {
      cells += 1;
      if (valor?.tipo === 'formula') { formulas += 1; sheetFormulas += 1; }
    }
    const tabela = detectarTabelaEmAba(aba);
    return { name: aba.nome, range: aba.range, populatedRows: aba.linhas?.length || 0,
      dataRows: tabela?.linhas.length || 0, cells, formulas: sheetFormulas,
      table: tabela ? { headerRow: tabela.headerRow, range: tabela.intervalo,
        columns: tabela.colunas.map((item) => item.rotulo), method: tabela.metodo } : null };
  });
  return { format: extraido.sourceFormat || 'xlsx', sheets, sheetCount: sheets.length,
    cellCount: sheets.reduce((total, aba) => total + aba.cells, 0), formulaCount: formulas,
    definedNameCount: extraido.nomesDefinidos?.length || 0 };
}

function construirManifesto(extraido) {
  if (extraido?.tipo === 'xlsx') return manifestoXlsx(extraido);
  if (extraido?.tipo === 'pdf') return { format: 'pdf', pageCount: extraido.paginas?.length || 0,
    imagePages: (extraido.paginas || []).filter((pagina) => pagina.possuiImagem).map((pagina) => pagina.numero),
    textCharacters: (extraido.paginas || []).reduce((n, pagina) => n + String(pagina.texto || '').length, 0),
    blocks: (extraido.paginas || []).reduce((n, pagina) => n + (pagina.blocos?.length || 0), 0),
    tables: (extraido.paginas || []).reduce((n, pagina) => n + (pagina.tabelas?.length || 0), 0) };
  if (extraido?.tipo === 'docx') return { format: 'docx', sectionCount: extraido.secoes?.length || 0,
    imageCount: extraido.imageCount || 0,
    blocks: (extraido.secoes || []).reduce((n, secao) => n + (secao.blocos?.length || 0), 0),
    sections: (extraido.secoes || []).map((secao) => secao.titulo).slice(0, 200) };
  if (extraido?.tipo === 'image') return { format: extraido.format || 'image', width: extraido.width || null,
    height: extraido.height || null, ocrCharacters: String(extraido.texto || '').length,
    codeCount: extraido.codigos?.length || 0 };
  return { format: 'unknown' };
}

function criarAttachmentIr(anexo) {
  if (!anexo?.item || !anexo?.extraido) {
    const erro = new Error('O anexo nao possui conteudo canonico extraido.');
    erro.codigo = 'ATTACHMENT_IR_SOURCE_INVALID';
    throw erro;
  }
  return validarAttachmentIr({
    schema: 'attachment_ir_v3',
    irVersion: IR_VERSION,
    source: {
      hash: anexo.item.sha256 || null,
      format: anexo.item.format || anexo.extraido.tipo || null,
      mediaType: anexo.item.media_type || null
    },
    manifest: construirManifesto(anexo.extraido),
    content: anexo.extraido
  });
}

function construirEntradasIndice(extraido) {
  const entradas = [];
  if (extraido?.tipo === 'pdf') {
    for (const pagina of extraido.paginas || []) {
      entradas.push({
        locatorType: 'page', locator: { type: 'pdf', page: pagina.numero },
        text: pagina.texto || pagina.textoOcr || '',
        safeMetadata: { hasImage: pagina.possuiImagem === true,
          characters: String(pagina.texto || pagina.textoOcr || '').length,
          blocks: pagina.blocos?.length || 0, tables: pagina.tabelas?.length || 0 }
      });
      for (const tabela of pagina.tabelas || []) entradas.push({
        locatorType: 'table', locator: { type: 'pdf', page: pagina.numero, table: tabela.indice },
        text: (tabela.linhas || []).map((linha) => linha.join(' | ')).join('\n'),
        safeMetadata: { detection: tabela.deteccao, rows: tabela.linhas?.length || 0 }
      });
    }
  } else if (extraido?.tipo === 'docx') {
    for (const [indice, secao] of (extraido.secoes || []).entries()) entradas.push({
      locatorType: 'section', locator: { type: 'docx', section: secao.titulo, ordinal: indice },
      text: `${secao.titulo || ''}\n${(secao.blocos || []).map((bloco) => bloco.texto || '').join('\n')}`,
      safeMetadata: { level: secao.nivel || null, blocks: secao.blocos?.length || 0 }
    });
    for (const imagem of extraido.imagens || []) entradas.push({
      locatorType: 'image', locator: { type: 'docx', section: imagem.section,
        image: imagem.indice },
      text: [imagem.textoOcr || '', ...(imagem.codigos || []).map((item) => item.valor || '')].join('\n'),
      safeMetadata: { ocrCharacters: String(imagem.textoOcr || '').length,
        ocrFailed: imagem.ocrFalhou === true }
    });
  } else if (extraido?.tipo === 'xlsx') {
    const tipoPlanilha = extraido.sourceFormat || 'xlsx';
    for (const [indiceAba, aba] of (extraido.abas || []).entries()) {
      entradas.push({
        locatorType: 'sheet', locator: { type: tipoPlanilha, sheet: aba.nome, range: aba.range },
        text: `${aba.nome || ''}\n${(aba.linhas || []).slice(0, 200).flatMap((linha) =>
          Object.values(linha.valores || {}).map((valor) => String(valorCelula(valor) ?? ''))).join('\n')}`,
        safeMetadata: { ordinal: indiceAba, populatedRows: aba.linhas?.length || 0, range: aba.range || null }
      });
      for (const linha of aba.linhas || []) {
        const texto = Object.values(linha.valores || {}).map((valor) => String(valorCelula(valor) ?? '')).join(' ');
        entradas.push({
          locatorType: 'range', locator: { type: tipoPlanilha, sheet: aba.nome, row: linha.numero },
          text: texto, safeMetadata: { populatedCells: Object.keys(linha.valores || {}).length }
        });
      }
    }
    for (const nome of extraido.nomesDefinidos || []) entradas.push({
      locatorType: 'defined_name', locator: { type: extraido.sourceFormat || 'xlsx', definedName: nome.nome },
      text: `${nome.nome}\n${(nome.referencias || []).join('\n')}`,
      safeMetadata: { references: nome.referencias?.length || 0 }
    });
  } else if (extraido?.tipo === 'image') {
    entradas.push({ locatorType: 'image', locator: { type: 'image', image: 1 },
      text: [extraido.texto || '', ...(extraido.codigos || []).map((item) => item.valor || '')].join('\n'),
      safeMetadata: { width: extraido.width || null, height: extraido.height || null,
        ocrCharacters: String(extraido.texto || '').length, codeCount: extraido.codigos?.length || 0 }
    });
  }
  return entradas.slice(0, 100000);
}

function fatosExatos(anexo) {
  const manifesto = construirManifesto(anexo.extraido);
  const base = { attachmentId: String(anexo.item.id), file: anexo.item.file_name, format: anexo.item.format };
  if (['xls', 'xlsx'].includes(manifesto.format)) return [
    { ...base, kind: 'sheet_count', value: manifesto.sheetCount, locator: { type: 'workbook' }, method: 'local_parser' },
    { ...base, kind: 'cell_count', value: manifesto.cellCount, locator: { type: 'workbook' }, method: 'local_parser' },
    { ...base, kind: 'defined_name_count', value: manifesto.definedNameCount,
      locator: { type: 'workbook' }, method: 'local_parser' },
    ...manifesto.sheets.map((sheet) => ({ ...base, kind: 'data_rows', value: sheet.dataRows,
      locator: { type: manifesto.format, sheet: sheet.name, range: sheet.range }, method: 'local_parser' }))
  ];
  if (manifesto.format === 'pdf') return [{ ...base, kind: 'page_count', value: manifesto.pageCount,
    locator: { type: 'pdf' }, method: 'local_parser' }];
  if (manifesto.format === 'docx') return [{ ...base, kind: 'section_count', value: manifesto.sectionCount,
    locator: { type: 'docx' }, method: 'local_parser' }];
  if (anexo.extraido?.tipo === 'image') return [{ ...base, kind: 'dimensions',
    value: { width: manifesto.width, height: manifesto.height }, locator: { type: 'image' }, method: 'local_parser' }];
  return [];
}

function formulasRelevantes(anexo, maximo = 20) {
  if (anexo.extraido?.tipo !== 'xlsx') return [];
  const saida = [];
  for (const aba of anexo.extraido.abas || []) for (const linha of aba.linhas || []) {
    for (const [coluna, valor] of Object.entries(linha.valores || {})) {
      if (valor?.tipo !== 'formula') continue;
      saida.push({ attachmentId: String(anexo.item.id), file: anexo.item.file_name,
        locator: { type: anexo.extraido.sourceFormat || 'xlsx', sheet: aba.nome, cell: `${letraColuna(coluna)}${linha.numero}` },
        ...referenciasFormula(valor.formula), cachedValue: valor.valorCalculado ?? null });
      if (saida.length >= maximo) return saida;
    }
  }
  return saida;
}

function cortarTexto(valor, limite = 2500) {
  const texto = String(valor || '');
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`;
}

function sanitizarEvidencia(analise) {
  const copia = JSON.parse(JSON.stringify(analise || {}));
  if (Array.isArray(copia.trechos)) copia.trechos = copia.trechos.slice(0, 8).map((item) => ({
    ...item, texto: cortarTexto(item.texto, 2500)
  }));
  if (Array.isArray(copia.amostra)) copia.amostra = copia.amostra.slice(0, 20);
  return copia;
}

function redigirEnvelopeSensivel({ manifests, exactFacts, formulas, evidence, relations }) {
  const sensiveis = new Set(manifests.filter((item) => item.security?.sensitive)
    .map((item) => String(item.attachmentId)));
  if (!sensiveis.size) return { manifests, exactFacts, formulas, evidence, relations, redacted: false };
  const nomeSeguro = (attachmentId, fallback) => sensiveis.has(String(attachmentId))
    ? `Anexo ${[...sensiveis].indexOf(String(attachmentId)) + 1}` : fallback;
  return {
    manifests: manifests.map((item) => sensiveis.has(String(item.attachmentId)) ? {
      ...item, file: nomeSeguro(item.attachmentId, item.file),
      ...(item.sections ? { sections: [] } : {})
    } : item),
    exactFacts: exactFacts.map((item) => ({ ...item, file: nomeSeguro(item.attachmentId, item.file) })),
    formulas: formulas.map((item) => sensiveis.has(String(item.attachmentId)) ? {
      attachmentId: item.attachmentId, file: nomeSeguro(item.attachmentId, item.file),
      locator: item.locator, redacted: true, executed: false
    } : item),
    evidence: evidence.map((item) => sensiveis.has(String(item.attachmentId)) ? {
      attachmentId: item.attachmentId, file: nomeSeguro(item.attachmentId, item.file),
      taint: item.taint, analysis: {
        status: 'preserved_locally', redacted: true,
        message: 'Conteúdo sensível preservado no IR local; nenhum trecho foi enviado ao provider.'
      }
    } : item),
    relations: relations.map((item) => {
      const sensivel = sensiveis.has(String(item.left?.attachmentId)) ||
        sensiveis.has(String(item.right?.attachmentId));
      return sensivel ? { ...item, samples: [], sensitiveValuesRedacted: true } : item;
    }),
    redacted: true
  };
}

function tabelaComparavel(anexo) {
  if (anexo.extraido?.tipo !== 'xlsx') return null;
  const tabela = detectarMelhorTabela(anexo.extraido.abas || []);
  if (!tabela) return null;
  const aba = (anexo.extraido.abas || []).find((item) => item.nome === tabela.aba);
  if (!aba) return null;
  const colunas = tabela.colunas.map(({ indice, rotulo }) => ({
    indice, nome: rotulo,
    normalizada: normalizar(rotulo)
  }));
  const linhas = tabela.linhas.map((linha) => ({ numero: linha.numero,
    valores: Object.fromEntries(colunas.map((coluna) => [coluna.normalizada,
      valorCelula(linha.valores?.[coluna.indice])])) }));
  return { anexo, aba, tabela, colunas, linhas };
}

function chaveComparacao(tabelas) {
  if (tabelas.length < 2) return null;
  const comuns = tabelas[0].colunas.map((item) => item.normalizada)
    .filter((nome) => tabelas.every((tabela) => tabela.colunas.some((item) => item.normalizada === nome)));
  const candidatos = comuns.filter((nome) => /^(?:id|sku|ean|gtin|codigo|codigo auxiliar|codigo de barras|chave)\b/.test(nome));
  for (const nome of candidatos) {
    const valido = tabelas.every((tabela) => {
      const valores = tabela.linhas.map((linha) => String(linha.valores[nome] ?? '').trim()).filter(Boolean);
      return valores.length === tabela.linhas.length && new Set(valores).size === valores.length;
    });
    if (valido) return nome;
  }
  return null;
}

function compararDuasPlanilhas(primeira, segunda) {
  const chave = chaveComparacao([primeira, segunda]);
  const colunasComuns = primeira.colunas.map((item) => item.normalizada)
    .filter((nome) => segunda.colunas.some((item) => item.normalizada === nome));
  const base = { kind: 'xlsx_comparison', left: { attachmentId: String(primeira.anexo.item.id),
    file: primeira.anexo.item.file_name, sheet: primeira.aba.nome, rows: primeira.linhas.length },
  right: { attachmentId: String(segunda.anexo.item.id), file: segunda.anexo.item.file_name,
    sheet: segunda.aba.nome, rows: segunda.linhas.length }, commonColumns: colunasComuns };
  if (!chave) return { ...base, status: 'needs_key', key: null,
    rowDelta: segunda.linhas.length - primeira.linhas.length };
  const esquerda = new Map(primeira.linhas.map((linha) => [String(linha.valores[chave]), linha]));
  const direita = new Map(segunda.linhas.map((linha) => [String(linha.valores[chave]), linha]));
  let changedRows = 0; let changedCells = 0; const samples = [];
  for (const [valorChave, linhaDireita] of direita) {
    const linhaEsquerda = esquerda.get(valorChave);
    if (!linhaEsquerda) continue;
    const changedColumns = colunasComuns.filter((nome) => nome !== chave &&
      JSON.stringify(linhaEsquerda.valores[nome] ?? null) !== JSON.stringify(linhaDireita.valores[nome] ?? null));
    if (changedColumns.length) {
      changedRows += 1; changedCells += changedColumns.length;
      if (samples.length < 20) samples.push({ key: valorChave, columns: changedColumns,
        leftRow: linhaEsquerda.numero, rightRow: linhaDireita.numero });
    }
  }
  return { ...base, status: 'compared', key: chave,
    added: [...direita.keys()].filter((chaveItem) => !esquerda.has(chaveItem)).length,
    removed: [...esquerda.keys()].filter((chaveItem) => !direita.has(chaveItem)).length,
    matched: [...direita.keys()].filter((chaveItem) => esquerda.has(chaveItem)).length,
    changedRows, changedCells, samples, method: 'local_exact_key_join' };
}

function compararPlanilhas(anexos) {
  const tabelas = anexos.map(tabelaComparavel).filter(Boolean);
  if (tabelas.length < 2) return [];
  return tabelas.slice(1).map((tabela) => compararDuasPlanilhas(tabelas[0], tabela));
}

function limitarEnvelope(envelope, maxBytes = DEFAULT_EVIDENCE_BYTES) {
  const limite = Math.max(4096, Number(maxBytes) || DEFAULT_EVIDENCE_BYTES);
  const copia = JSON.parse(JSON.stringify(envelope));
  let serializado = JSON.stringify(copia);
  while (Buffer.byteLength(serializado) > limite && copia.evidence?.length) {
    const ultimo = copia.evidence[copia.evidence.length - 1];
    if (ultimo?.analysis?.trechos?.length > 1) ultimo.analysis.trechos.pop();
    else if (ultimo?.analysis?.amostra?.length > 2) ultimo.analysis.amostra.pop();
    else copia.evidence.pop();
    serializado = JSON.stringify(copia);
  }
  if (Buffer.byteLength(serializado) > limite) {
    copia.evidence = [];
    copia.truncated = true;
    serializado = JSON.stringify(copia);
  }
  if (Buffer.byteLength(serializado) > limite) throw new Error('O manifesto mínimo do anexo excede o orçamento seguro.');
  return { envelope: copia, bytes: Buffer.byteLength(serializado), serialized: serializado };
}

function assinaturaAnalise({ principalId, anexos, pergunta, intent, profundidade, analisarVisual }) {
  return hashJson({ principalId, attachments: anexos.map((anexo) => anexo.item.sha256 || anexo.item.id).sort(),
    question: normalizar(pergunta), intent, depth: profundidade, visual: Boolean(analisarVisual),
    analyzerVersion: ANALYZER_VERSION });
}

async function prepararContextoAnexos({ pergunta, userMessageId = null, anexos = [], profundidade = 'medio',
  analisarVisual = false, sourceMode = 'automatico', principalId = null, maxEvidenceBytes } = {}) {
  if (!pergunta || !anexos.length) return null;
  const intent = classificarIntencaoUsuario(pergunta, sourceMode);
  const manifests = anexos.map((anexo) => ({ attachmentId: String(anexo.item.id), file: anexo.item.file_name,
    hash: anexo.item.sha256, ...construirManifesto(anexo.extraido), security: detectarRiscosConteudo(anexo.extraido, {
      fileName: anexo.item.file_name, safeMetadata: anexo.item.safe_metadata
    }) }));
  const exactFacts = anexos.flatMap(fatosExatos);
  const formulas = intent.formula ? anexos.flatMap((anexo) => formulasRelevantes(anexo)) : [];
  const relations = intent.compare ? compararPlanilhas(anexos) : [];
  const evidence = [];
  for (const anexo of anexos) {
    let analysis;
    if (anexo.extraido?.tipo === 'image') {
      analysis = { textoOcr: cortarTexto(anexo.extraido.texto, 5000), codigos: anexo.extraido.codigos || [],
        referencias: [{ tipo: 'image', imagem: 1 }] };
    } else {
      analysis = selecionarConteudo(anexo.extraido, pergunta,
        profundidade === 'extra_alto' ? 'alto' : profundidade);
      if (['xls', 'xlsx'].includes(anexo.item.format)) analysis = await complementarAnaliseDuckDb(anexo.extraido, analysis);
    }
    evidence.push({ attachmentId: String(anexo.item.id), file: anexo.item.file_name,
      taint: 'untrusted_attachment_evidence', analysis: sanitizarEvidencia(analysis) });
  }
  const pacoteSeguro = redigirEnvelopeSensivel({ manifests, exactFacts, formulas, evidence, relations });
  const security = {
    taint: 'untrusted_attachment_evidence',
    highestClassification: classificacaoMaisRestrita(manifests.flatMap((item, indice) => [
      item.security.classification, anexos[indice]?.item?.classification
    ])),
    promptInjectionSuspected: manifests.some((item) => item.security.promptInjectionSuspected),
    contentMayNotAuthorizeTools: true,
    intentSource: 'authenticated_user_message',
    externalEvidenceRedacted: pacoteSeguro.redacted,
    fullEvidencePreservedLocally: true
  };
  const signature = assinaturaAnalise({ principalId, anexos, pergunta, intent, profundidade, analisarVisual });
  const limitado = limitarEnvelope({ schema: 'attachment_evidence_v3', analyzerVersion: ANALYZER_VERSION,
    userMessageId, signature, intent, manifests: pacoteSeguro.manifests,
    exactFacts: pacoteSeguro.exactFacts, formulas: pacoteSeguro.formulas,
    evidence: pacoteSeguro.evidence, relations: pacoteSeguro.relations, security },
  maxEvidenceBytes || process.env.NEXUS_ATTACHMENT_EVIDENCE_MAX_BYTES);
  validarAttachmentEvidence(limitado.envelope);
  return { ...limitado.envelope, signature, bytes: limitado.bytes, serialized: limitado.serialized };
}

module.exports = { ANALYZER_VERSION, DEFAULT_EVIDENCE_BYTES, IR_VERSION, assinaturaAnalise,
  classificarIntencaoUsuario, compararPlanilhas, construirEntradasIndice, construirManifesto,
  criarAttachmentIr, detectarRiscosConteudo, limitarEnvelope, prepararContextoAnexos,
  referenciasFormula, resolverModoInteligenciaAnexos, textoCompleto };
