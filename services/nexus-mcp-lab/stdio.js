const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const { criarServidorLaboratorio } = require('./laboratorio');

const handle = serveStdio(() => criarServidorLaboratorio(), {
  legacy: 'reject',
  onerror: (erro) => {
    process.stderr.write(`Falha no laboratorio MCP stdio: ${erro?.code || erro?.name || 'MCP_LAB_ERROR'}\n`);
  }
});

const encerrar = async () => {
  await handle.close();
  process.exit(0);
};
process.once('SIGTERM', encerrar);
process.once('SIGINT', encerrar);
