const { resolverConexao } = require('../integracoes/microsoft/conexoes');
const { criarClienteGraphEscrita } = require('../integracoes/microsoft/graph');

function nomeArquivoSeguro(valor) {
  const nome = String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\x00-\x1f:*?"<>|/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  return nome || 'Documento Nexus';
}

function pastaDocumento(documento) {
  if (documento.escopo === 'global') return documento.tipo === 'politica' ? 'POLITICAS' : 'MANUAIS';
  return `PROCEDIMENTOS ${nomeArquivoSeguro(documento.department_name || documento.department_slug || 'SETOR').toUpperCase()}`;
}

function criarKnowledgeOneDrivePublisher(opcoes = {}) {
  if (opcoes.publisher) return opcoes.publisher;
  const conexao = opcoes.conexao || resolverConexao(opcoes.conexaoId || 'fid_onedrive');
  const driveId = opcoes.driveId || conexao.driveId || process.env.FID_ONEDRIVE_DRIVE_ID;
  const cliente = opcoes.cliente || criarClienteGraphEscrita({ ...conexao, driveId }, {
    rootPath: opcoes.rootPath || process.env.NEXUS_KNOWLEDGE_ONEDRIVE_PUBLISH_ROOT_PATH,
    fetchImpl: opcoes.fetchImpl, obterToken: opcoes.obterToken
  });
  async function publicar({ documento, versao, docxBuffer, pdfBuffer }) {
    const pasta = pastaDocumento(documento);
    const base = `${nomeArquivoSeguro(versao.titulo)} - v${versao.numero}`;
    const [docx, pdf] = await Promise.all([
      cliente.enviarArquivo({ driveId, caminho: `${pasta}/${base}.docx`, buffer: docxBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      cliente.enviarArquivo({ driveId, caminho: `${pasta}/${base}.pdf`, buffer: pdfBuffer,
        contentType: 'application/pdf' })
    ]);
    return { docx, pdf, pasta };
  }
  return Object.freeze({ publicar });
}

module.exports = { criarKnowledgeOneDrivePublisher, nomeArquivoSeguro, pastaDocumento };
