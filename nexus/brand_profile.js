const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CORES_PADRAO = Object.freeze({
  primaria: '#0b6b45', secundaria: '#153c2c', destaque: '#19e68c',
  texto: '#ffffff', superficie: '#07100b'
});

function corSegura(valor, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(valor || '')) ? String(valor) : fallback;
}

function lerJsonMarca(valor) {
  if (!valor) return {};
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(String(valor)); }
  catch (_) {
    const erro = new Error('O perfil visual configurado não é um JSON válido.');
    erro.codigo = 'BRAND_PROFILE_INVALID'; throw erro;
  }
}

function criarBrandProfileProvider(opcoes = {}) {
  const configurado = lerJsonMarca(opcoes.profile || process.env.NEXUS_BRAND_PROFILE_JSON ||
    process.env.NEXUS_ARTIFACT_BRAND_JSON || '');
  const logo = opcoes.logo || process.env.NEXUS_BRAND_LOGO ||
    process.env.NEXUS_ARTIFACT_BRAND_LOGO || configurado.logo || null;
  const cores = Object.fromEntries(Object.entries(CORES_PADRAO).map(([chave, fallback]) => [
    chave, corSegura(configurado.cores?.[chave], fallback)
  ]));
  const profile = Object.freeze({
    nome: String(configurado.nome || 'FID').slice(0, 100),
    versao: String(configurado.versao || '1').slice(0, 80),
    cores,
    tipografia: String(configurado.tipografia || 'Arial').slice(0, 80),
    logo: logo ? path.resolve(String(logo)) : null,
    logoMinWidthPercent: Math.min(30, Math.max(4, Number(configurado.logoMinWidthPercent || 8))),
    clearSpacePercent: Math.min(12, Math.max(1, Number(configurado.clearSpacePercent || 4)))
  });

  async function carregarLogo() {
    if (!profile.logo) {
      const erro = new Error('A logo oficial não foi configurada para esta implantação.');
      erro.codigo = 'BRAND_LOGO_UNAVAILABLE'; throw erro;
    }
    try { return await fs.readFile(profile.logo); }
    catch (_) {
      const erro = new Error('Não foi possível abrir a logo oficial configurada.');
      erro.codigo = 'BRAND_LOGO_UNAVAILABLE'; throw erro;
    }
  }

  function resumoPublico() {
    return { nome: profile.nome, versao: profile.versao, cores: profile.cores,
      tipografia: profile.tipografia, logoDisponivel: Boolean(profile.logo),
      fingerprint: crypto.createHash('sha256').update(JSON.stringify({
        nome: profile.nome, versao: profile.versao, cores: profile.cores,
        tipografia: profile.tipografia, logo: profile.logo ? path.basename(profile.logo) : null
      })).digest('hex') };
  }

  return { obter: () => profile, carregarLogo, resumoPublico };
}

module.exports = { CORES_PADRAO, criarBrandProfileProvider, lerJsonMarca };
