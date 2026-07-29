const {
  ferramentaDeNegocio,
  obterFerramentaPorNome,
  obterPerfilDaFerramenta
} = require('./ferramentas');

function mensagensDoErro(erro) {
  const mensagens = [];
  const visitados = new Set();
  let atual = erro;
  while (atual && !visitados.has(atual)) {
    visitados.add(atual);
    if (atual.message) mensagens.push(String(atual.message));
    atual = atual.cause;
  }
  return mensagens.join('\n');
}

function extrairToolNaoDisponivel(erro) {
  const mensagem = mensagensDoErro(erro);
  const padroes = [
    /attempted to call tool ['"]([a-z][a-z0-9_]*)['"]/i,
    /tool ['"]?([a-z][a-z0-9_]*)['"]? (?:was )?not in request\.tools/i,
    /ferramenta desconhecida(?: solicitada[^:]*|):\s*([a-z][a-z0-9_]*)/i,
    /tool desconhecida:\s*([a-z][a-z0-9_]*)/i
  ];
  for (const padrao of padroes) {
    const encontrada = mensagem.match(padrao);
    if (encontrada) return encontrada[1];
  }
  return null;
}

function planejarRecuperacaoTool(erro, ferramentasAtuais = [], dependencias = {}) {
  const nome = extrairToolNaoDisponivel(erro);
  if (!nome || !ferramentaDeNegocio(nome)) return null;
  if (ferramentasAtuais.some((item) => item.definicao.name === nome)) return null;
  const ferramenta = obterFerramentaPorNome(nome, dependencias);
  const perfil = obterPerfilDaFerramenta(nome);
  if (!ferramenta || !perfil) return null;
  return { nome, perfil, ferramenta };
}

module.exports = {
  extrairToolNaoDisponivel,
  mensagensDoErro,
  planejarRecuperacaoTool
};
