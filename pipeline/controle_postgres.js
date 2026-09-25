const CHAVE_TRAVA_PIPELINE = 721_913_049;

function codigoSeguro(erro) {
  const valor = String(erro?.codigo || erro?.code || erro?.name || 'LAKE_PIPELINE_ERROR');
  return /^[A-Za-z0-9_-]{2,80}$/.test(valor) ? valor.toUpperCase() : 'LAKE_PIPELINE_ERROR';
}

function resumoPlano(plano = {}) {
  const etapas = {};
  for (const camada of ['bronze', 'silver', 'gold']) {
    etapas[camada] = (plano.etapas?.[camada] || []).map((item) => ({
      nome: String(item.nome || '').slice(0, 160),
      fonte: item.fonte ? String(item.fonte).slice(0, 80) : null,
      acao: item.acao ? String(item.acao).slice(0, 40) : null,
      inicio: item.inicio || null,
      fim: item.fim || null
    }));
  }
  return { modo: plano.modo || null, inicio: plano.inicio || null, fim: plano.fim || null, etapas };
}

function estadoDasLinhas(linhas) {
  const entidades = {};
  let atualizadoEm = null;
  for (const linha of linhas) {
    entidades[linha.entity_key] = {
      fim: linha.watermark_end ? new Date(linha.watermark_end).toISOString().slice(0, 10) : null,
      atualizadoEm: linha.updated_at ? new Date(linha.updated_at).toISOString() : null,
      execucao: linha.execution_id || null,
      ...(linha.metadata || {})
    };
    const data = entidades[linha.entity_key].atualizadoEm;
    if (data && (!atualizadoEm || data > atualizadoEm)) atualizadoEm = data;
  }
  return { versao: 2, atualizadoEm, entidades };
}

