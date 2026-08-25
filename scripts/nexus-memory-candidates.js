const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { criarServicoMemoriaGovernada } = require('../nexus/memoria_governada');

function lerArgumentos(lista) {
  const posicionais = [];
  const opcoes = {};
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith('--')) posicionais.push(item);
    else {
      const chave = item.slice(2);
      const valor = lista[++i];
      if (!valor || valor.startsWith('--')) throw new Error(`${item} exige um valor.`);
      opcoes[chave] = valor;
    }
  }
  return { acao: posicionais[0], id: posicionais[1], opcoes };
}

async function main() {
  const { acao, id, opcoes } = lerArgumentos(process.argv.slice(2));
  if (!acao) throw new Error('Use list, show, approve, reject, request-changes ou revoke.');
  const revisao = ['approve', 'reject', 'request-changes', 'revoke'].includes(acao);
  if (revisao && !opcoes.principal) throw new Error('Revisoes exigem --principal.');
  if (revisao && !opcoes.motivo) throw new Error('Revisoes exigem --motivo.');
  if (acao !== 'list' && !id) throw new Error(`${acao} exige o id da candidatura.`);
  const pool = criarPoolNexus();
  try {
    const servico = criarServicoMemoriaGovernada({
      pool,
      principalSlug: opcoes.principal || 'legacy-cli',
      departamentoSlug: opcoes.setor || null,
      sessao: opcoes.sessao || 'padrao',
      modo: 'propose'
    });
    let resultado;
    if (acao === 'list') resultado = await servico.listar({ status: opcoes.status, tipo: opcoes.tipo });
    else if (acao === 'show') resultado = await servico.obter(id);
    else {
      const decisoes = {
        approve: 'approved', reject: 'rejected',
        'request-changes': 'changes_requested', revoke: 'revoked'
      };
      if (!decisoes[acao]) throw new Error(`Acao desconhecida: ${acao}`);
      resultado = await servico.revisar(id, decisoes[acao], {
        motivo: opcoes.motivo,
        declaracao: opcoes.declaracao,
        gatilhos: opcoes.gatilhos?.split(',').map((item) => item.trim()).filter(Boolean),
        escopo: opcoes.escopo,
        targetPrincipalId: opcoes['principal-alvo'],
        targetDepartmentId: opcoes['setor-id']
      });
    }
    console.log(JSON.stringify(resultado, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = { lerArgumentos };
