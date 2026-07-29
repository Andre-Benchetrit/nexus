async function operacaoArquivoComRetentativas(operacao, opcoes = {}) {
  const configuracao = typeof opcoes === 'number' ? { tentativas: opcoes } : opcoes;
  const tentativas = Number(configuracao.tentativas || 10);
  const esperaMs = Number(configuracao.esperaMs || 100);
  let ultimoErro;
  for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
    try {
      return await operacao();
    } catch (erro) {
      ultimoErro = erro;
      if (!['EBUSY', 'EPERM'].includes(erro.code) || tentativa === tentativas - 1) throw erro;
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
  throw ultimoErro;
}

module.exports = { operacaoArquivoComRetentativas };