function criarControlePostgres(pool, opcoes = {}) {
  if (!pool?.query || !pool?.connect) throw new Error('Controle PostgreSQL do lake exige um pool.');
  const chaveTrava = Number(opcoes.chaveTrava || CHAVE_TRAVA_PIPELINE);

  async function lerEstado() {
    const resultado = await pool.query(`SELECT entity_key,source_key,watermark_end,execution_id,
      metadata,updated_at FROM nexus.lake_pipeline_state ORDER BY entity_key`);
    return estadoDasLinhas(resultado.rows);
  }

  async function salvarEstado(_raizLake, estado) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (const [chave, item] of Object.entries(estado?.entidades || {})) {
        const metadata = {};
        if (item.observacao) metadata.observacao = String(item.observacao).slice(0, 300);
        await cliente.query(`INSERT INTO nexus.lake_pipeline_state
          (entity_key,source_key,watermark_end,execution_id,metadata,updated_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,COALESCE($6::timestamptz,now()))
          ON CONFLICT (entity_key) DO UPDATE SET
            source_key=EXCLUDED.source_key,watermark_end=EXCLUDED.watermark_end,
            execution_id=EXCLUDED.execution_id,metadata=EXCLUDED.metadata,
            updated_at=EXCLUDED.updated_at`, [
          chave, item.fonte || null, item.fim || null, item.execucao || null,
          JSON.stringify(metadata), item.atualizadoEm || null
        ]);
      }
      await cliente.query('COMMIT');
    } catch (erro) {
      try { await cliente.query('ROLLBACK'); } catch (_) { /* preserva erro original */ }
      throw erro;
    } finally { cliente.release(); }
  }

  async function adquirirTrava(_raizLake, execucao) {
    const cliente = await pool.connect();
    try {
      const adquirida = (await cliente.query(
        'SELECT pg_try_advisory_lock($1) AS adquirida', [chaveTrava]
      )).rows[0]?.adquirida;
      if (!adquirida) {
        const atual = (await pool.query(`SELECT id,started_at FROM nexus.lake_pipeline_runs
          WHERE status='executando' ORDER BY started_at DESC LIMIT 1`)).rows[0];
        const erro = new Error(`Ja existe uma atualizacao em andamento desde ${
          atual?.started_at ? new Date(atual.started_at).toISOString() : 'horario desconhecido'
        } (execucao ${atual?.id || 'desconhecida'}).`);
        erro.codigo = 'LAKE_PIPELINE_LOCKED';
        throw erro;
      }
      // Se o advisory lock foi adquirido, nenhum outro Worker esta ativo.
      // Execucoes antigas ainda marcadas como "executando" pertencem a um
      // processo interrompido e nao podem permanecer assim indefinidamente.
      if (execucao?.id) {
        await cliente.query(`UPDATE nexus.lake_pipeline_runs
          SET status='erro',finished_at=COALESCE(finished_at,now()),
              duration_ms=COALESCE(duration_ms,
                GREATEST(0,(EXTRACT(EPOCH FROM (now()-started_at))*1000)::bigint)),
              error_code=COALESCE(error_code,'WORKER_INTERRUPTED'),updated_at=now()
          WHERE status='executando' AND id<>$1`, [execucao.id]);
      }
      return { cliente, chaveTrava, execucaoId: execucao?.id || null };
    } catch (erro) {
      cliente.release();
      throw erro;
    }
  }

  async function liberarTrava(trava) {
    if (!trava?.cliente) return;
    try { await trava.cliente.query('SELECT pg_advisory_unlock($1)', [trava.chaveTrava]); }
    finally { trava.cliente.release(); }
  }

  async function salvarExecucao(_raizLake, execucao) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`INSERT INTO nexus.lake_pipeline_runs
        (id,mode,status,scheduled_type,started_at,finished_at,duration_ms,plan_summary,
         failure_count,blocked_count,error_code,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,now())
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
          finished_at=EXCLUDED.finished_at,duration_ms=EXCLUDED.duration_ms,
          plan_summary=EXCLUDED.plan_summary,failure_count=EXCLUDED.failure_count,
          blocked_count=EXCLUDED.blocked_count,error_code=EXCLUDED.error_code,updated_at=now()`, [
        execucao.id, execucao.modo || 'manual', execucao.status,
        execucao.tipoAgendado || null, execucao.iniciadoEm,
        execucao.finalizadoEm || null, execucao.duracaoMs || null,
        JSON.stringify(resumoPlano(execucao.plano)), execucao.falhas?.length || 0,
        execucao.bloqueios?.length || 0, execucao.erro ? codigoSeguro(execucao.erro) : null
      ]);
      for (const etapa of execucao.etapas || []) {
        await cliente.query(`INSERT INTO nexus.lake_pipeline_stages
          (run_id,layer,object_key,source_key,action,status,started_at,finished_at,
           duration_ms,row_count,checksum,blocked_by,error_code,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,now())
          ON CONFLICT (run_id,layer,object_key) DO UPDATE SET
            status=EXCLUDED.status,finished_at=EXCLUDED.finished_at,
            duration_ms=EXCLUDED.duration_ms,row_count=EXCLUDED.row_count,
            checksum=EXCLUDED.checksum,blocked_by=EXCLUDED.blocked_by,
            error_code=EXCLUDED.error_code,updated_at=now()`, [
          execucao.id, etapa.camada, etapa.nome, etapa.fonte || null,
          etapa.acao || null, etapa.status, etapa.iniciadoEm || null,
          etapa.finalizadoEm || null, etapa.duracaoMs || null,
          etapa.totalLinhas ?? null, etapa.checksum || null,
          JSON.stringify((etapa.bloqueadaPor || []).map((item) => ({
            chave: String(item.chave || '').slice(0, 240), status: item.status || null
          }))), etapa.erro ? codigoSeguro(etapa.erro) : null
        ]);
      }
      await cliente.query('COMMIT');
      return execucao.id;
    } catch (erro) {
      try { await cliente.query('ROLLBACK'); } catch (_) { /* preserva erro original */ }
      throw erro;
    } finally { cliente.release(); }
  }

  async function lerUltimaExecucao() {
    const run = (await pool.query(`SELECT * FROM nexus.lake_pipeline_runs
      ORDER BY started_at DESC,id DESC LIMIT 1`)).rows[0];
    if (!run) return null;
    const etapas = (await pool.query(`SELECT * FROM nexus.lake_pipeline_stages
      WHERE run_id=$1 ORDER BY started_at NULLS FIRST,layer,object_key`, [run.id])).rows;
    return {
      id: run.id, modo: run.mode, tipoAgendado: run.scheduled_type,
      status: run.status, iniciadoEm: run.started_at,
      finalizadoEm: run.finished_at, duracaoMs: Number(run.duration_ms || 0) || null,
      erro: run.error_code ? { codigo: run.error_code } : null,
      etapas: etapas.map((item) => ({ camada: item.layer, nome: item.object_key,
        fonte: item.source_key, acao: item.action, status: item.status,
        iniciadoEm: item.started_at, finalizadoEm: item.finished_at,
        duracaoMs: Number(item.duration_ms || 0) || null,
        totalLinhas: Number(item.row_count || 0), checksum: item.checksum,
        bloqueadaPor: item.blocked_by, erro: item.error_code ? { codigo: item.error_code } : null }))
    };
  }

  return Object.freeze({ tipo: 'postgres', adquirirTrava, lerEstado, lerUltimaExecucao,
    liberarTrava, salvarEstado, salvarExecucao });
}

module.exports = { CHAVE_TRAVA_PIPELINE, criarControlePostgres, estadoDasLinhas, resumoPlano };
