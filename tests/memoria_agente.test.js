const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { executarAgente } = require('../agentes/consultor_nexus');
const {
  criarMemoria,
  extrairReferenciasTemporais,
  pareceContinuacao
} = require('../agentes/memoria');

function criarMemoriaTemporaria(t) {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memoria-'));
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));
  return criarMemoria({
    sessao: 'teste',
    caminhoCurta: path.join(diretorio, 'curta.json'),
    caminhoLonga: path.join(diretorio, 'longa.json')
  });
}

test('memoria curta preserva somente as tres ultimas interacoes resumidas', (t) => {
  const memoria = criarMemoriaTemporaria(t);
  for (let indice = 1; indice <= 4; indice += 1) {
    memoria.registrarInteracao({
      pergunta: `Pergunta ${indice}`,
      resposta: `Resposta ${indice}`,
      provider: 'teste',
      modelo: 'mock'
    });
  }

  const historico = memoria.listarCurta();
  assert.equal(historico.length, 3);
  assert.equal(historico[0].pergunta, 'Pergunta 2');
  assert.equal(historico[2].resposta, 'Resposta 4');
});

test('memoria longa recupera apenas aprendizados relacionados ao contexto', (t) => {
  const memoria = criarMemoriaTemporaria(t);
  memoria.adicionarConhecimento({
    conteudo: 'Numero do pedido significa marketplace_pedido.',
    categoria: 'vocabulario',
    gatilhos: ['numero do pedido']
  });
  memoria.adicionarConhecimento({
    conteudo: 'Estoque usa a empresa 10.',
    categoria: 'estoque',
    gatilhos: ['ruptura']
  });

  const encontrados = memoria.buscarLonga('Qual e o numero do pedido?');
  assert.deepEqual(encontrados.map(({ categoria }) => categoria), ['vocabulario']);
});

test('agente recebe contexto anterior e registra a resposta nova', async (t) => {
  const memoria = criarMemoriaTemporaria(t);
  memoria.registrarInteracao({
    pergunta: 'Qual foi o faturamento de julho?',
    resposta: 'O faturamento foi consultado.',
    provider: 'teste',
    modelo: 'mock'
  });
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'Resposta contextual', provider: 'teste', modelo: 'mock' };
    }
  };

  await executarAgente('E no periodo anterior?', { provider, memoria });

  assert.match(contexto.instrucoes, /Qual foi o faturamento de julho/);
  assert.equal(memoria.listarCurta().at(-1).resposta, 'Resposta contextual');
  assert.equal(pareceContinuacao('E no periodo anterior?'), true);
});

test('extrai a ultima data completa da resposta para continuidade temporal', () => {
  assert.deepEqual(
    extrairReferenciasTemporais(
      'A cobertura e parcial, pois a ultima data completa e 2026-07-21.'
    ),
    { ultimaDataCompleta: '2026-07-21' }
  );
});

test('mesma cobertura herda indicadores e recebe o dia de corte anterior', async (t) => {
  const memoria = criarMemoriaTemporaria(t);
  memoria.registrarInteracao({
    pergunta: 'Qual foi o faturamento de julho de 2026?',
    resposta: 'A ultima data completa e 2026-07-21.',
    provider: 'teste',
    modelo: 'mock',
    perfil: 'indicadores'
  });
  let contexto;
  const provider = {
    async executar(valor) {
      contexto = valor;
      return { texto: 'Faturamento consultado.', provider: 'teste', modelo: 'mock' };
    }
  };

  await executarAgente('E de junho, se pegarmos a mesma cobertura?', {
    provider,
    memoria
  });

  assert.deepEqual(
    contexto.tools.map(({ definicao }) => definicao.name),
    ['analisar_indicadores', 'solicitar_aprofundamento']
  );
  assert.match(contexto.instrucoes, /2026-07-21/);
  assert.equal(memoria.listarCurta().at(-1).perfil, 'indicadores');
});
