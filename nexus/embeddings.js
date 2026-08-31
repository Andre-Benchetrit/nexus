const { createHash } = require('node:crypto');

const DIMENSOES = 384;

function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function embeddingHash(texto, dimensoes = DIMENSOES) {
  const vetor = new Float32Array(dimensoes);
  const tokens = normalizarTexto(texto).match(/[a-z0-9]{2,}/g) || [];
  for (const token of tokens) {
    for (const termo of [token, ...Array.from({ length: Math.max(0, token.length - 2) }, (_, i) => token.slice(i, i + 3))]) {
      const hash = createHash('sha256').update(termo).digest();
      const indice = hash.readUInt32LE(0) % dimensoes;
      vetor[indice] += (hash[4] & 1) ? 1 : -1;
    }
  }
  const norma = Math.sqrt(vetor.reduce((soma, valor) => soma + valor * valor, 0)) || 1;
  return Array.from(vetor, (valor) => valor / norma);
}

function criarHashEmbeddingProvider() {
  return Object.freeze({ nome: 'local_hash_384', dimensoes: DIMENSOES,
    async gerar(texto) { return embeddingHash(texto); } });
}

function criarE5EmbeddingProvider(opcoes = {}) {
  let extratorPromise;
  async function obterExtrator() {
    if (!extratorPromise) {
      extratorPromise = import('@huggingface/transformers').then(({ pipeline, env }) => {
        if (opcoes.cacheDir || process.env.NEXUS_EMBEDDING_CACHE_ROOT) {
          env.cacheDir = opcoes.cacheDir || process.env.NEXUS_EMBEDDING_CACHE_ROOT;
        }
        env.allowRemoteModels = String(process.env.NEXUS_EMBEDDING_ALLOW_DOWNLOAD || '0') === '1';
        return pipeline('feature-extraction', opcoes.model ||
          process.env.NEXUS_KNOWLEDGE_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small');
      });
    }
    return extratorPromise;
  }
  return Object.freeze({
    nome: 'multilingual_e5_small', dimensoes: DIMENSOES,
    async gerar(texto, tipo = 'passage') {
      const extrator = await obterExtrator();
      const saida = await extrator(`${tipo}: ${String(texto || '')}`, {
        pooling: 'mean', normalize: true
      });
      const vetor = Array.from(saida.data || []);
      if (vetor.length !== DIMENSOES) throw new Error(`Embedding E5 retornou ${vetor.length} dimensoes.`);
      return vetor;
    }
  });
}

function criarEmbeddingProvider(opcoes = {}) {
  if (opcoes.provider) return opcoes.provider;
  const modo = String(opcoes.modo || process.env.NEXUS_KNOWLEDGE_EMBEDDING_MODE || 'hash').toLowerCase();
  if (modo === 'off') return null;
  if (modo === 'hash') return criarHashEmbeddingProvider();
  if (modo === 'e5') return criarE5EmbeddingProvider(opcoes);
  throw new Error(`Modo de embedding documental invalido: ${modo}.`);
}

function serializarVetor(vetor) {
  if (!Array.isArray(vetor) || vetor.length !== DIMENSOES || vetor.some((item) => !Number.isFinite(item))) {
    throw new Error(`Embedding deve conter ${DIMENSOES} numeros finitos.`);
  }
  return `[${vetor.join(',')}]`;
}

module.exports = {
  DIMENSOES, criarE5EmbeddingProvider, criarEmbeddingProvider,
  criarHashEmbeddingProvider, embeddingHash, serializarVetor
};
