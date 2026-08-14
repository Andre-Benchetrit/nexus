const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { criarPostgresMemoryStore } = require('./memoria_postgres');

const RAIZ = path.resolve(__dirname, '..');
const DIRETORIO_RUNTIME = path.join(RAIZ, 'memoria', '.runtime');
const ARQUIVO_CONHECIMENTO = path.join(RAIZ, 'memoria', 'conhecimento.json');

function checksum(conteudo) {
  return createHash('sha256').update(conteudo).digest('hex');
}

function lerFonte(caminho) {
  const conteudo = fs.readFileSync(caminho, 'utf8');
  return { conteudo, dados: JSON.parse(conteudo), checksum: checksum(conteudo) };
}

async function importacaoAtual(pool, sourceKey, hash) {
  const linha = (await pool.query(
    'SELECT checksum FROM nexus.legacy_imports WHERE source_key=$1', [sourceKey]
  )).rows[0];
  return linha?.checksum === hash;
}

async function registrarImportacao(pool, sourceKey, hash, detalhes) {
  await pool.query(`
    INSERT INTO nexus.legacy_imports (source_key, checksum, detalhes)
    VALUES ($1,$2,$3::jsonb)
    ON CONFLICT (source_key) DO UPDATE SET checksum=EXCLUDED.checksum,
      detalhes=EXCLUDED.detalhes, importado_em=now()
  `, [sourceKey, hash, JSON.stringify(detalhes)]);
}

async function importarSessao(pool, caminho, opcoes = {}) {
  const fonte = lerFonte(caminho);
  const nome = path.basename(caminho);
  const sourceKey = `memoria_curta:${nome}`;
  const sessaoArquivo = fonte.dados.sessao || nome.replace(/^sessao-|\.json$/g, '');
  if (await importacaoAtual(pool, sourceKey, fonte.checksum)) {
    const memoria = criarPostgresMemoryStore({
      pool, sessao: sessaoArquivo, principalSlug: opcoes.principalSlug || 'legacy-cli'
    });
    await memoria.obterContexto();
    return { fonte: nome, status: 'inalterada', interacoes: 0, tarefas: 0 };
  }
  const memoria = criarPostgresMemoryStore({
    pool,
    sessao: sessaoArquivo,
    principalSlug: opcoes.principalSlug || 'legacy-cli'
  });
  const chavesEsperadas = [];
  for (const [indice, interacao] of (fonte.dados.interacoes || []).entries()) {
    const chave = `${sourceKey}:interacao:${indice}`;
    chavesEsperadas.push(chave);
    await memoria.registrarInteracao(interacao, { sourceKey: chave });
  }
  if (chavesEsperadas.length) {
    await pool.query(`DELETE FROM nexus.interactions
      WHERE source_key LIKE $1 AND NOT (source_key = ANY($2::text[]))`,
    [`${sourceKey}:interacao:%`, chavesEsperadas]);
  } else {
    await pool.query('DELETE FROM nexus.interactions WHERE source_key LIKE $1', [`${sourceKey}:interacao:%`]);
  }
  const tarefas = fonte.dados.tarefas || [];
  const ativaId = fonte.dados.tarefaAtiva || null;
  for (const tarefa of tarefas.filter((item) => item.id !== ativaId)) {
    const estado = ['ativa', 'aguardando_usuario'].includes(tarefa.estado) ? 'pausada' : tarefa.estado;
    await memoria.salvarTarefa({ ...tarefa, estado }, { ativar: false });
  }
  const ativa = tarefas.find((item) => item.id === ativaId);
  if (ativa) await memoria.salvarTarefa(ativa, { ativar: true });
  await registrarImportacao(pool, sourceKey, fonte.checksum, {
    sessao: memoria.sessao,
    interacoes: fonte.dados.interacoes?.length || 0,
    tarefas: tarefas.length
  });
  return {
    fonte: nome, status: 'importada',
    interacoes: fonte.dados.interacoes?.length || 0, tarefas: tarefas.length
  };
}

