require('dotenv').config({ quiet: true });

const {
  DEFINICOES_CONEXAO,
  resolverConexao,
  resumirConexao
} = require('../integracoes/microsoft/conexoes');
const { criarClienteGraph } = require('../integracoes/microsoft/graph');

function lerArgumentos(argumentos) {
  function valorDepoisDe(flag) {
    const indice = argumentos.indexOf(flag);
    return indice >= 0 ? argumentos[indice + 1] : undefined;
  }
  return {
    comando: argumentos[0] || 'status',
    conexao: valorDepoisDe('--conexao'),
    testar: argumentos.includes('--testar'),
    itemId: valorDepoisDe('--item'),
    driveId: valorDepoisDe('--drive'),
    caminho: valorDepoisDe('--caminho'),
    termo: valorDepoisDe('--termo'),
    host: valorDepoisDe('--host'),
    sitePath: valorDepoisDe('--site-path')
  };
}

function conexoesSelecionadas(id, env = process.env) {
  const ids = id ? [id] : Object.keys(DEFINICOES_CONEXAO);
  return ids.map((conexaoId) => resolverConexao(conexaoId, {
    env,
    exigirCredenciais: false
  }));
}

function itemResumido(item) {
  return {
    id: item.id,
    nome: item.name,
    tipo: item.folder ? 'pasta' : 'arquivo',
    tamanhoBytes: item.size ?? null,
    modificadoEm: item.lastModifiedDateTime || null,
    webUrl: item.webUrl || null
  };
}

async function testarConexao(conexao) {
  const completa = resolverConexao(conexao.id);
  const graph = criarClienteGraph(completa);
  if (completa.tipo === 'biblioteca_compartilhada' && !completa.driveId) {
    const site = await graph.resolverSite();
    const drives = await graph.listarDrivesDoSite(site.id);
    return {
      status: 'conectada',
      site: {
        id: site.id,
        nome: site.displayName,
        webUrl: site.webUrl
      },
      drives: drives.map((drive) => ({
        id: drive.id,
        nome: drive.name,
        tipo: drive.driveType,
        webUrl: drive.webUrl
      }))
    };
  }
  const drive = await graph.resolverDrive();
  return {
    status: 'conectada',
    drive: {
      id: drive.id,
      nome: drive.name,
      tipo: drive.driveType,
      webUrl: drive.webUrl
    }
  };
}

async function executarStatus(opcoes) {
  const resultados = [];
  for (const conexao of conexoesSelecionadas(opcoes.conexao)) {
    const resumo = resumirConexao(conexao);
    if (opcoes.testar && resumo.pronta) {
      try {
        resumo.teste = await testarConexao(conexao);
      } catch (erro) {
        resumo.teste = { status: 'erro', mensagem: erro.message };
      }
    }
    resultados.push(resumo);
  }
  return resultados;
}

async function clienteConfigurado(id) {
  if (!id) throw new Error('Informe --conexao fid_onedrive ou automacoes_onedrive.');
  const conexao = resolverConexao(id);
  const graphInicial = criarClienteGraph(conexao);
  if (conexao.driveId) return { conexao, graph: graphInicial, driveId: conexao.driveId };
  const drive = await graphInicial.resolverDrive();
  const resolvida = { ...conexao, driveId: drive.id };
  return {
    conexao: resolvida,
    graph: criarClienteGraph(resolvida),
    driveId: drive.id
  };
}

async function executarDescobrir(opcoes) {
  if (!opcoes.conexao) {
    throw new Error('Informe --conexao fid_onedrive ou automacoes_onedrive.');
  }
  const conexao = resolverConexao(opcoes.conexao);
  const graph = criarClienteGraph(conexao);
  if (conexao.tipo === 'biblioteca_compartilhada') {
    const site = await graph.resolverSite(opcoes.host, opcoes.sitePath);
    const drives = await graph.listarDrivesDoSite(site.id);
    return {
      conexao: conexao.nome,
      site: { id: site.id, nome: site.displayName, webUrl: site.webUrl },
      drives: drives.map((drive) => ({
        id: drive.id,
        nome: drive.name,
        tipo: drive.driveType,
        webUrl: drive.webUrl
      }))
    };
  }
  const drive = await graph.resolverDrive();
  return {
    conexao: conexao.nome,
    drive: {
      id: drive.id,
      nome: drive.name,
      tipo: drive.driveType,
      webUrl: drive.webUrl
    }
  };
}

async function executarListar(opcoes) {
  const { conexao, graph, driveId } = await clienteConfigurado(opcoes.conexao);
  const itens = await graph.listarFilhos({
    driveId,
    itemId: opcoes.itemId,
    caminho: opcoes.caminho
  });
  return {
    conexao: conexao.nome,
    driveId,
    local: opcoes.itemId || opcoes.caminho || '/',
    total: itens.length,
    itens: itens.map(itemResumido)
  };
}

async function executarBuscar(opcoes) {
  if (!opcoes.termo) throw new Error('Informe --termo "nome do arquivo".');
  const { conexao, graph, driveId } = await clienteConfigurado(opcoes.conexao);
  const itens = await graph.buscar(opcoes.termo, driveId);
  return {
    conexao: conexao.nome,
    driveId,
    termo: opcoes.termo,
    total: itens.length,
    itens: itens.map(itemResumido)
  };
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  let resultado;
  if (opcoes.comando === 'status') resultado = await executarStatus(opcoes);
  else if (opcoes.comando === 'descobrir') resultado = await executarDescobrir(opcoes);
  else if (opcoes.comando === 'listar') resultado = await executarListar(opcoes);
  else if (opcoes.comando === 'buscar') resultado = await executarBuscar(opcoes);
  else throw new Error('Comando invalido. Use status, descobrir, listar ou buscar.');
  console.log(JSON.stringify(resultado, null, 2));
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Falha no OneDrive: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  executarBuscar,
  executarDescobrir,
  executarListar,
  executarStatus,
  itemResumido,
  lerArgumentos
};
