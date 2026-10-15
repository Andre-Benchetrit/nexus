const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createKnowledgeImportController,
  validateKnowledgeFile
} = require('../hub/lib/knowledge-import.cjs');

function fixture() {
  const states = [];
  const controller = createKnowledgeImportController((state) => states.push(state), 1024);
  let inputValue = 'C:\\fakepath\\procedimento.pdf';
  let files = [{ name: 'procedimento.pdf', size: 64 }];
  const input = {
    get value() { return inputValue; },
    set value(value) { inputValue = value; if (!value) files = []; },
    get files() { return files; },
    set files(value) { files = value; }
  };
  let resetCount = 0;
  const form = { reset() { resetCount += 1; input.value = ''; input.files = []; } };
  return { controller, form, input, states, get resetCount() { return resetCount; } };
}

test('selecionar arquivo só atualiza o nome e não inicia upload', () => {
  const f = fixture();
  let uploads = 0;
  assert.equal(f.controller.select(f.input.files[0], f.input), true);
  assert.equal(uploads, 0);
  assert.equal(f.input.files[0].name, 'procedimento.pdf');
  assert.equal(f.states.at(-1).fileName, 'procedimento.pdf');
  assert.equal(f.states.at(-1).error, null);
});

test('cancelar o seletor limpa arquivo e nome sem enviar', () => {
  const f = fixture();
  f.controller.select(f.input.files[0], f.input);
  f.controller.cancel(f.input);
  assert.equal(f.input.value, '');
  assert.equal(f.states.at(-1).fileName, '');
  assert.equal(f.states.at(-1).error, null);
  assert.equal(f.resetCount, 0);
});

test('extensão inválida e arquivo acima do limite são recusados', () => {
  assert.match(validateKnowledgeFile({ name: 'arquivo.exe', size: 10 }, 1024), /Formato inválido/);
  assert.match(validateKnowledgeFile({ name: 'arquivo.DOCX', size: 1025 }, 1024), /excede o limite/);
  const f = fixture();
  assert.equal(f.controller.select({ name: 'planilha.xlsx', size: 10 }, f.input), false);
  assert.equal(f.input.value, '');
  assert.match(f.states.at(-1).error, /Formato inválido/);
});

test('nome longo com acentos é mantido como texto de apresentação', () => {
  const f = fixture();
  const name = `${'Revisão operacional '.repeat(15)}— versão final.DOTX`;
  assert.equal(f.controller.select({ name, size: 64 }, f.input), true);
  assert.equal(f.states.at(-1).fileName, name);
});

test('falha de upload preserva arquivo, mostra erro e permite tentar novamente', async () => {
  const f = fixture();
  f.controller.select(f.input.files[0], f.input);
  const success = await f.controller.submit(f.input, f.form,
    async () => { throw new Error('API temporariamente indisponível'); });
  assert.equal(success, false);
  assert.equal(f.states.at(-1).fileName, 'procedimento.pdf');
  assert.equal(f.states.at(-1).error, 'API temporariamente indisponível');
  assert.equal(f.input.value, 'C:\\fakepath\\procedimento.pdf');
  assert.equal(f.resetCount, 0);

  const source = fs.readFileSync(path.join(__dirname, '..', 'hub', 'components', 'admin-dashboard.tsx'), 'utf8');
  assert.match(source, /class KnowledgeImportBoundary extends Component/);
  assert.match(source, /className="error-banner knowledge-import-error" role="alert"/);
});

test('duplo envio concorrente faz uma única chamada de upload', async () => {
  const f = fixture();
  f.controller.select(f.input.files[0], f.input);
  let uploads = 0;
  let releaseUpload;
  const waitForUpload = new Promise((resolve) => { releaseUpload = resolve; });
  const upload = async () => { uploads += 1; await waitForUpload; };
  const first = f.controller.submit(f.input, f.form, upload);
  const second = f.controller.submit(f.input, f.form, upload);
  assert.equal(uploads, 1);
  releaseUpload();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(uploads, 1);
});

test('sucesso limpa o seletor e fecha o formulário uma vez', async () => {
  const f = fixture();
  f.controller.select(f.input.files[0], f.input);
  let uploads = 0;
  let closes = 0;
  const result = await f.controller.submit(f.input, f.form, async () => { uploads += 1; }, () => { closes += 1; });
  assert.equal(result, true);
  assert.equal(uploads, 1);
  assert.equal(closes, 1);
  assert.equal(f.resetCount, 1);
  assert.equal(f.input.value, '');
  assert.deepEqual(f.input.files, []);
  assert.deepEqual(f.states.at(-1), { fileName: '', error: null, pending: false });
});
