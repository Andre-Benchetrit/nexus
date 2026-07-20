const test = require('node:test');
const assert = require('node:assert/strict');

const { executarAgente, lerArgumentos } = require('../agentes/consultor_nexus');

test('delega a execução para um provider com contrato comum', async () => {
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'Resposta do provider', provider: 'teste', modelo: 'mock' };
    }
  };
  const executarTool = async () => '{}';

  const resultado = await executarAgente('Quais dados temos?', {
    provider,
    executarTool
  });

  assert.equal(resultado.texto, 'Resposta do provider');
  assert.equal(contexto.pergunta, 'Quais dados temos?');
  assert.equal(contexto.tools[0].executar, executarTool);
  assert.deepEqual(
    contexto.tools.map((ferramenta) => ferramenta.definicao.name),
    ['consultar_bronze', 'agregar_bronze', 'consultar_silver', 'agregar_silver']
  );
});

test('lê provider e modelo pela linha de comando', () => {
  assert.deepEqual(
    lerArgumentos(['--provider', 'gemini', '--model', 'modelo-x', 'Quantos', 'clientes?']),
    {
      pergunta: 'Quantos clientes?',
      opcoes: { providerNome: 'gemini', modelo: 'modelo-x' }
    }
  );
});
