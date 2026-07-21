const { OPERADORES_FILTRO } = require('./contratos');

function serializar(valor) {
  return JSON.stringify(valor, (_, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ));
}

function validarObjeto(argumentos) {
  if (!argumentos || typeof argumentos !== 'object' || Array.isArray(argumentos)) {
    throw new Error('Argumentos da tool devem ser um objeto.');
  }
}

function validarLista(valor, nome, minimo, maximo) {
  if (!Array.isArray(valor) || valor.length < minimo || valor.length > maximo) {
    throw new Error(`${nome} deve ter entre ${minimo} e ${maximo} itens.`);
  }
}

function validarLimite(valor, padrao, maximo) {
  const limite = valor ?? padrao;
  if (!Number.isInteger(limite) || limite < 1 || limite > maximo) {
    throw new Error(`limite deve ser um inteiro entre 1 e ${maximo}.`);
  }
  return limite;
}

function normalizarFiltros(filtros, permitidas, operadoresPermitidos = OPERADORES_FILTRO) {
  const resultado = {};
  for (const filtro of filtros || []) {
    if (!filtro || typeof filtro.campo !== 'string') {
      throw new Error('Cada filtro precisa de campo e valor.');
    }
    if (!permitidas.has(filtro.campo)) {
      throw new Error(`Campo não permitido para o agente: ${filtro.campo}`);
    }
    if (Object.hasOwn(resultado, filtro.campo)) {
      throw new Error(`Filtro duplicado: ${filtro.campo}`);
    }
    const operador = filtro.operador || 'igual';
    if (!operadoresPermitidos.includes(operador)) {
      throw new Error(`Operador de filtro inválido: ${operador}`);
    }
    if (['contem', 'comeca_com', 'termina_com'].includes(operador) && typeof filtro.valor !== 'string') {
      throw new Error(`O operador ${operador} exige um valor de texto.`);
    }
    if (operador === 'entre' && (
      filtro.valor == null || filtro.valor_final == null
    )) {
      throw new Error('O operador entre exige valor e valor_final.');
    }
    if (['em', 'nao_em'].includes(operador) && (
      !Array.isArray(filtro.valores) || filtro.valores.length < 1 || filtro.valores.length > 50
    )) {
      throw new Error(`O operador ${operador} exige entre 1 e 50 valores.`);
    }
    const normalizado = { operador, valor: filtro.valor };
    if (filtro.valor_final !== undefined) normalizado.valorFinal = filtro.valor_final;
    if (filtro.valores !== undefined) normalizado.valores = filtro.valores;
    resultado[filtro.campo] = normalizado;
  }
  return resultado;
}

module.exports = {
  normalizarFiltros,
  serializar,
  validarLimite,
  validarLista,
  validarObjeto
};
