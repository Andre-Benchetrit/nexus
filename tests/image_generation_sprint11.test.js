const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { criarArtifactStorage } = require('../nexus/artifact_storage');
const { comporProjetoImagem, normalizarSpecImagem } = require('../nexus/image_project');
const { criarProviderImagemOpenAI, resolverTimeoutImagem } = require('../agentes/providers/openai_image');
const { executarGerarImagem } = require('../tools/gerar_imagem');
const { possuiMudancaLocalEfetiva } = require('../nexus/imagens');

function spec(overrides = {}) {
  return {
    action: 'generate', title: 'Campanha', prompt: 'Uma composição abstrata verde',
    format: 'png', preset: 'square', quality: 'medium', brandMode: 'none', regenerateBase: true,
    replaceTextLayers: false, sourceArtifactId: '',
    logo: { enabled: false, anchor: 'bottom-right', widthPercent: 12,
      marginPercent: 4, contrastTreatment: 'none' }, textBlocks: [], shapeBlocks: [], ...overrides
  };
}

test('imagem sem logo e sem identidade corporativa é um projeto válido', async () => {
  const entrada = normalizarSpecImagem(spec());
  assert.equal(entrada.brandMode, 'none');
  assert.equal(entrada.logo.enabled, false);
  const base = await sharp({ create: { width: 1200, height: 900, channels: 4,
    background: '#246b48' } }).png().toBuffer();
  const resultado = await comporProjetoImagem({ baseBuffer: base, spec: entrada });
  assert.equal(resultado.projeto.brandMode, 'none');
  assert.equal(resultado.projeto.layers.length, 0);
  assert.equal(resultado.validacao.brandCompliant, true);
  assert.deepEqual(await sharp(resultado.buffer).metadata().then((m) => [m.width, m.height]), [1024, 1024]);
});

test('renderiza JPEG e WebP e preserva formas como camadas editáveis', async () => {
  const base = await sharp({ create: { width: 1024, height: 1024, channels: 4,
    background: '#101010' } }).png().toBuffer();
  for (const format of ['jpeg', 'webp']) {
    const resultado = await comporProjetoImagem({ baseBuffer: base, spec: spec({ format,
      shapeBlocks: [{ id: 'accent', shape: 'ellipse', anchor: 'top-right', widthPercent: 20,
        heightPercent: 12, color: '#19e68c', opacity: .7, rotation: 15 }] }) });
    assert.equal((await sharp(resultado.buffer).metadata()).format, format);
    assert.equal(resultado.projeto.layers[0].type, 'shape');
  }
});

test('logo oficial é composta como camada local e não integra o prompt da imagem-base', async () => {
  const logo = await sharp({ create: { width: 320, height: 120, channels: 4,
    background: '#19e68c' } }).png().toBuffer();
  const base = await sharp({ create: { width: 1024, height: 1024, channels: 4,
    background: '#101010' } }).png().toBuffer();
  const brandProvider = { obter: () => ({ versao: 'manual-1', logoMinWidthPercent: 8,
    clearSpacePercent: 4 }), carregarLogo: async () => logo };
  const resultado = await comporProjetoImagem({ baseBuffer: base,
    spec: spec({ brandMode: 'full_brand', logo: { enabled: true, anchor: 'top-left',
      widthPercent: 12, marginPercent: 4, contrastTreatment: 'none' } }), brandProvider });
  assert.equal(resultado.projeto.layers[0].type, 'logo');
  assert.equal(resultado.projeto.layers[0].assetId, 'brand:manual-1');
  assert.equal(resultado.validacao.brandCompliant, true);
});

test('provider OpenAI usa Responses com image_generation e recupera o binário', async () => {
  const imagem = await sharp({ create: { width: 32, height: 32, channels: 4,
    background: '#ffffff' } }).png().toBuffer();
  let payload;
  const provider = criarProviderImagemOpenAI({ cliente: { responses: { create: async (body) => {
    payload = body; return { id: 'resp-1', usage: { input_tokens: 10, output_tokens: 20 },
      output: [{ type: 'image_generation_call', result: imagem.toString('base64'), revised_prompt: 'seguro' }] };
  } } }, mainlineModel: 'gpt-test', generationModel: 'gpt-image-test' });
  const resultado = await provider.executar({ prompt: 'Imagem', size: '1024x1024', quality: 'medium' });
  assert.equal(payload.model, 'gpt-test');
  assert.equal(payload.tools[0].type, 'image_generation');
  assert.equal(payload.tools[0].model, 'gpt-image-test');
  assert.equal(payload.store, false);
  assert.deepEqual(resultado.buffer, imagem);
});

test('provider de imagens possui timeout próprio e não fica limitado ao timeout textual', () => {
  assert.equal(resolverTimeoutImagem({ timeoutMs: 120_000 }), 120_000);
  assert.equal(resolverTimeoutImagem({ timeoutMs: 'invalido' }), 120_000);
  const provider = criarProviderImagemOpenAI({ timeoutMs: 180_000, cliente: {
    responses: { create: async () => ({ output: [] }) }
  } });
  assert.equal(provider.timeoutMs, 180_000);
});

