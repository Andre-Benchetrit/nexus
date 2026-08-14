const { randomUUID } = require('node:crypto');
const { normalizarTexto } = require('./roteador');

const MODOS_INTERACAO = Object.freeze(['legacy', 'v1']);
const ESTADOS_TAREFA = Object.freeze([
  'ativa', 'aguardando_usuario', 'pausada', 'concluida', 'cancelada', 'expirada'
]);
const STATUS_INTERACAO = Object.freeze([
  'pronto', 'precisa_esclarecimento', 'nao_suportado', 'cancelado', 'expirado'
]);
const MAX_PERGUNTAS_RODADA = 3;
const DIMENSOES_PRODUTO = Object.freeze([
  'id_produto', 'descricao_produto', 'sku', 'ean'
]);
const DIMENSOES_SUBSTITUIVEIS = new Set([
  'plataforma', 'marketplace_pedido', ...DIMENSOES_PRODUTO
]);

function pergunta(id, campo, texto, opcoes, motivo, prioridade) {
  return Object.freeze({
    id, campo, texto, tipo: opcoes?.length ? 'escolha' : 'texto',
    opcoes: opcoes || [], obrigatoria: true, motivo, prioridade
  });
}

const DEFINICAO_SQL = Object.freeze({
  tipo: 'construir_sql',
  executor: 'construir_sql',
  execucaoAutomatica: true,
  slots: Object.freeze({
    objetivo: { obrigatorio: true },
    entidade_principal: { obrigatorio: true },
    campos: { obrigatorio: false, padrao: [] },
    dimensoes: { obrigatorio: false, padrao: [] },
    metricas: { obrigatorio: false, padrao: [] },
    periodo: { obrigatorio: false },
    campo_temporal: { obrigatorioQuando: (slots) => slots.metricas?.includes('faturamento') },
    tratamento_canceladas: { obrigatorioQuando: (slots) => slots.metricas?.includes('faturamento') },
    filtros: { obrigatorio: false, padrao: [] },
    agrupamentos: { obrigatorio: false, padrao: [] },
    ordenacao: { obrigatorio: false, padrao: null },
    limite: { obrigatorio: false, padrao: 100 },
    regras: { obrigatorio: false, padrao: [] },
    restricoes_nao_interpretadas: { obrigatorio: false, padrao: [] },
    suposicoes: { obrigatorio: false, padrao: [] }
  })
});

const REGISTRO_INTERACOES = Object.freeze({
  construir_sql: DEFINICAO_SQL,
  esclarecimento_rota: Object.freeze({
    tipo: 'esclarecimento_rota', executor: null, execucaoAutomatica: false,
    slots: Object.freeze({ resposta: { obrigatorio: true } })
  }),
  selecionar_retomada: Object.freeze({
    tipo: 'selecionar_retomada', executor: null, execucaoAutomatica: false,
    slots: Object.freeze({ selecao: { obrigatorio: true } })
  })
});

function resolverModoInteracao(dependencias = {}) {
  const modo = String(
    dependencias.interactionMode || process.env.NEXUS_INTERACTION_MODE || 'v1'
  ).toLowerCase();
  if (!MODOS_INTERACAO.includes(modo)) {
    throw new Error(`Modo de interacao invalido: ${modo}. Use ${MODOS_INTERACAO.join(', ')}.`);
  }
  return modo;
}

function emitirEvento(onEvento, tipo, tarefa, extras = {}) {
  onEvento?.(`Interacao: ${JSON.stringify({
    evento: tipo,
    tarefaId: tarefa?.id || null,
    tipo: tarefa?.tipo || null,
    estado: tarefa?.estado || null,
    camposPendentes: tarefa?.camposPendentes || [],
    ...extras
  })}`);
}

