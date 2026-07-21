#!/usr/bin/env node

const { medirTodosPerfis } = require('../agentes/metricas_contexto');

console.table(medirTodosPerfis().map((item) => ({
  perfil: item.perfil,
  ferramentas: item.ferramentas.join(', '),
  caracteres: item.caracteresTotal,
  tokens_estimados: item.tokensEstimados
})));

console.log('\nEstimativa simples: 1 token ~= 4 caracteres. O valor real varia por provider.');