test('controles do Hub prevalecem sobre a proposta de composição do modelo', async () => {
  let recebido;
  const retorno = await executarGerarImagem(spec({ brandMode: 'full_brand', logo: {
    enabled: true, anchor: 'bottom-right', widthPercent: 12, marginPercent: 4,
    contrastTreatment: 'none' } }), {
    conversationId: 'conversation', turnoIA: { id: 'turn' },
    imageContext: { artifactId: 'artifact', compositionPatch: {
      logoAnchor: 'top-left', logoWidthPercent: 18, logoMarginPercent: 6
    } },
    servicoImagens: { gerar: async (_conversation, _turn, entrada) => {
      recebido = entrada; return { id: 'new-artifact' };
    } }, imageOutputFormat: 'webp'
  });
  assert.equal(retorno.id, 'new-artifact');
  assert.equal(recebido.logo.anchor, 'top-left');
  assert.equal(recebido.logo.widthPercent, 18);
  assert.equal(recebido.logo.marginPercent, 6);
  assert.equal(recebido.format, 'webp');
});

test('storage privado aceita imagens e valida a chave física', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-image-artifacts-'));
  try {
    const storage = criarArtifactStorage({ root });
    const salvo = await storage.salvar({ buffer: Buffer.from('png-test'), extensao: 'png' });
    assert.match(salvo.chave, /^[a-f0-9-]{36}\.png$/);
    assert.deepEqual(await storage.abrir(salvo.chave), Buffer.from('png-test'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('contratos públicos incluem modo imagem, permissões e migrations aditivas', async () => {
  const [api, shell, styles, migration, provenanceMigration] = await Promise.all([
    fs.readFile(path.join(__dirname, '..', 'services', 'nexus-api', 'server.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'hub', 'components', 'hub-shell.tsx'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'hub', 'app', 'globals.css'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'nexus', 'migrations', '021_image_generation.sql'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'nexus', 'migrations', '022_image_provenance.sql'), 'utf8')
  ]);
  assert.match(api, /'imagem'/);
  assert.match(api, /disposition === 'inline'/);
  assert.match(shell, /Criar imagem/);
  assert.match(shell, /Editar esta imagem/);
  assert.match(shell, /Carregando imagem/);
  assert.match(styles, /generated-image-loading/);
  assert.match(migration, /ia\.imagem\.gerar/);
  assert.match(migration, /conversation_image_projects/);
  assert.match(provenanceMigration, /ai_turns_proveniencia_check/);
  assert.match(provenanceMigration, /conversation_messages_proveniencia_check/);
  assert.match(provenanceMigration, /'imagem'/);
});

test('modo shadow mantém a tool de imagem disponível sem gerar artefato', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'agentes', 'assistente_nexus.js'), 'utf8');
  assert.match(source, /\['shadow', 'v1'\]\.includes\(modoGeracaoImagem\)/);
});

test('edicao sem mudanca de camada e tratada como alteracao da imagem-base', () => {
  const parent = { format: 'png', brand_mode: 'none', project: {
    brandMode: 'none', preset: 'square', composition: {
      logo: { enabled: false, anchor: 'top-right', widthPercent: 10,
        marginPercent: 4, contrastTreatment: 'none' },
      textBlocks: [], shapeBlocks: []
    }
  } };
  const entrada = normalizarSpecImagem(spec({
    action: 'edit', regenerateBase: false,
    prompt: 'Adicione um coelho lionhead e um pote ao lado do cachorro',
    logo: { enabled: false, anchor: 'top-right', widthPercent: 10,
      marginPercent: 4, contrastTreatment: 'none' }
  }));
  assert.equal(possuiMudancaLocalEfetiva(entrada, parent), false);
});

test('preset incidental não transforma edição da cena em composição local', () => {
  const parent = { format: 'png', brand_mode: 'none', project: {
    brandMode: 'none', preset: 'landscape', composition: {
      logo: { enabled: false, anchor: 'top-right', widthPercent: 10,
        marginPercent: 4, contrastTreatment: 'none' }, textBlocks: [], shapeBlocks: []
    }
  } };
  const entrada = normalizarSpecImagem(spec({ action: 'edit', preset: 'square',
    regenerateBase: false,
    prompt: 'Mude a coloração do coelho para cinza e adicione um gato frajolinha',
    logo: { enabled: false, anchor: 'top-right', widthPercent: 10,
      marginPercent: 4, contrastTreatment: 'none' } }));
  assert.equal(possuiMudancaLocalEfetiva(entrada, parent), false);
});

test('mudança explicitamente solicitada para canvas continua local', () => {
  const parent = { format: 'png', brand_mode: 'none', project: {
    brandMode: 'none', preset: 'landscape', composition: {
      logo: { enabled: false, anchor: 'top-right', widthPercent: 10,
        marginPercent: 4, contrastTreatment: 'none' }, textBlocks: [], shapeBlocks: []
    }
  } };
  const entrada = normalizarSpecImagem(spec({ action: 'edit', preset: 'square',
    regenerateBase: false, prompt: 'Deixe a imagem quadrada',
    logo: { enabled: false, anchor: 'top-right', widthPercent: 10,
      marginPercent: 4, contrastTreatment: 'none' } }));
  assert.equal(possuiMudancaLocalEfetiva(entrada, parent), true);
});

test('movimento de logo continua sendo uma composicao local', () => {
  const parent = { format: 'png', brand_mode: 'full_brand', project: {
    brandMode: 'full_brand', preset: 'square', composition: {
      logo: { enabled: true, anchor: 'top-right', widthPercent: 10,
        marginPercent: 4, contrastTreatment: 'none' },
      textBlocks: [], shapeBlocks: []
    }
  } };
  const entrada = normalizarSpecImagem(spec({
    action: 'edit', brandMode: 'full_brand', regenerateBase: false,
    logo: { enabled: true, anchor: 'bottom-left', widthPercent: 10,
      marginPercent: 4, contrastTreatment: 'none' }
  }));
  assert.equal(possuiMudancaLocalEfetiva(entrada, parent), true);
});
