const { criarLeitorSilver } = require('../silver');

async function main() {
  const leitor = criarLeitorSilver();

  try {
    const resultado = await leitor.consultar(
    'fato_nota_saida_bloqueio',
    {
        filtros: {
        id_nota_saida: 1946009
        },
        limite: 100
    }
    );

    console.table(resultado.dados);
  } finally {
    await leitor.fechar();
  }
}

main().catch((erro) => {
  console.error('Erro ao consultar bloqueios:', erro);
  process.exitCode = 1;
});