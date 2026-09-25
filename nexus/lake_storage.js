const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const {
  S3Client,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const RAIZ_LAKE_LOCAL = path.resolve(__dirname, '..', 'lake');
const CAMADAS = new Set(['bronze', 'silver', 'gold']);
const TAMANHO_MAXIMO_MANIFESTO = 1024 * 1024;

function resolverRaizLake(opcoes = {}) {
  return path.resolve(
    opcoes.raizLake || opcoes.env?.NEXUS_LAKE_ROOT || process.env.NEXUS_LAKE_ROOT ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH || RAIZ_LAKE_LOCAL
  );
}

function resolverRaizTemporaria(opcoes = {}) {
  return path.resolve(
    opcoes.raizTemporaria || opcoes.env?.NEXUS_LAKE_TEMP_ROOT ||
    process.env.NEXUS_LAKE_TEMP_ROOT || path.join(os.tmpdir(), 'nexus-lake')
  );
}

function caminhoSeguro(raiz, ...partes) {
  const destino = path.resolve(raiz, ...partes);
  const relativo = path.relative(path.resolve(raiz), destino);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error('Caminho fora da raiz autorizada do lake.');
  }
  return destino;
}

function validarCamada(camada) {
  if (!CAMADAS.has(camada)) throw new Error(`Camada do lake invalida: ${camada}.`);
}

function segmentoSeguro(valor, rotulo = 'segmento') {
  const texto = String(valor || '').trim();
  if (!texto || !/^[a-zA-Z0-9_.=-]+$/.test(texto) || texto === '.' || texto === '..') {
    throw new Error(`${rotulo} invalido para o lake.`);
  }
  return texto;
}

function normalizarPrefixo(valor = '') {
  const texto = String(valor || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!texto) return '';
  const partes = texto.split('/');
  for (const parte of partes) segmentoSeguro(parte, 'Prefixo');
  return partes.join('/');
}

function juntarChave(...partes) {
  return partes.filter((item) => item !== null && item !== undefined && item !== '')
    .flatMap((item) => String(item).replace(/\\/g, '/').split('/'))
    .filter(Boolean).map((item) => segmentoSeguro(item, 'Chave')).join('/');
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function mapearComConcorrencia(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let indice = 0;
  const quantidade = Math.min(Math.max(1, limite), itens.length);
  await Promise.all(Array.from({ length: quantidade }, async () => {
    while (indice < itens.length) {
      const atual = indice++;
      resultados[atual] = await tarefa(itens[atual], atual);
    }
  }));
  return resultados;
}

async function sha256Arquivo(caminho) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(caminho);
    stream.on('data', (parte) => hash.update(parte));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function corpoParaBuffer(corpo, limite = Infinity) {
  if (!corpo) return Buffer.alloc(0);
  if (typeof corpo.transformToByteArray === 'function') {
    const buffer = Buffer.from(await corpo.transformToByteArray());
    if (buffer.length > limite) throw new Error('Objeto do lake excede o limite permitido.');
    return buffer;
  }
  if (Buffer.isBuffer(corpo)) return corpo;
  const partes = [];
  let total = 0;
  for await (const parte of Readable.from(corpo)) {
    const buffer = Buffer.from(parte);
    total += buffer.length;
    if (total > limite) throw new Error('Objeto do lake excede o limite permitido.');
    partes.push(buffer);
  }
  return Buffer.concat(partes);
}

async function listarArquivos(diretorio, nomeArquivo) {
  let entradas;
  try { entradas = await fs.readdir(diretorio, { withFileTypes: true }); }
  catch (erro) { if (erro.code === 'ENOENT') return []; throw erro; }
  const arquivos = [];
  for (const entrada of entradas) {
    const atual = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...await listarArquivos(atual, nomeArquivo));
    else if (entrada.isFile() && entrada.name === nomeArquivo) arquivos.push(atual);
  }
  return arquivos;
}