function formatarDataIso(dia, mes, ano) {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function extrairPeriodo(texto, dataReferencia) {
  const normalizado = String(texto || '');
  const brasileiras = [...normalizado.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)];
  if (brasileiras.length >= 2) {
    return {
      inicio: formatarDataIso(brasileiras[0][1], brasileiras[0][2], brasileiras[0][3]),
      fim: formatarDataIso(brasileiras[1][1], brasileiras[1][2], brasileiras[1][3])
    };
  }
  const iso = [...normalizado.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((item) => item[1]);
  if (iso.length >= 2) return { inicio: iso[0], fim: iso[1] };
  if (/\bhoje\b/i.test(normalizado)) return { inicio: dataReferencia, fim: dataReferencia };
  return null;
}

function detectarPedidoSql(texto) {
  return /\b(sql|query|select)\b|(?:crie|gere|monte|construa).{0,25}(?:consulta|relatorio)/i.test(texto || '');
}

function entidadePeloTexto(texto) {
  const t = normalizarTexto(texto);
  if (/bloqueio/.test(t)) return 'nota_saida_bloqueada';
  if (/moviment/.test(t)) return 'log_estoque';
  if (/estoque|inventario/.test(t)) return 'produto_inventario';
  if (/produto|sku|ean|catalog/.test(t) && !/vend|fatur/.test(t)) return 'produto';
  if (/pessoa|funcionari|cliente|transportadora/.test(t) && !/vend|pedido/.test(t)) return 'cliente';
  if (/item/.test(t)) return 'nota_saida_itens';
  if (/pedido|venda|fatur|nota|marketplace|frete|operacao/.test(t)) return 'nota_saida';
  return null;
}

function extrairSlotsSql(texto, dataReferencia, existentes = {}) {
  const t = normalizarTexto(texto);
  const slots = structuredClone(existentes || {});
  const quantidadeRegrasAnterior = slots.regras?.length || 0;
  const quantidadeFiltrosAnterior = slots.filtros?.length || 0;
  const entidade = entidadePeloTexto(texto);
  if (entidade) slots.entidade_principal = entidade;
  if (/fatur/.test(t)) {
    slots.objetivo = 'agregar';
    slots.entidade_principal = 'nota_saida';
    slots.metricas = ['faturamento'];
  } else if (/quantos|quantidade|total/.test(t) && /pedido|nota/.test(t)) {
    slots.objetivo = 'agregar';
    slots.entidade_principal = 'nota_saida';
    slots.metricas = ['quantidade_pedidos'];
  } else if (/somar|agregar|agrup| por /.test(` ${t} `)) {
    slots.objetivo ||= 'agregar';
  } else if (/detalh/.test(t)) slots.objetivo = 'detalhar';
  else if (/list|mostr|select|consulta/.test(t)) slots.objetivo ||= 'listar';

  const dimensoes = new Set(slots.dimensoes || []);
  if (/por marketplace|por plataforma|\bplataforma\b/.test(t)) dimensoes.add('plataforma');
  if (/por marketplace[ _]pedido/.test(t)) {
    dimensoes.delete('plataforma');
    dimensoes.add('marketplace_pedido');
  }
  if (/por produto|por sku\b|por ean\b/.test(t)) {
    if (/por sku\b/.test(t)) dimensoes.add('sku');
    else if (/por ean\b/.test(t)) dimensoes.add('ean');
    else dimensoes.add('descricao_produto');
  }
  if (dimensoes.size) slots.dimensoes = [...dimensoes];

  const camposConhecidos = [
    'marketplace_pedido', 'id_nota_saida', 'nota_fiscal', 'data_pedido', 'data_emissao',
    'situacao', 'plataforma', 'cliente', 'tipo_pedido', 'id_produto', 'descricao_produto',
    'sku', 'ean', 'codigo_barra', 'codigo_fabricante', 'tipo_produto', 'volume',
    'estoque', 'qtde_reserva', 'bloqueio', 'descricao_bloqueio'
  ];
  const campos = new Set(slots.campos || []);
  for (const campo of camposConhecidos) {
    if (new RegExp(`\\b${campo.replace(/_/g, '[ _]')}\\b`).test(t)) campos.add(campo);
  }
  if (campos.size) slots.campos = [...campos];

  const consultaProduto = slots.entidade_principal === 'produto' || /\bprodutos?\b/.test(t);
  const regras = new Set(slots.regras || []);
  if (consultaProduto && /\bativ[oa]s?\b/.test(t)) regras.add('produto_ativo_vendavel');
  if (
    consultaProduto && /\bsku\b/.test(t) &&
    /\b(nao|sem|exclu|retir|ignor)\w*\b/.test(t) &&
    /(_out|sufix|termin|final|_[0-9]|_ ou)/.test(t)
  ) regras.add('sku_sem_sufixo_variacao');
  slots.regras = [...regras];

  if (
    consultaProduto && ['listar', 'detalhar'].includes(slots.objetivo) &&
    /\b(mostr|list|consult|select)\w*.{0,30}\bprodutos?\b/.test(t) &&
    !/\b(?:somente|apenas)\s+(?:o\s+)?(?:sku|ean|codigo)/.test(t)
  ) {
    slots.campos = [
      'codigo_barra', 'sku', 'codigo_fabricante', 'id_produto',
      'tipo_produto', 'descricao_produto', 'volume'
    ];
  }

  const periodo = extrairPeriodo(texto, dataReferencia);
  if (periodo) slots.periodo = periodo;
  if (/data.{0,8}emiss|emissao/.test(t)) slots.campo_temporal = 'data_emissao';
  else if (/data.{0,8}pedido/.test(t)) slots.campo_temporal = 'data_pedido';
  if (/exclu|sem cancel|nao incluir.{0,12}cancel/.test(t)) slots.tratamento_canceladas = 'excluir';
  else if (/inclu.{0,12}cancel|com cancel/.test(t)) slots.tratamento_canceladas = 'incluir';
  const temIndicadorRestricao = /\b(que|onde|cujo|sem|nao|somente|apenas|exceto|maior|menor|entre|termin)\b/.test(t);
  const reconheceuRestricao = slots.regras.length > quantidadeRegrasAnterior ||
    (slots.filtros?.length || 0) > quantidadeFiltrosAnterior ||
    Boolean(periodo) || /cancel/.test(t);
  if (/\b(?:ignore|remova|desconsidere).{0,20}\brestri/.test(t)) {
    slots.restricoes_nao_interpretadas = [];
  } else if (temIndicadorRestricao && !reconheceuRestricao) {
    slots.restricoes_nao_interpretadas = ['restricao_explicita_nao_mapeada'];
  } else if (temIndicadorRestricao && reconheceuRestricao) {
    slots.restricoes_nao_interpretadas = [];
  }
  return slots;
}

function camposPendentesSql(slots) {
  const pendentes = [];
  if (!slots.objetivo) pendentes.push('objetivo');
  if (!slots.entidade_principal) pendentes.push('entidade_principal');
  if (!(slots.campos?.length || slots.metricas?.length || slots.dimensoes?.length)) pendentes.push('campos');
  if (slots.metricas?.includes('faturamento')) {
    if (!slots.periodo) pendentes.push('periodo');
    if (!slots.campo_temporal) pendentes.push('campo_temporal');
    if (!slots.tratamento_canceladas) pendentes.push('tratamento_canceladas');
  }
  if (slots.restricoes_nao_interpretadas?.length) pendentes.push('restricoes');
  return pendentes;
}

function perguntasSql(pendentes) {
  const todas = {
    objetivo: pergunta('sql_objetivo', 'objetivo', 'Você quer listar linhas, detalhar registros ou agregar valores?', ['listar', 'detalhar', 'agregar'], 'Define o formato da consulta.', 10),
    entidade_principal: pergunta('sql_entidade', 'entidade_principal', 'Qual é a entidade principal: pedidos/notas, itens, produtos, estoque, movimentações, bloqueios ou pessoas?', [], 'Define a tabela base e os joins possíveis.', 20),
    campos: pergunta('sql_campos', 'campos', 'Quais campos ou métricas precisam aparecer no resultado?', [], 'Evita selecionar dados não solicitados.', 30),
    periodo: pergunta('sql_periodo', 'periodo', 'Qual período devo considerar? Informe início e fim.', [], 'Métricas de faturamento exigem período explícito.', 1),
    campo_temporal: pergunta('sql_data', 'campo_temporal', 'O período deve usar a data de emissão ou a data do pedido?', ['data_emissao', 'data_pedido'], 'A escolha altera quais registros entram.', 2),
    tratamento_canceladas: pergunta('sql_canceladas', 'tratamento_canceladas', 'As notas canceladas devem ser excluídas ou incluídas?', ['excluir', 'incluir'], 'Define se será faturamento oficial ou soma bruta.', 3),
    restricoes: pergunta('sql_restricoes', 'restricoes', 'Não consegui representar com segurança uma das restrições. Pode esclarecê-la ou pedir para removê-la?', [], 'Impede que uma condição explícita seja ignorada no SQL.', 4)
  };
  return pendentes.map((campo) => todas[campo]).filter(Boolean)
    .sort((a, b) => a.prioridade - b.prioridade)
    .slice(0, MAX_PERGUNTAS_RODADA);
}

function montarQuerySpec(slots) {
  const porProduto = (slots.dimensoes || []).some((item) => DIMENSOES_PRODUTO.includes(item));
  const metricas = (slots.metricas || []).map((item) => {
    if (item !== 'faturamento') return item;
    if (porProduto) {
      return slots.tratamento_canceladas === 'incluir'
        ? 'valor_total_itens'
        : 'faturamento_itens';
    }
    return slots.tratamento_canceladas === 'incluir' ? 'valor_total_notas' : item;
  });
  return {
    objetivo: slots.objetivo,
    entidade_principal: porProduto && slots.metricas?.includes('faturamento')
      ? 'nota_saida_itens'
      : slots.entidade_principal,
    campos: slots.campos || [],
    dimensoes: slots.dimensoes || [],
    metricas,
    periodo: slots.periodo ? { campo: slots.campo_temporal || 'data_emissao', ...slots.periodo } : null,
    filtros: slots.filtros || [],
    agrupamentos: slots.agrupamentos || [],
    ordenacao: slots.ordenacao || null,
    limite: slots.limite || 100,
    regras: slots.regras || [],
    suposicoes: slots.suposicoes || []
  };
}

function criarTarefaSqlComSlots(slots, contexto = {}) {
  const agora = new Date();
  const camposPendentes = camposPendentesSql(slots);
  return {
    id: randomUUID(), tipo: 'construir_sql',
    estado: camposPendentes.length ? 'aguardando_usuario' : 'ativa',
    slots, camposPendentes, perguntas: perguntasSql(camposPendentes),
    contexto: {
      origem: 'linguagem_natural', destino: 'postgresql_sysemp', ...contexto
    },
    criadaEm: agora.toISOString(), atualizadaEm: agora.toISOString(),
    expiraEm: new Date(agora.getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
}

function criarTarefaSql(texto, dataReferencia) {
  return criarTarefaSqlComSlots(extrairSlotsSql(texto, dataReferencia));
}

function pareceAlteracaoSqlAnterior(texto) {
  const t = normalizarTexto(texto);
  return (
    detectarPedidoSql(texto) &&
    /\b(mesm|igual|agora|troqu|alter|mantenh|no caso)\w*\b/.test(t)
  ) || /\b(?:agora|mas)\s+por\s+\w+/.test(t);
}

function criarTarefaSqlDerivada(anterior, texto, dataReferencia) {
  const t = normalizarTexto(texto);
  const slots = extrairSlotsSql(texto, dataReferencia, anterior.slots);
  let novaDimensao = null;
  if (/\bpor\s+(?:produto|item)\b/.test(t)) novaDimensao = 'descricao_produto';
  else if (/\bpor\s+sku\b/.test(t)) novaDimensao = 'sku';
  else if (/\bpor\s+ean\b|\bpor\s+codigo de barras\b/.test(t)) novaDimensao = 'ean';
  else if (/\bpor\s+marketplace[ _]pedido\b/.test(t)) novaDimensao = 'marketplace_pedido';
  else if (/\bpor\s+(?:marketplace|plataforma)\b/.test(t)) novaDimensao = 'plataforma';
  if (novaDimensao) {
    slots.dimensoes = [
      ...(slots.dimensoes || []).filter((item) => !DIMENSOES_SUBSTITUIVEIS.has(item)),
      novaDimensao
    ];
    slots.campos = (slots.campos || []).filter((item) => !DIMENSOES_SUBSTITUIVEIS.has(item));
  }
  if (slots.metricas?.includes('faturamento')) slots.entidade_principal = 'nota_saida';
  return criarTarefaSqlComSlots(slots, {
    origem: 'alteracao_tarefa_concluida', tarefaOrigem: anterior.id
  });
}

function formatarPerguntas(tarefa) {
  const perguntas = tarefa.perguntas || [];
  const linhas = perguntas.map((item, indice) => {
    const opcoes = item.opcoes?.length ? ` (${item.opcoes.join(' / ')})` : '';
    return perguntas.length === 1 ? `${item.texto}${opcoes}` : `${indice + 1}. ${item.texto}${opcoes}`;
  });
  return linhas.join('\n');
}

function pareceRespostaSql(texto, tarefa, dataReferencia) {
  const novos = extrairSlotsSql(texto, dataReferencia, tarefa.slots);
  return (tarefa.camposPendentes || []).some((campo) =>
    JSON.stringify(novos[campo]) !== JSON.stringify(tarefa.slots[campo]));
}

function pareceNovoAssunto(texto) {
  const t = normalizarTexto(texto);
  return /\b(estoque|pedido|venda|faturamento|produto|frete|funcionario|catalogo|bloqueio)\b/.test(t) &&
    !/\b(data|emissao|cancel|periodo|campo|metrica|listar|agregar|detalhar)\b/.test(t);
}

function criarResultadoPergunta(tarefa) {
  return {
    status: 'precisa_esclarecimento', acao: 'responder', tarefa,
    texto: formatarPerguntas(tarefa)
  };
}

async function processarMensagemInterativa(texto, opcoes = {}) {
  const { memoria, onEvento, dataReferencia } = opcoes;
  if (!memoria || resolverModoInteracao(opcoes) === 'legacy') return { acao: 'continuar', texto };
  const expiradas = await memoria.expirarTarefas?.() || [];
  expiradas.forEach((tarefa) => emitirEvento(onEvento, 'tarefa_expirada', tarefa));
  let ativa = await memoria.obterTarefaAtiva?.();
  const normalizado = normalizarTexto(texto);

  if (ativa && /^(?:por favor )?(?:cancele|cancelar|desisto|desistir|esqueca)(?: esta| essa| a)?(?: tarefa| sql| consulta)?[.! ]*$/.test(normalizado)) {
    ativa = await memoria.atualizarEstadoTarefa(ativa.id, 'cancelada');
    emitirEvento(onEvento, 'tarefa_cancelada', ativa);
    return { acao: 'responder', status: 'cancelado', tarefa: ativa, texto: 'Tarefa cancelada.' };
  }

  if (ativa?.tipo === 'esclarecimento_rota') {
    ativa.slots.resposta = texto;
    await memoria.salvarTarefa({ ...ativa, estado: 'concluida', camposPendentes: [], perguntas: [] }, { ativar: false });
    await memoria.atualizarEstadoTarefa(ativa.id, 'concluida');
    emitirEvento(onEvento, 'tarefa_concluida', ativa);
    return { acao: 'continuar', texto: `${ativa.contexto.perguntaOriginal} ${texto}`, tarefa: ativa };
  }

  if (ativa?.tipo === 'selecionar_retomada') {
    const numero = Number(String(texto).match(/\b(\d+)\b/)?.[1]);
    const candidato = ativa.contexto.candidatos?.[numero - 1];
    if (!candidato) return criarResultadoPergunta(ativa);
    await memoria.atualizarEstadoTarefa(ativa.id, 'concluida');
    const retomada = await memoria.retomarTarefa(candidato.id);
    emitirEvento(onEvento, 'tarefa_retomada', retomada);
    if (retomada.camposPendentes.length) return criarResultadoPergunta(retomada);
    return { acao: 'executar', status: 'pronto', tarefa: retomada, ferramenta: 'construir_sql', argumentos: montarQuerySpec(retomada.slots) };
  }

  if (ativa?.tipo === 'construir_sql') {
    if (detectarPedidoSql(texto) && !pareceRespostaSql(texto, ativa, dataReferencia)) {
      await memoria.atualizarEstadoTarefa(ativa.id, 'pausada');
      emitirEvento(onEvento, 'tarefa_pausada', ativa);
      ativa = null;
    } else if (pareceNovoAssunto(texto) && !pareceRespostaSql(texto, ativa, dataReferencia)) {
      await memoria.atualizarEstadoTarefa(ativa.id, 'pausada');
      emitirEvento(onEvento, 'tarefa_pausada', ativa);
      return { acao: 'continuar', texto };
    } else {
      ativa.slots = extrairSlotsSql(texto, dataReferencia, ativa.slots);
      ativa.camposPendentes = camposPendentesSql(ativa.slots);
      ativa.perguntas = perguntasSql(ativa.camposPendentes);
      ativa.estado = ativa.camposPendentes.length ? 'aguardando_usuario' : 'ativa';
      await memoria.salvarTarefa(ativa);
      if (ativa.camposPendentes.length) {
        emitirEvento(onEvento, 'esclarecimento_solicitado', ativa, { perguntas: ativa.perguntas.length });
        return criarResultadoPergunta(ativa);
      }
      emitirEvento(onEvento, 'tarefa_concluida', ativa);
      return { acao: 'executar', status: 'pronto', tarefa: ativa, ferramenta: 'construir_sql', argumentos: montarQuerySpec(ativa.slots) };
    }
  }

  if (/\b(retom|continu).{0,20}(sql|consulta|tarefa)\b/.test(normalizado)) {
    const pausadas = (await memoria.listarTarefas?.() || [])
      .filter((item) => item.estado === 'pausada' && item.tipo === 'construir_sql')
      .sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
    if (!pausadas.length) return { acao: 'responder', texto: 'Não há uma tarefa de SQL pausada nesta sessão.' };
    if (pausadas.length > 1) {
      const agora = new Date();
      const candidatos = pausadas.map((item) => ({
        id: item.id,
        rotulo: item.contexto?.perguntaOriginal || `SQL ${item.id.slice(0, 8)}`
      }));
      const selecao = {
        id: randomUUID(), tipo: 'selecionar_retomada', estado: 'aguardando_usuario',
        slots: {}, camposPendentes: ['selecao'], contexto: { candidatos },
        perguntas: [pergunta(
          'retomada_selecao', 'selecao', 'Qual tarefa você quer retomar?',
          candidatos.map((item, indice) => `${indice + 1} - ${item.rotulo}`),
          'Há mais de uma tarefa SQL pausada.', 1
        )],
        criadaEm: agora.toISOString(), atualizadaEm: agora.toISOString(),
        expiraEm: new Date(agora.getTime() + 24 * 60 * 60 * 1000).toISOString()
      };
      await memoria.salvarTarefa(selecao);
      emitirEvento(onEvento, 'esclarecimento_solicitado', selecao, { perguntas: 1 });
      return criarResultadoPergunta(selecao);
    }
    const retomada = await memoria.retomarTarefa(pausadas[0].id);
    emitirEvento(onEvento, 'tarefa_retomada', retomada);
    if (retomada.camposPendentes.length) return criarResultadoPergunta(retomada);
    return { acao: 'executar', status: 'pronto', tarefa: retomada, ferramenta: 'construir_sql', argumentos: montarQuerySpec(retomada.slots) };
  }

  if (/\b(revalid|validar novamente|tente validar)\b/.test(normalizado)) {
    const concluida = (await memoria.listarTarefas?.({ incluirFinalizadas: true }) || [])
      .filter((item) => item.tipo === 'construir_sql' && item.estado === 'concluida')
      .sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm))[0];
    if (concluida) return { acao: 'executar', status: 'pronto', tarefa: concluida, ferramenta: 'construir_sql', argumentos: montarQuerySpec(concluida.slots) };
  }

  if (pareceAlteracaoSqlAnterior(texto)) {
    const anterior = (await memoria.listarTarefas?.({ incluirFinalizadas: true }) || [])
      .filter((item) => item.tipo === 'construir_sql' && item.estado === 'concluida')
      .sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm))[0];
    if (anterior) {
      const tarefa = criarTarefaSqlDerivada(anterior, texto, dataReferencia);
      await memoria.salvarTarefa(tarefa);
      emitirEvento(onEvento, 'tarefa_criada', tarefa, { tarefaOrigem: anterior.id });
      if (tarefa.camposPendentes.length) {
        emitirEvento(onEvento, 'esclarecimento_solicitado', tarefa, { perguntas: tarefa.perguntas.length });
        return criarResultadoPergunta(tarefa);
      }
      emitirEvento(onEvento, 'tarefa_concluida', tarefa);
      return { acao: 'executar', status: 'pronto', tarefa, ferramenta: 'construir_sql', argumentos: montarQuerySpec(tarefa.slots) };
    }
  }

  if (detectarPedidoSql(texto)) {
    if (/onedrive|agendamento de compra|planilha/i.test(texto)) {
      return { acao: 'responder', status: 'nao_suportado', texto: 'Essa consulta depende de uma fonte externa ao PostgreSQL sysemp e ainda não possui receita SQL aprovada.' };
    }
    const tarefa = criarTarefaSql(texto, dataReferencia);
    await memoria.salvarTarefa(tarefa);
    emitirEvento(onEvento, 'tarefa_criada', tarefa);
    if (tarefa.camposPendentes.length) {
      emitirEvento(onEvento, 'esclarecimento_solicitado', tarefa, { perguntas: tarefa.perguntas.length });
      return criarResultadoPergunta(tarefa);
    }
    emitirEvento(onEvento, 'tarefa_concluida', tarefa);
    return { acao: 'executar', status: 'pronto', tarefa, ferramenta: 'construir_sql', argumentos: montarQuerySpec(tarefa.slots) };
  }
  return { acao: 'continuar', texto };
}

