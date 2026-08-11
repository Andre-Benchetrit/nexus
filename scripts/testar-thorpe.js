#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { criarClienteThorpe } = require('../integracoes/thorpe/cliente');
const { resolverConfiguracaoThorpe } = require('../integracoes/thorpe/configuracao');

async function main() {
  const sku = String(process.argv[2] || '').trim();
  if (!sku) {
    throw new Error('Informe o SKU. Exemplo: npm run thorpe:testar -- ABC123');
  }
  const cliente = criarClienteThorpe({
    configuracao: resolverConfiguracaoThorpe()
  });
  const estoque = await cliente.consultarEstoque(sku);
  console.log(JSON.stringify(estoque, null, 2));
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
