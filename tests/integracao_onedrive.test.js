const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { strToU8, zipSync } = require('fflate');

const {
  limparCacheTokens,
  obterTokenAplicacao
} = require('../integracoes/microsoft/autenticacao');
const {
  resolverConexao,
  resumirConexao
} = require('../integracoes/microsoft/conexoes');
const { criarClienteGraph } = require('../integracoes/microsoft/graph');
const { criarCaminhosExportacao } = require('../exportadores/core/caminhos');
const { lerPlanilha } = require('../exportadores/onedrive/excel');
const { exportarOneDrive } = require('../exportadores/onedrive/exportar');

async function criarXlsx() {
  const arquivos = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Agendamentos" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="inlineStr"><is><t>SKU</t></is></c>
            <c r="B1" t="inlineStr"><is><t>Quantidade</t></is></c>
            <c r="C1" t="inlineStr"><is><t>Previsão</t></is></c>
          </row>
          <row r="2">
            <c r="A2" t="inlineStr"><is><t>ABC-1</t></is></c>
            <c r="B2"><v>10</v></c>
            <c r="C2" t="inlineStr"><is><t>2026-08-01T00:00:00.000Z</t></is></c>
          </row>
          <row r="3">
            <c r="A3" t="inlineStr"><is><t>ABC-2</t></is></c>
            <c r="B3"><v>5</v></c>
            <c r="C3" t="inlineStr"><is><t>2026-08-03T00:00:00.000Z</t></is></c>
          </row>
        </sheetData>
      </worksheet>`
  };
  return Buffer.from(zipSync(
    Object.fromEntries(Object.entries(arquivos).map(([nome, conteudo]) => [
      nome,
      strToU8(conteudo)
    ]))
  ));
}

test('resolve as duas conexoes sem revelar o segredo no resumo', () => {
  const env = {
    MICROSOFT_TENANT_ID: 'tenant',
    MICROSOFT_CLIENT_ID: 'client',
    MICROSOFT_CLIENT_SECRET: 'segredo',
    AUTOMACOES_ONEDRIVE_USUARIO: 'automacoes@empresa.test'
  };
  const conexao = resolverConexao('automacoes_onedrive', {
    env,
    exigirCredenciais: true
  });
  const resumo = resumirConexao(conexao);

  assert.equal(conexao.nome, 'AUTOMAÇÕES - ONEDRIVE');
  assert.equal(resumo.credenciais.clientSecret, true);
  assert.equal(JSON.stringify(resumo).includes('segredo'), false);
  assert.equal(resumo.pronta, true);
});

test('autenticacao app-only reutiliza token valido em memoria', async () => {
  limparCacheTokens();
  let chamadas = 0;
  const fetchImpl = async (url, opcoes) => {
    chamadas += 1;
    assert.match(url, /tenant\/oauth2\/v2\.0\/token$/);
    assert.match(String(opcoes.body), /grant_type=client_credentials/);
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'token-teste', expires_in: 3600 })
    };
  };
  const credenciais = {
    tenantId: 'tenant',
    clientId: 'client',
    clientSecret: 'secret'
  };

  assert.equal(
    await obterTokenAplicacao(credenciais, { fetchImpl, agoraMs: 1_000 }),
    'token-teste'
  );
  assert.equal(
    await obterTokenAplicacao(credenciais, { fetchImpl, agoraMs: 2_000 }),
    'token-teste'
  );
  assert.equal(chamadas, 1);
});

test('cliente Graph pagina itens e rejeita paginacao para outro dominio', async () => {
  const urls = [];
  const paginas = [
    {
      value: [{ id: '1', name: 'A' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/proxima'
    },
    { value: [{ id: '2', name: 'B' }] }
  ];
  const fetchImpl = async (url, opcoes) => {
    urls.push(url);
    assert.equal(opcoes.headers.authorization, 'Bearer token');
    return new Response(JSON.stringify(paginas.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const cliente = criarClienteGraph({
    nome: 'Teste',
    driveId: 'drive-1',
    credenciais: {}
  }, {
    fetchImpl,
    obterToken: async () => 'token'
  });

  const itens = await cliente.listarFilhos();
  assert.deepEqual(itens.map((item) => item.id), ['1', '2']);
  assert.equal(urls[0], 'https://graph.microsoft.com/v1.0/drives/drive-1/root/children');
  await assert.rejects(
    cliente.requisitar('https://exemplo.test/v1.0/roubo'),
    /URL de paginacao inesperada/
  );
});

test('cliente Graph bloqueia qualquer operacao de escrita', async () => {
  let chamadas = 0;
  const cliente = criarClienteGraph({
    nome: 'Teste',
    driveId: 'drive-1',
    credenciais: {}
  }, {
    obterToken: async () => 'token',
    fetchImpl: async () => {
      chamadas += 1;
      return new Response(null, { status: 204 });
    }
  });

  await assert.rejects(
    cliente.requisitar('/drives/drive-1/items/item-1', { method: 'POST' }),
    /somente leitura/
  );
  assert.equal(chamadas, 0);
});

test('le Excel, normaliza cabecalhos e valida colunas obrigatorias', async () => {
  const buffer = await criarXlsx();
  const resultado = await lerPlanilha(buffer, {
    planilha: 'Agendamentos',
    colunas: [
      { origem: ['Código', 'SKU'], destino: 'sku' },
      { origem: 'Quantidade', destino: 'quantidade' }
    ]
  });

  assert.equal(resultado.nomePlanilha, 'Agendamentos');
  assert.deepEqual(
    resultado.colunas.map((coluna) => coluna.destino),
    ['sku', 'quantidade', 'previsao']
  );
  assert.equal(resultado.linhas[0].sku, 'ABC-1');
  assert.equal(resultado.linhas[0].previsao, '2026-08-01T00:00:00.000Z');

  await assert.rejects(
    lerPlanilha(buffer, {
      colunas: [{ origem: 'Fornecedor', destino: 'fornecedor' }]
    }),
    /Coluna obrigatoria ausente/
  );
});

test('exporta XLSX para Bronze e reutiliza eTag inalterada', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-onedrive-'));
  t.after(async () => fs.rm(raiz, { recursive: true, force: true }));
  const buffer = await criarXlsx();
  let downloads = 0;
  const graph = {
    obterItem: async () => ({
      id: 'item-1',
      name: 'Agendamento.xlsx',
      size: buffer.length,
      eTag: '"versao-1"',
      cTag: '"conteudo-1"',
      lastModifiedDateTime: '2026-07-27T12:00:00Z'
    }),
    baixarItem: async () => {
      downloads += 1;
      return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
  };
  const entidade = {
    nome: 'agendamento_teste',
    fonte: 'onedrive',
    destino: { camada: 'bronze' },
    extracao: {
      modo: 'arquivo_versionado',
      conexao: 'automacoes_onedrive',
      itemIdEnv: 'ARQUIVO_TESTE_ID',
      planilha: 'Agendamentos',
      tamanhoMaximoMb: 5,
      colunas: []
    }
  };
  const env = {
    MICROSOFT_TENANT_ID: 'tenant',
    MICROSOFT_CLIENT_ID: 'client',
    MICROSOFT_CLIENT_SECRET: 'secret',
    AUTOMACOES_ONEDRIVE_DRIVE_ID: 'drive-1',
    ARQUIVO_TESTE_ID: 'item-1'
  };
  const criarCaminhos = (contrato, data) => {
    const caminhos = criarCaminhosExportacao(contrato, data);
    const relativo = path.relative(path.resolve(__dirname, '..', 'lake'), caminhos.diretorio);
    const diretorio = path.join(raiz, relativo);
    return {
      ...caminhos,
      raizEntidade: path.join(raiz, 'bronze', contrato.fonte, contrato.nome),
      diretorio,
      parquet: path.join(diretorio, 'dados.parquet'),
      manifesto: path.join(diretorio, 'manifest.json')
    };
  };
  const dependencias = {
    env,
    criarCaminhos,
    criarClienteGraph: () => graph
  };
  const agora = new Date('2026-07-27T12:30:00.000Z');

  const primeira = await exportarOneDrive(entidade, { agora }, dependencias);
  const segunda = await exportarOneDrive(entidade, { agora }, dependencias);

  assert.equal(primeira.totalLinhas, 2);
  assert.equal(primeira.alterado, true);
  assert.equal(segunda.alterado, false);
  assert.equal(segunda.reutilizado, true);
  assert.equal(downloads, 1);
  assert.equal(
    JSON.parse(await fs.readFile(primeira.caminhos.manifesto, 'utf8')).origem.eTag,
    '"versao-1"'
  );
  await fs.access(primeira.caminhos.parquet);
  await fs.access(path.join(primeira.caminhos.diretorio, 'origem.xlsx'));
});
