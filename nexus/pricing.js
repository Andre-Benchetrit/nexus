const fs = require('node:fs');
const path = require('node:path');
const { comTransacao } = require('./db');

const METRICAS_PERMITIDAS = new Set([
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'requests'
]);

function dataIso(valor, campo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))) {
    throw new Error(`${campo} deve usar YYYY-MM-DD.`);
  }
  return valor;
}

function numeroNaoNegativo(valor, campo, positivo = false) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || (positivo && numero === 0)) {
    throw new Error(`${campo} deve ser um numero ${positivo ? 'positivo' : 'nao negativo'}.`);
  }
  return numero;
}

function dataBanco(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function lerManifesto(caminho = path.resolve(__dirname, '..', 'config', 'ai-pricing.json')) {
  const manifesto = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  if (!manifesto.version || typeof manifesto.version !== 'string') {
    throw new Error('O manifesto de precos exige version string.');
  }
  const pricingRates = (manifesto.pricingRates || []).map((item) => {
    for (const campo of ['provider', 'service', 'model', 'metric']) {
      if (!item[campo] || typeof item[campo] !== 'string') throw new Error(`Tarifa exige ${campo}.`);
    }
    if (!METRICAS_PERMITIDAS.has(item.metric)) throw new Error(`Metrica de preco invalida: ${item.metric}`);
    return {
      provider: item.provider.toLowerCase(), service: item.service,
      model: item.model, metric: item.metric,
      unitSize: numeroNaoNegativo(item.unitSize, 'unitSize', true),
      priceUsd: numeroNaoNegativo(item.priceUsd, 'priceUsd'),
      effectiveFrom: dataIso(item.effectiveFrom, 'effectiveFrom'),
      effectiveTo: item.effectiveTo ? dataIso(item.effectiveTo, 'effectiveTo') : null
    };
  });
  const exchangeRates = (manifesto.exchangeRates || []).map((item) => ({
    from: item.from || 'USD', to: item.to || 'BRL',
    competence: dataIso(item.competence, 'competence'),
    rate: numeroNaoNegativo(item.rate, 'rate', true),
    source: String(item.source || 'corporate')
  }));
  return { version: manifesto.version, pricingRates, exchangeRates };
}

async function importarManifesto(pool, manifesto) {
  return comTransacao(pool, async (cliente) => {
    let tarifas = 0;
    let cambios = 0;
    for (const item of manifesto.pricingRates) {
      const sobreposicao = (await cliente.query(`
        SELECT id, vigente_desde, vigente_ate FROM nexus.pricing_rates
        WHERE provider=$1 AND servico=$2 AND modelo=$3 AND metrica=$4
          AND daterange(vigente_desde, COALESCE(vigente_ate + 1, 'infinity'::date), '[)') &&
              daterange($5::date, COALESCE($6::date + 1, 'infinity'::date), '[)')
          AND vigente_desde <> $5::date
        LIMIT 1
      `, [item.provider, item.service, item.model, item.metric,
        item.effectiveFrom, item.effectiveTo])).rows[0];
      if (sobreposicao) throw new Error(`Vigencia sobreposta para ${item.provider}/${item.model}/${item.metric}.`);
      const existente = (await cliente.query(`
        SELECT pr.*, EXISTS(
          SELECT 1 FROM nexus.usage_line_items u WHERE u.pricing_rate_id=pr.id
        ) AS utilizada
        FROM nexus.pricing_rates pr
        WHERE provider=$1 AND servico=$2 AND modelo=$3 AND metrica=$4 AND vigente_desde=$5
      `, [item.provider, item.service, item.model, item.metric, item.effectiveFrom])).rows[0];
      const mudou = existente && (
        Number(existente.tamanho_unidade) !== item.unitSize ||
        Number(existente.preco_usd) !== item.priceUsd ||
        dataBanco(existente.vigente_ate) !== String(item.effectiveTo || '')
      );
      if (mudou && existente.utilizada) {
        throw new Error(`Tarifa ja utilizada nao pode ser alterada: ${item.provider}/${item.model}/${item.metric}.`);
      }
      await cliente.query(`
        INSERT INTO nexus.pricing_rates
          (provider, servico, modelo, metrica, tamanho_unidade, preco_usd,
           vigente_desde, vigente_ate, versao)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (provider, servico, modelo, metrica, vigente_desde)
        DO UPDATE SET tamanho_unidade=EXCLUDED.tamanho_unidade,
          preco_usd=EXCLUDED.preco_usd, vigente_ate=EXCLUDED.vigente_ate,
          versao=EXCLUDED.versao
      `, [item.provider, item.service, item.model, item.metric, item.unitSize,
        item.priceUsd, item.effectiveFrom, item.effectiveTo, manifesto.version]);
      tarifas += 1;
    }
    for (const item of manifesto.exchangeRates) {
      const existente = (await cliente.query(`
        SELECT er.*, EXISTS(
          SELECT 1 FROM nexus.usage_line_items u WHERE u.exchange_rate_id=er.id
        ) AS utilizada
        FROM nexus.exchange_rates er
        WHERE moeda_origem=$1 AND moeda_destino=$2 AND competencia=$3
      `, [item.from, item.to, item.competence])).rows[0];
      if (existente && Number(existente.taxa) !== item.rate && existente.utilizada) {
        throw new Error(`Cambio ja utilizado nao pode ser alterado: ${item.competence}.`);
      }
      await cliente.query(`
        INSERT INTO nexus.exchange_rates
          (moeda_origem, moeda_destino, competencia, taxa, origem, versao)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (moeda_origem, moeda_destino, competencia)
        DO UPDATE SET taxa=EXCLUDED.taxa, origem=EXCLUDED.origem, versao=EXCLUDED.versao
      `, [item.from, item.to, item.competence, item.rate, item.source, manifesto.version]);
      cambios += 1;
    }
    const competenciasSemCambio = (await cliente.query(`
      SELECT DISTINCT date_trunc('month', u.criado_em)::date AS competencia
      FROM nexus.usage_line_items u
      LEFT JOIN nexus.exchange_rates er
        ON er.moeda_origem='USD' AND er.moeda_destino='BRL'
       AND er.competencia=date_trunc('month',u.criado_em)::date
      WHERE er.id IS NULL
      ORDER BY competencia
    `)).rows;
    if (competenciasSemCambio.length) {
      throw new Error(`Cotacao USD/BRL ausente para: ${competenciasSemCambio
        .map((item) => dataBanco(item.competencia)).join(', ')}.`);
    }
    return { version: manifesto.version, tarifas, cambios };
  });
}

module.exports = { importarManifesto, lerManifesto };