function registrarEsclarecimentoRota(memoria, { perguntaOriginal, perguntaEsclarecimento }, onEvento) {
  if (!memoria) return null;
  const agora = new Date();
  const tarefa = {
    id: randomUUID(), tipo: 'esclarecimento_rota', estado: 'aguardando_usuario',
    slots: {}, camposPendentes: ['resposta'],
    perguntas: [pergunta('rota_esclarecimento', 'resposta', perguntaEsclarecimento, [], 'A ambiguidade altera materialmente a rota.', 1)],
    contexto: { perguntaOriginal: String(perguntaOriginal).slice(0, 500) },
    criadaEm: agora.toISOString(), atualizadaEm: agora.toISOString(),
    expiraEm: new Date(agora.getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
  const persistencia = memoria.salvarTarefa(tarefa);
  if (persistencia && typeof persistencia.then === 'function') {
    return persistencia.then(() => {
      emitirEvento(onEvento, 'tarefa_criada', tarefa);
      return tarefa;
    });
  }
  emitirEvento(onEvento, 'tarefa_criada', tarefa);
  return tarefa;
}

module.exports = {
  ESTADOS_TAREFA,
  MAX_PERGUNTAS_RODADA,
  MODOS_INTERACAO,
  REGISTRO_INTERACOES,
  STATUS_INTERACAO,
  camposPendentesSql,
  criarTarefaSql,
  criarTarefaSqlDerivada,
  detectarPedidoSql,
  extrairPeriodo,
  extrairSlotsSql,
  formatarPerguntas,
  montarQuerySpec,
  processarMensagemInterativa,
  registrarEsclarecimentoRota,
  resolverModoInteracao
};
