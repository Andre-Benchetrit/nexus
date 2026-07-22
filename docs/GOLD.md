# Camada Gold do Nexus

A Gold transforma fatos e dimensoes Silver em indicadores de negocio prontos.
Ela nao acessa o Bronze diretamente e nao depende de provider, prompt ou modelo
de linguagem.

## Definicoes oficiais iniciais

- **Pedido recebido**: registro que nao e orcamento, inclusive se depois for cancelado.
- **Pedido valido**: pedido que nao e cancelado nem orcamento.
- **Pedido cancelado**: tipo de pedido iniciado por `CANCELADO`.
- **Pedido pendente**: pedido valido que ainda nao possui faturamento fiscal valido.
- **Valor de pedidos**: `valor_total_venda`, analisado pela `data_pedido`.
- **Faturamento**: pela `data_emissao`, somente NF-e autorizada (`nfe_cstat = 100`),
  natureza 1, 2, 3 ou 19, sem devolucao (`DV`), tipo cancelado/ID 4 ou pedido
  cujo identificador possua sufixo iniciado por `_`.
- **Valor de pedidos pagos**: pela `data_pedido`, documentos `PD` das naturezas
  permitidas e soma financeira dos itens (`quantidade * valor bruto + frete +
  acrescimos + outros - descontos`).
- **Ticket medio**: valor dividido pela quantidade dentro do mesmo universo.
- **Taxa de cancelamento**: pedidos cancelados divididos pelos pedidos recebidos.
- **Taxa de emissao**: pedidos validos com nota divididos pelos pedidos validos.

As formulas ficam nos modelos e na tool Gold. A IA escolhe a metrica e o periodo,
mas nao reescreve esses conceitos.

## Objetos atuais

### `kpi_vendas_diario`

Uma linha por `data_pedido`. Contem pedidos recebidos, validos, cancelados,
pendentes, valores, tickets e taxas.

### `kpi_faturamento_diario`

Uma linha por `data_emissao`, somente para notas emitidas. Contem quantidade de
notas, faturamento, ticket e prazo medio entre pedido e emissao.

### `kpi_pedidos_pagos_diario`

Uma linha por `data_pedido`, com quantidade, valor e ticket medio dos pedidos
pagos conforme a composicao financeira dos itens.

### `painel_executivo_diario`

Combina os dois KPIs por data e acrescenta acumulados moveis de 7 e 30 dias,
comparacao com o dia anterior e sinalizacao de dado parcial.

## Cobertura e qualidade

Cada construcao grava Parquet e `manifest.json` em:

```text
lake/gold/<objeto>/
  dt_processamento=AAAA-MM-DD/
    execucao=<timestamp>/
      dados.parquet
      manifest.json
```

O manifesto registra as execucoes Silver e Gold utilizadas, checksums, schema,
duplicidade de chaves e metricas de qualidade da origem. O ultimo dia disponivel
e marcado como parcial para impedir comparacoes silenciosamente enganosas.

Registros sem a data de negocio necessaria nao entram na serie temporal, mas sua
quantidade permanece no manifesto para auditoria. Inconsistencias da fonte nao
sao corrigidas silenciosamente na Gold.

## Construcao e consulta

```powershell
# Listar modelos
npm run gold -- --listar

# Construir tudo na ordem das dependencias
npm run gold -- --todos

# Construir um objeto e suas dependencias
npm run gold -- painel_executivo_diario

# Listar os objetos materializados
npm run consultar:gold -- --listar

# Ver o schema
npm run consultar:gold -- painel_executivo_diario --schema

# Ver os sete dias mais recentes
npm run consultar:gold -- painel_executivo_diario `
  --ordenar data_referencia --direcao desc --limite 7
```

## Tool `analisar_indicadores`

Operacoes:

- `painel`: fotografia executiva de um dia;
- `resumir`: consolida uma ou mais metricas no periodo;
- `comparar`: compara o periodo solicitado com o periodo imediatamente anterior
  de mesma duracao;
- `tendencia`: devolve a serie diaria das metricas.

Metricas iniciais:

- `pedidos_validos`;
- `pedidos_cancelados`;
- `pedidos_pendentes`;
- `valor_pedidos_validos`;
- `pedidos_pagos`;
- `valor_pedidos_pagos`;
- `ticket_medio_pedido`;
- `taxa_cancelamento_pct`;
- `taxa_emissao_pct`;
- `notas_emitidas`;
- `faturamento_emitido`;
- `ticket_medio_faturado`;
- `prazo_medio_emissao_dias`.

O perfil `indicadores` usa apenas essa tool e permanece compacto. Listagens de
pedidos continuam no Silver, rankings de produtos permanecem na fato de itens e
auditorias continuam no Bronze.

## Proximos modelos

Depois de validar os KPIs iniciais:

1. desempenho diario por plataforma, UF, tipo e transporte;
2. perfil de cliente;
3. saude do catalogo atual;
4. desempenho diario de produto, liberado historicamente depois do backfill dos itens.
