const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extrairToolNaoDisponivel,
  planejarRecuperacaoTool
} = require('../agentes/recuperacao_tools');
const { obterFerramentasDoPerfil } = require('../agentes/ferramentas');

test('extrai a tool ausente inclusive de erro encadeado', () => {
  const causa = new Error(
    "tool call validation failed: attempted to call tool " +
    "'analisar_influencias' which was not in request.tools"
  );
  const erro = new Error('fallback falhou', { cause: causa });

  assert.equal(extrairToolNaoDisponivel(erro), 'analisar_influencias');
});

test('recupera somente fachadas de negocio ainda nao oferecidas', () => {
  const erro = new Error(
    "attempted to call tool 'analisar_influencias' which was not in request.tools"
  );
  const atuais = obterFerramentasDoPerfil('catalogo');
  const plano = planejarRecuperacaoTool(erro, atuais);

  assert.equal(plano.nome, 'analisar_influencias');
  assert.equal(plano.perfil, 'influencias');
  assert.equal(plano.ferramenta.definicao.name, 'analisar_influencias');
  assert.equal(
    planejarRecuperacaoTool(
      new Error(
        "attempted to call tool 'consultar_bronze' which was not in request.tools"
      ),
      atuais
    ),
    null
  );
});
