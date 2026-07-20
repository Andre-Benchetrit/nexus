async function prepararFontesBronze(leitor, nomes) {
  const contextos = new Map();
  for (const nome of nomes) {
    contextos.set(nome, await leitor.prepararEntidade(nome));
  }
  return contextos;
}

module.exports = { prepararFontesBronze };
