const { entidades, obterEntidade } = require('../exportadores/catalogo');
const { exportarPostgres } = require('../exportadores/postgres/exportar');

function lerArgumentos(argumentos) {
  function valorDepoisDe(flag) {
    const indice = argumentos.indexOf(flag);
    return indice >= 0 ? argumentos[indice + 1] : undefined;
  }

  return {
    nome: argumentos[0]?.startsWith('--') ? undefined : argumentos[0],
    listar: argumentos.includes('--listar'),
    dryRun: argumentos.includes('--dry-run'),
    forcar: argumentos.includes('--forcar'),
    inicio: valorDepoisDe('--inicio'),
    fim: valorDepoisDe('--fim')
  };
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));

  if (opcoes.listar) {
    console.log(Object.keys(entidades).join('\n'));
    return;
  }

  if (!opcoes.nome) {
    throw new Error('Informe a entidade. Exemplo: npm run exportar -- nota_saida');
  }

  const entidade = obterEntidade(opcoes.nome);
  const resultado = await exportarPostgres(entidade, {
    dryRun: opcoes.dryRun,
    forcar: opcoes.forcar,
    inicio: opcoes.inicio,
    fim: opcoes.fim
  });

  if (opcoes.dryRun) {
    console.log('Simulação concluída; nenhum dado foi extraído.');
    console.log(`Consulta: ${resultado.consulta}`);
    console.log(`Destino: ${resultado.caminhos.parquet}`);
  }
}

main().catch((error) => {
  console.error(`Falha na exportação: ${error.message}`);
  process.exitCode = 1;
});