async function importarConhecimento(pool, caminho = ARQUIVO_CONHECIMENTO) {
  const fonte = lerFonte(caminho);
  const sourceKey = `memoria_longa_v2:${path.basename(caminho)}`;
  if (await importacaoAtual(pool, sourceKey, fonte.checksum)) {
    return { fonte: path.basename(caminho), status: 'inalterada', conhecimentos: 0 };
  }
  const memoria = criarPostgresMemoryStore({ pool, sessao: 'importacao', principalSlug: 'legacy-cli' });
  for (const item of fonte.dados.itens || []) {
    await memoria.adicionarConhecimento({ ...item, id: item.id });
  }
  await registrarImportacao(pool, sourceKey, fonte.checksum, {
    conhecimentos: fonte.dados.itens?.length || 0
  });
  return {
    fonte: path.basename(caminho), status: 'importada',
    conhecimentos: fonte.dados.itens?.length || 0
  };
}

async function importarMemoria(pool, opcoes = {}) {
  const diretorio = opcoes.diretorioRuntime || DIRETORIO_RUNTIME;
  const arquivos = fs.existsSync(diretorio)
    ? fs.readdirSync(diretorio).filter((nome) => /^sessao-.+\.json$/.test(nome)).sort()
    : [];
  const sessoes = [];
  for (const nome of arquivos) {
    sessoes.push(await importarSessao(pool, path.join(diretorio, nome), opcoes));
  }
  const conhecimento = fs.existsSync(opcoes.arquivoConhecimento || ARQUIVO_CONHECIMENTO)
    ? await importarConhecimento(pool, opcoes.arquivoConhecimento || ARQUIVO_CONHECIMENTO)
    : null;
  return { sessoes, conhecimento };
}

async function verificarMemoria(pool, opcoes = {}) {
  const principalSlug = opcoes.principalSlug || 'legacy-cli';
  const banco = (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM nexus.conversations c JOIN nexus.principals p ON p.id=c.principal_id WHERE p.slug=$1) AS conversas,
      (SELECT count(*)::int FROM nexus.interactions i JOIN nexus.conversations c ON c.id=i.conversation_id JOIN nexus.principals p ON p.id=c.principal_id WHERE p.slug=$1) AS interacoes,
      (SELECT count(*)::int FROM nexus.interaction_tasks t JOIN nexus.conversations c ON c.id=t.conversation_id JOIN nexus.principals p ON p.id=c.principal_id WHERE p.slug=$1) AS tarefas,
      (SELECT count(*)::int FROM nexus.knowledge_items) AS conhecimentos,
      (SELECT count(*)::int FROM nexus.legacy_imports) AS importacoes
  `, [principalSlug])).rows[0];
  const arquivos = fs.existsSync(opcoes.diretorioRuntime || DIRETORIO_RUNTIME)
    ? fs.readdirSync(opcoes.diretorioRuntime || DIRETORIO_RUNTIME).filter((nome) => /^sessao-.+\.json$/.test(nome))
    : [];
  const origem = { conversas: arquivos.length, interacoes: 0, tarefas: 0, conhecimentos: 0 };
  for (const nome of arquivos) {
    const dados = lerFonte(path.join(opcoes.diretorioRuntime || DIRETORIO_RUNTIME, nome)).dados;
    origem.interacoes += dados.interacoes?.length || 0;
    origem.tarefas += dados.tarefas?.length || 0;
  }
  const caminhoConhecimento = opcoes.arquivoConhecimento || ARQUIVO_CONHECIMENTO;
  if (fs.existsSync(caminhoConhecimento)) {
    origem.conhecimentos = lerFonte(caminhoConhecimento).dados.itens?.length || 0;
  }
  return {
    status: banco.conversas >= origem.conversas && banco.interacoes >= origem.interacoes && banco.tarefas >= origem.tarefas &&
      banco.conhecimentos >= origem.conhecimentos ? 'ok' : 'incompleto',
    origem,
    banco
  };
}

async function exportarConhecimento(pool) {
  const memoria = criarPostgresMemoryStore({ pool, sessao: 'exportacao', principalSlug: 'legacy-cli' });
  return { versao: 1, itens: await memoria.listarLonga() };
}

module.exports = {
  ARQUIVO_CONHECIMENTO,
  DIRETORIO_RUNTIME,
  checksum,
  exportarConhecimento,
  importarConhecimento,
  importarMemoria,
  importarSessao,
  verificarMemoria
};
