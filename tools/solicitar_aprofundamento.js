const { serializar, validarObjeto } = require('./core/validacao');

const CAMADAS = Object.freeze(['gold', 'silver', 'bronze']);
const FINALIDADES = Object.freeze(['consultar', 'agregar', 'descrever', 'auditar']);

const definicaoSolicitarAprofundamento = {
  type: 'function',
  name: 'solicitar_aprofundamento',
  description: 'Libera uma camada tecnica somente quando a fachada atual nao basta. Priorize Gold, depois Silver; Bronze apenas para auditoria.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      camada: { type: 'string', enum: CAMADAS },
      finalidade: { type: 'string', enum: FINALIDADES },
      justificativa: {
        type: 'string',
        description: 'Explique em uma frase qual dado faltou ou precisa ser conferido.'
      }
    },
    required: ['camada', 'finalidade', 'justificativa'],
    additionalProperties: false
  }
};

function validarSolicitacaoAprofundamento(argumentos) {
  validarObjeto(argumentos);
  if (!CAMADAS.includes(argumentos.camada)) {
    throw new Error(`Camada de aprofundamento invalida: ${argumentos.camada}.`);
  }
  if (!FINALIDADES.includes(argumentos.finalidade)) {
    throw new Error(`Finalidade de aprofundamento invalida: ${argumentos.finalidade}.`);
  }
  const justificativa = String(argumentos.justificativa || '').trim();
  if (justificativa.length < 8 || justificativa.length > 300) {
    throw new Error('justificativa deve ter entre 8 e 300 caracteres.');
  }
  if (argumentos.camada === 'bronze' && argumentos.finalidade !== 'auditar') {
    throw new Error('Bronze so pode ser liberado com a finalidade auditar.');
  }
  return { ...argumentos, justificativa };
}

async function executarSolicitarAprofundamento(argumentos, dependencias = {}) {
  const solicitacao = validarSolicitacaoAprofundamento(argumentos);
  if (typeof dependencias.liberar !== 'function') {
    throw new Error('Aprofundamento dinamico nao foi configurado nesta execucao.');
  }
  return serializar(await dependencias.liberar(solicitacao));
}

module.exports = {
  CAMADAS,
  FINALIDADES,
  definicaoSolicitarAprofundamento,
  executarSolicitarAprofundamento,
  validarSolicitacaoAprofundamento
};
