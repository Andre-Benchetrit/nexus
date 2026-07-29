const DEFINICOES_CONEXAO = Object.freeze({
  fid_onedrive: Object.freeze({
    id: 'fid_onedrive',
    nome: 'FID - ONEDRIVE',
    tipo: 'biblioteca_compartilhada',
    descricao: 'Biblioteca corporativa compartilhada da FID.',
    driveIdEnv: 'FID_ONEDRIVE_DRIVE_ID',
    siteIdEnv: 'FID_ONEDRIVE_SITE_ID',
    siteHostEnv: 'FID_ONEDRIVE_SITE_HOST',
    sitePathEnv: 'FID_ONEDRIVE_SITE_PATH'
  }),
  automacoes_onedrive: Object.freeze({
    id: 'automacoes_onedrive',
    nome: 'AUTOMAÇÕES - ONEDRIVE',
    tipo: 'onedrive_corporativo',
    descricao: 'OneDrive da conta corporativa usada pelas automações e pelo N8N.',
    driveIdEnv: 'AUTOMACOES_ONEDRIVE_DRIVE_ID',
    usuarioEnv: 'AUTOMACOES_ONEDRIVE_USUARIO'
  })
});

const CAMPOS_CREDENCIAL = Object.freeze({
  tenantId: 'MICROSOFT_TENANT_ID',
  clientId: 'MICROSOFT_CLIENT_ID',
  clientSecret: 'MICROSOFT_CLIENT_SECRET'
});

function obterDefinicaoConexao(id) {
  const conexao = DEFINICOES_CONEXAO[id];
  if (!conexao) {
    throw new Error(
      `Conexao Microsoft desconhecida: ${id}. ` +
      `Disponiveis: ${Object.keys(DEFINICOES_CONEXAO).join(', ')}.`
    );
  }
  return conexao;
}

function lerEnv(env, nome) {
  const valor = env[nome];
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function resolverConexao(id, opcoes = {}) {
  const env = opcoes.env || process.env;
  const exigirCredenciais = opcoes.exigirCredenciais !== false;
  const definicao = obterDefinicaoConexao(id);
  const credenciais = {
    tenantId: lerEnv(env, CAMPOS_CREDENCIAL.tenantId),
    clientId: lerEnv(env, CAMPOS_CREDENCIAL.clientId),
    clientSecret: lerEnv(env, CAMPOS_CREDENCIAL.clientSecret)
  };

  if (exigirCredenciais) {
    const ausentes = Object.entries(credenciais)
      .filter(([, valor]) => !valor)
      .map(([campo]) => CAMPOS_CREDENCIAL[campo]);
    if (ausentes.length) {
      throw new Error(`Configuracao Microsoft ausente: ${ausentes.join(', ')}.`);
    }
  }

  return {
    ...definicao,
    credenciais,
    driveId: lerEnv(env, definicao.driveIdEnv),
    siteId: definicao.siteIdEnv ? lerEnv(env, definicao.siteIdEnv) : null,
    siteHost: definicao.siteHostEnv ? lerEnv(env, definicao.siteHostEnv) : null,
    sitePath: definicao.sitePathEnv ? lerEnv(env, definicao.sitePathEnv) : null,
    usuario: definicao.usuarioEnv ? lerEnv(env, definicao.usuarioEnv) : null
  };
}

function resumirConexao(conexao) {
  return {
    id: conexao.id,
    nome: conexao.nome,
    tipo: conexao.tipo,
    descricao: conexao.descricao,
    credenciais: {
      tenantId: Boolean(conexao.credenciais.tenantId),
      clientId: Boolean(conexao.credenciais.clientId),
      clientSecret: Boolean(conexao.credenciais.clientSecret)
    },
    origem: {
      driveId: conexao.driveId || null,
      siteId: conexao.siteId || null,
      siteHost: conexao.siteHost || null,
      sitePath: conexao.sitePath || null,
      usuario: conexao.usuario || null
    },
    pronta:
      Boolean(conexao.credenciais.tenantId) &&
      Boolean(conexao.credenciais.clientId) &&
      Boolean(conexao.credenciais.clientSecret) &&
      Boolean(
        conexao.driveId ||
        conexao.usuario ||
        conexao.siteId ||
        (conexao.siteHost && conexao.sitePath)
      )
  };
}

module.exports = {
  CAMPOS_CREDENCIAL,
  DEFINICOES_CONEXAO,
  obterDefinicaoConexao,
  resolverConexao,
  resumirConexao
};