function ordenarVersoes(versoes) {
  return versoes.sort((a, b) => {
    const dataA = a.manifesto.fim || a.manifesto.inicio || '';
    const dataB = b.manifesto.fim || b.manifesto.inicio || '';
    return dataA.localeCompare(dataB) || a.arquivo.localeCompare(b.arquivo);
  });
}

function criarFileSystemLakeStorage(opcoes = {}) {
  const raizLake = resolverRaizLake(opcoes);
  async function lerManifesto(_camada, _objeto, referencia) {
    const bruto = typeof referencia === 'string' ? referencia : referencia?.caminhoManifesto;
    if (!bruto) throw new Error('Informe a referencia do manifesto.');
    const caminho = caminhoSeguro(raizLake, path.relative(raizLake, path.resolve(bruto)));
    return JSON.parse(await fs.readFile(caminho, 'utf8'));
  }
  async function listarVersoes(camada, objeto) {
    validarCamada(camada);
    const manifestos = await listarArquivos(caminhoSeguro(raizLake, camada), 'manifest.json');
    const versoes = [];
    for (const caminhoManifesto of manifestos) {
      const manifesto = await lerManifesto(camada, objeto, caminhoManifesto);
      if (manifesto.status !== 'sucesso' || (manifesto.objeto || manifesto.entidade) !== objeto) continue;
      const nomeArquivo = manifesto.arquivo || 'dados.parquet';
      if (path.basename(nomeArquivo) !== nomeArquivo) throw new Error(`Manifesto aponta para arquivo invalido: ${caminhoManifesto}`);
      const arquivo = path.join(path.dirname(caminhoManifesto), nomeArquivo);
      try { await fs.access(arquivo); } catch (erro) { if (erro.code === 'ENOENT') continue; throw erro; }
      let arquivoChavesAtuais = null;
      if (manifesto.reconciliacaoExclusoes) {
        const nomeChaves = manifesto.reconciliacaoExclusoes.arquivo;
        if (!nomeChaves || path.basename(nomeChaves) !== nomeChaves) throw new Error(`Manifesto aponta para snapshot de chaves invalido: ${caminhoManifesto}`);
        arquivoChavesAtuais = path.join(path.dirname(caminhoManifesto), nomeChaves);
        try { await fs.access(arquivoChavesAtuais); } catch (erro) { if (erro.code === 'ENOENT') continue; throw erro; }
      }
      versoes.push({ manifesto, caminhoManifesto, arquivo, arquivoChavesAtuais });
    }
    return ordenarVersoes(versoes);
  }
  async function listarReferencias(camada) {
    validarCamada(camada);
    return listarArquivos(caminhoSeguro(raizLake, camada), 'manifest.json');
  }
  async function localizarDataset(camada, objeto, versao = 'latest') {
    const versoes = await listarVersoes(camada, objeto);
    if (!versoes.length) return null;
    if (versao === 'latest') return versoes.at(-1);
    return versoes.find((item) => item.manifesto.idExecucao === versao || item.manifesto.execucao === versao) || null;
  }
  async function publicarSnapshot(snapshot) {
    const { camada, objeto, manifesto, arquivoOrigem, arquivosExtras = [] } = snapshot || {};
    if (!camada || !objeto || !manifesto || !arquivoOrigem) throw new Error('Snapshot exige camada, objeto, manifesto e arquivoOrigem.');
    validarCamada(camada);
    const execucao = segmentoSeguro(String(manifesto.idExecucao || manifesto.execucao || Date.now()).replace(/[^a-zA-Z0-9_.=-]/g, ''), 'Identificador de execucao');
    const relativo = snapshot.prefixoRelativo ? normalizarPrefixo(snapshot.prefixoRelativo) : juntarChave(camada, objeto, `execucao=${execucao}`);
    const destinoFinal = caminhoSeguro(raizLake, ...relativo.split('/'));
    const destinoTemporario = `${destinoFinal}.tmp-${randomUUID()}`;
    await fs.mkdir(destinoTemporario, { recursive: true });
    try {
      const nomeArquivo = manifesto.arquivo || 'dados.parquet';
      await fs.copyFile(arquivoOrigem, path.join(destinoTemporario, nomeArquivo));
      for (const extra of arquivosExtras) {
        if (!extra?.origem || !extra?.nome || path.basename(extra.nome) !== extra.nome) throw new Error('Arquivo extra do snapshot invalido.');
        await fs.copyFile(extra.origem, path.join(destinoTemporario, extra.nome));
      }
      const manifestoFinal = { ...manifesto, status: 'sucesso' };
      await fs.writeFile(path.join(destinoTemporario, 'manifest.json'), `${JSON.stringify(manifestoFinal, null, 2)}\n`, 'utf8');
      await fs.mkdir(path.dirname(destinoFinal), { recursive: true });
      await fs.rename(destinoTemporario, destinoFinal);
      return { caminho: destinoFinal, manifesto: manifestoFinal };
    } catch (erro) { await fs.rm(destinoTemporario, { recursive: true, force: true }); throw erro; }
  }
  async function verificarSaude() {
    try {
      await fs.mkdir(raizLake, { recursive: true }); await fs.access(raizLake);
      const camadas = {};
      for (const camada of CAMADAS) camadas[camada] = (await listarArquivos(caminhoSeguro(raizLake, camada), 'manifest.json')).length;
      return { saudavel: true, tipo: 'filesystem', raizLake, camadas };
    } catch (erro) { return { saudavel: false, tipo: 'filesystem', raizLake, codigo: erro.code || erro.name }; }
  }
  return Object.freeze({ tipo: 'filesystem', raizLake, raizTemporaria: raizLake,
    localizarDataset, lerManifesto, listarReferencias, listarVersoes, publicarSnapshot,
    prepararConexaoDuckDB: async () => {}, verificarSaude, fechar: async () => {} });
}

function inteiroSeguro(valor, padrao, nome, minimo, maximo) {
  const numero = Number(valor ?? padrao);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) throw new Error(`${nome} deve ser inteiro entre ${minimo} e ${maximo}.`);
  return numero;
}

function configuracaoS3(opcoes = {}) {
  const env = opcoes.env || process.env;
  const config = {
    bucket: String(opcoes.bucket || env.NEXUS_LAKE_S3_BUCKET || '').trim(),
    endpoint: String(opcoes.endpoint || env.NEXUS_LAKE_S3_ENDPOINT || '').trim(),
    region: String(opcoes.region || env.NEXUS_LAKE_S3_REGION || 'auto').trim(),
    accessKeyId: String(opcoes.accessKeyId || env.NEXUS_LAKE_S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(opcoes.secretAccessKey || env.NEXUS_LAKE_S3_SECRET_ACCESS_KEY || '').trim(),
    urlStyle: String(opcoes.urlStyle || env.NEXUS_LAKE_S3_URL_STYLE || 'virtual').trim().toLowerCase(),
    prefixo: normalizarPrefixo(opcoes.prefixo ?? env.NEXUS_LAKE_PREFIX ?? 'nexus-lake'),
    raizTemporaria: resolverRaizTemporaria(opcoes)
  };
  const ausentes = ['bucket', 'endpoint', 'region', 'accessKeyId', 'secretAccessKey'].filter((campo) => !config[campo]);
  if (ausentes.length) throw new Error(`Configuracao S3 do lake incompleta: ${ausentes.join(', ')}.`);
  let endpointUrl;
  try { endpointUrl = new URL(config.endpoint); } catch (_) { throw new Error('NEXUS_LAKE_S3_ENDPOINT invalido.'); }
  if (!['https:', 'http:'].includes(endpointUrl.protocol)) throw new Error('Endpoint S3 deve usar HTTP ou HTTPS.');
  if (!['virtual', 'path'].includes(config.urlStyle)) throw new Error('NEXUS_LAKE_S3_URL_STYLE deve ser virtual ou path.');
  return { ...config, endpointUrl };
}

function escaparSql(valor) { return `'${String(valor).replace(/'/g, "''")}'`; }

function criarS3LakeStorage(opcoes = {}) {
  const config = configuracaoS3(opcoes);
  const cliente = opcoes.cliente || new S3Client({ region: config.region, endpoint: config.endpoint,
    forcePathStyle: config.urlStyle === 'path', credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  const criarUpload = opcoes.criarUpload || ((parametros) => new Upload(parametros));
  const maxManifestos = inteiroSeguro(opcoes.maxManifestos, 10_000, 'NEXUS_LAKE_S3_MAX_MANIFESTS', 1, 100_000);
  const cacheManifestos = new Map();
  const chaveComPrefixo = (...partes) => juntarChave(config.prefixo, ...partes);
  const uri = (chave) => `s3://${config.bucket}/${chave}`;
  function chaveDaReferencia(referencia) {
    const bruto = typeof referencia === 'string' ? referencia : referencia?.chaveManifesto || referencia?.caminhoManifesto;
    if (!bruto) throw new Error('Informe a referencia do manifesto.');
    const prefixoUri = `s3://${config.bucket}/`;
    const chave = bruto.startsWith(prefixoUri) ? bruto.slice(prefixoUri.length) : bruto;
    const normalizada = normalizarPrefixo(chave);
    const raiz = config.prefixo ? `${config.prefixo}/` : '';
    if (raiz && !normalizada.startsWith(raiz)) throw new Error('Referencia fora do prefixo autorizado do lake.');
    return normalizada;
  }
  async function obterObjeto(chave, limite = Infinity) {
    const resposta = await cliente.send(new GetObjectCommand({ Bucket: config.bucket, Key: chave }));
    return corpoParaBuffer(resposta.Body, limite);
  }
  async function lerManifesto(_camada, _objeto, referencia) {
    const chave = chaveDaReferencia(referencia);
    if (path.posix.basename(chave) !== 'manifest.json') throw new Error('Referencia nao aponta para manifesto.');
    return JSON.parse((await obterObjeto(chave, TAMANHO_MAXIMO_MANIFESTO)).toString('utf8'));
  }
  async function listarChavesManifesto(camada) {
    const prefix = chaveComPrefixo(camada) + '/'; const chaves = []; let ContinuationToken;
    do {
      const resposta = await cliente.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken, MaxKeys: 1000 }));
      for (const item of resposta.Contents || []) {
        if (item.Key?.endsWith('/manifest.json')) chaves.push(item.Key);
        if (chaves.length > maxManifestos) throw new Error('Quantidade de manifestos S3 excede o limite seguro.');
      }
      ContinuationToken = resposta.IsTruncated ? resposta.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return chaves;
  }
  async function listarManifestos(camada) {
    validarCamada(camada);
    if (!cacheManifestos.has(camada)) {
      const carregamento = (async () => {
        const chaves = await listarChavesManifesto(camada);
        return mapearComConcorrencia(chaves, 12, async (chaveManifesto) => ({
          chaveManifesto,
          manifesto: await lerManifesto(camada, null, chaveManifesto)
        }));
      })();
      cacheManifestos.set(camada, carregamento);
      carregamento.catch(() => cacheManifestos.delete(camada));
    }
    return cacheManifestos.get(camada);
  }
  async function existe(chave) {
    try { await cliente.send(new HeadObjectCommand({ Bucket: config.bucket, Key: chave })); return true; }
    catch (erro) { if (erro?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(erro?.name)) return false; throw erro; }
  }
  async function listarVersoes(camada, objeto) {
    validarCamada(camada); const versoes = [];
    for (const { chaveManifesto, manifesto } of await listarManifestos(camada)) {
      if (manifesto.status !== 'sucesso' || (manifesto.objeto || manifesto.entidade) !== objeto) continue;
      const nomeArquivo = segmentoSeguro(manifesto.arquivo || 'dados.parquet', 'Arquivo do manifesto');
      const base = path.posix.dirname(chaveManifesto); const chaveArquivo = juntarChave(base, nomeArquivo);
      if (!await existe(chaveArquivo)) continue;
      let chaveChavesAtuais = null;
      if (manifesto.reconciliacaoExclusoes) {
        chaveChavesAtuais = juntarChave(base, segmentoSeguro(manifesto.reconciliacaoExclusoes.arquivo, 'Snapshot de chaves'));
        if (!await existe(chaveChavesAtuais)) continue;
      }
      versoes.push({ manifesto, chaveManifesto, caminhoManifesto: uri(chaveManifesto), chaveArquivo,
        arquivo: uri(chaveArquivo), arquivoChavesAtuais: chaveChavesAtuais ? uri(chaveChavesAtuais) : null });
    }
    return ordenarVersoes(versoes);
  }
  async function listarReferencias(camada) {
    validarCamada(camada);
    return (await listarChavesManifesto(camada)).map(uri);
  }
  async function localizarDataset(camada, objeto, versao = 'latest') {
    const versoes = await listarVersoes(camada, objeto);
    if (!versoes.length) return null;
    if (versao === 'latest') return versoes.at(-1);
    return versoes.find((item) => item.manifesto.idExecucao === versao || item.manifesto.execucao === versao) || null;
  }
  async function enviarArquivo(chave, caminhoArquivo) {
    const [estatistica, hash] = await Promise.all([fs.stat(caminhoArquivo), sha256Arquivo(caminhoArquivo)]);
    const upload = criarUpload({ client: cliente, params: { Bucket: config.bucket, Key: chave,
      Body: createReadStream(caminhoArquivo),
      ContentType: chave.endsWith('.parquet') ? 'application/vnd.apache.parquet' : 'application/octet-stream',
      Metadata: { sha256: hash } }, leavePartsOnError: false });
    await upload.done();
    const head = await cliente.send(new HeadObjectCommand({ Bucket: config.bucket, Key: chave }));
    if (Number(head.ContentLength) !== estatistica.size || head.Metadata?.sha256 !== hash) throw new Error('Validacao do objeto enviado ao lake falhou.');
    return { tamanho: estatistica.size, sha256: hash };
  }
  async function publicarSnapshot(snapshot) {
    const { camada, objeto, manifesto, arquivoOrigem, arquivosExtras = [] } = snapshot || {};
    if (!camada || !objeto || !manifesto || !arquivoOrigem) throw new Error('Snapshot exige camada, objeto, manifesto e arquivoOrigem.');
    validarCamada(camada); segmentoSeguro(objeto, 'Objeto');
    const execucao = segmentoSeguro(String(manifesto.idExecucao || manifesto.execucao || Date.now()).replace(/[^a-zA-Z0-9_.=-]/g, ''), 'Identificador de execucao');
    const relativo = snapshot.prefixoRelativo ? normalizarPrefixo(snapshot.prefixoRelativo) : juntarChave(camada, objeto, `execucao=${execucao}`);
    if (!relativo.startsWith(`${camada}/`)) throw new Error('Destino do snapshot fora da camada autorizada.');
    const base = chaveComPrefixo(relativo);
    const chaveManifesto = juntarChave(base, 'manifest.json');
    if (await existe(chaveManifesto)) {
      const erro = new Error('O snapshot informado ja foi publicado e e imutavel.');
      erro.codigo = 'S3_SNAPSHOT_ALREADY_PUBLISHED';
      throw erro;
    }
    try {
      const nomeArquivo = segmentoSeguro(manifesto.arquivo || 'dados.parquet', 'Arquivo do manifesto');
      const principal = await enviarArquivo(juntarChave(base, nomeArquivo), arquivoOrigem);
      for (const extra of arquivosExtras) await enviarArquivo(juntarChave(base, segmentoSeguro(extra?.nome, 'Arquivo extra')), extra.origem);
      const manifestoFinal = { ...manifesto, status: 'sucesso', integridadeObjeto: { tamanhoBytes: principal.tamanho, sha256: principal.sha256 } };
      const buffer = Buffer.from(`${JSON.stringify(manifestoFinal, null, 2)}\n`);
      await cliente.send(new PutObjectCommand({ Bucket: config.bucket, Key: chaveManifesto, Body: buffer,
        ContentType: 'application/json', Metadata: { sha256: sha256Buffer(buffer) }, IfNoneMatch: '*' }));
      cacheManifestos.delete(camada);
      return { caminho: uri(base), caminhoManifesto: uri(chaveManifesto), manifesto: manifestoFinal };
    } catch (erro) { erro.codigo ||= 'S3_SNAPSHOT_PUBLICATION_FAILED'; throw erro; }
  }
  async function prepararConexaoDuckDB(conexao) {
    if (!conexao) throw new Error('Conexao DuckDB obrigatoria para preparar o lake S3.');
    const { runDuckDB } = require('../duckdb/connections');
    try { await runDuckDB(conexao, 'LOAD httpfs;'); } catch (_) { await runDuckDB(conexao, 'INSTALL httpfs;'); await runDuckDB(conexao, 'LOAD httpfs;'); }
    await runDuckDB(conexao, 'DROP SECRET IF EXISTS nexus_lake_s3;');
    await runDuckDB(conexao, `CREATE SECRET nexus_lake_s3 (TYPE s3, KEY_ID ${escaparSql(config.accessKeyId)}, SECRET ${escaparSql(config.secretAccessKey)}, REGION ${escaparSql(config.region)}, ENDPOINT ${escaparSql(config.endpointUrl.host)}, URL_STYLE ${escaparSql(config.urlStyle === 'virtual' ? 'vhost' : 'path')}, USE_SSL ${config.endpointUrl.protocol === 'https:' ? 'true' : 'false'});`);
  }
  async function verificarSaude() {
    try {
      const resposta = await cliente.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: config.prefixo ? `${config.prefixo}/` : '', MaxKeys: 1 }));
      return { saudavel: true, tipo: 's3', bucketConfigurado: true, prefixo: config.prefixo, possuiObjetos: Boolean(resposta.Contents?.length) };
    } catch (erro) { return { saudavel: false, tipo: 's3', codigo: erro.code || erro.name || 'S3_UNAVAILABLE' }; }
  }
  async function excluirPrefixoTeste(prefixoRelativo) {
    const relativo = normalizarPrefixo(prefixoRelativo);
    if (!relativo.startsWith('_smoke/')) throw new Error('Somente prefixos de smoke test podem ser excluidos.');
    const prefix = chaveComPrefixo(relativo) + '/'; let token;
    do {
      const pagina = await cliente.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }));
      const objetos = (pagina.Contents || []).map((item) => ({ Key: item.Key }));
      if (objetos.length) await cliente.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objetos, Quiet: true } }));
      token = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
    } while (token);
  }
  async function fechar() { cliente.destroy?.(); }
  return Object.freeze({ tipo: 's3', raizLake: null, raizTemporaria: config.raizTemporaria,
    bucket: config.bucket, prefixo: config.prefixo, localizarDataset, lerManifesto,
    listarReferencias, listarVersoes,
    publicarSnapshot, prepararConexaoDuckDB, verificarSaude, excluirPrefixoTeste,
    fechar, uriParaChave: uri });
}

function criarLakeStorage(opcoes = {}) {
  const tipo = String(opcoes.tipo || opcoes.env?.NEXUS_LAKE_STORAGE || process.env.NEXUS_LAKE_STORAGE || 'filesystem').toLowerCase();
  if (tipo === 'filesystem') return criarFileSystemLakeStorage(opcoes);
  if (tipo === 's3') return criarS3LakeStorage(opcoes);
  throw new Error(`LakeStorage nao implementado: ${tipo}.`);
}

module.exports = { RAIZ_LAKE_LOCAL, caminhoSeguro, configuracaoS3, criarFileSystemLakeStorage,
  criarLakeStorage, criarS3LakeStorage, juntarChave, normalizarPrefixo, resolverRaizLake,
  resolverRaizTemporaria, sha256Arquivo };
