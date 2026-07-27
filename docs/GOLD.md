# Camada Gold do Nexus

A Gold transforma fatos e dimensoes Silver em indicadores de negocio prontos.
Ela nao acessa o Bronze diretamente e nao depende de provider, prompt ou modelo
de linguagem.

## Definicoes oficiais iniciais

- **Pedido recebido**: documento PD no grao unico
  `(id_empresa, id_pedido_vda_importado)`, inclusive se depois for cancelado.
- **Pedido valido**: pedido que nao e cancelado nem orcamento.
- **Pedido cancelado**: tipo de pedido iniciado por `CANCELADO`.
- **Pedido pendente**: pedido valido que ainda nao possui faturamento fiscal valido.
- **Valor de pedidos**: `valor_total_venda`, analisado pela `data_pedido`.
- **Faturamento**: pela `data_emissao`, somente NF-e autorizada (`nfe_cstat = 100`),
  natureza 1, 2, 3 ou 19, sem devolucao (`DV`), tipo cancelado/ID 4 e sem
  identificador de pedido com sufixo reverso iniciado por `_`.
- **Valor de pedidos pagos**: pela `data_pedido`, documentos `PD` das naturezas
  permitidas e soma financeira dos itens (`quantidade * valor bruto + frete +
  acrescimos + outros - descontos`).
- **Ticket medio**: valor dividido pela quantidade dentro do mesmo universo.
- **Taxa de cancelamento**: pedidos cancelados divididos pelos pedidos recebidos.
- **Taxa de emissao**: pedidos validos com nota divididos pelos pedidos validos.
- **Cobertura de estoque**: estoque disponivel dividido pela media diaria de
  saidas de venda dos ultimos 90 dias.
- **Ruptura atual**: produto ativo e enviado ao site, com demanda recente e
  estoque disponivel menor ou igual a zero.

As formulas ficam nos modelos e na tool Gold. A IA escolhe a metrica e o periodo,
mas nao reescreve esses conceitos.

Pedido e nota nao sao mais contados a partir da mesma fato: indicadores de
pedido usam `fato_pedido`; faturamento usa `fato_nota_fiscal`; analises de
produto faturado usam `fato_nota_fiscal_item`. Essa separacao impede que um PD e
sua NF sejam contados como dois pedidos.

## Estados especiais

Uma devolucao e reconhecida quando existe um documento `DV` ligado ao mesmo
pedido de origem por `(id_empresa, id_pedido_vda_importado)`. Cancelamentos
fiscais e devolucoes ficam separados de simples cancelamentos comerciais.

Ainda existem pedidos cujo PD esta marcado como cancelado, mas que possuem NF
autorizada sem DV nem cancelamento fiscal localizado. Eles recebem
`FATURADO_COM_STATUS_CANCELADO` e entram em
`pedidos_status_conflitante`. A classificacao oficial desses casos permanece
pendente de decisao de negocio; a Gold nao os esconde nem corrige por suposicao.

## Objetos atuais

### `kpi_vendas_diario`

Uma linha por `data_pedido`. Contem pedidos recebidos, validos, cancelados,
pendentes, faturados, devolvidos, conflitos de status, valores, tickets e taxas.

### `kpi_faturamento_diario`

Uma linha por `data_emissao`, somente para notas emitidas. Contem quantidade de
notas, faturamento, ticket e prazo medio entre pedido e emissao.

### `kpi_pedidos_pagos_diario`

Uma linha por `data_pedido`, com quantidade, valor e ticket medio dos pedidos
pagos conforme a composicao financeira dos itens.

### `desempenho_produto_diario`

Uma linha por data de emissao, produto, plataforma e empresa. Contem quantidade
faturada, faturamento, custo atual do produto, margem bruta e comissao de
marketplace. Permite rankings por produto, marca, grupo, subgrupo, categoria e
plataforma.

O custo e o custo atual cadastrado no produto, nao um custo historico congelado
na data da venda. Por isso, a margem deve ser entendida como estimativa ate que
o custo historico seja disponibilizado.

### `kpi_plataforma_diario`

Uma linha por data do pedido e plataforma. Resume o funil correto de pedidos:
recebidos, validos, cancelados, pendentes, faturados, devolvidos e conflitos de
status, sem duplicar PD e nota fiscal.

### `kpi_frete_diario`

Uma linha por data do pedido, plataforma e regra de transporte. Contem frete
cobrado, frete informado no site, custo de frete e cobertura do custo.

Na carga atual, `valor_frete_custo` esta zerado na origem. Por isso,
`resultado_frete` permanece nulo e a tool emite um aviso, em vez de apresentar
lucro de frete incorreto.

### `kpi_estoque_diario`

Uma fotografia por dia dos produtos elegiveis para analise de estoque. Registra
ruptura atual, riscos critico, alto e medio, total em alerta ate 30 dias e a
marca com mais produtos em alerta. Se houver mais de uma construcao no mesmo
dia, o painel executivo utiliza a execucao mais recente.

### `painel_executivo_diario`

Combina os KPIs de vendas, faturamento, pedidos pagos e estoque por data. Tambem
acrescenta acumulados moveis de 7 e 30 dias, comparacao com o dia anterior e
sinalizacao de dado parcial. Datas anteriores a criacao do KPI de estoque ficam
sem valores de ruptura; o estado atual nunca e copiado para o passado.

### `risco_ruptura_produto`

Uma linha por produto ativo enviado ao site na empresa 10. Usa o saldo de
`produto_inventario.estoque` como estoque disponivel e as saidas `NF/D` do
`log_estoque` como demanda.

Classificacoes:

- `RUPTURA_ATUAL`: sem estoque e com demanda nos ultimos 90 dias;
- `CRITICO`: cobertura de ate 7 dias;
- `ALTO`: cobertura entre 8 e 15 dias;
- `MEDIO`: cobertura entre 16 e 30 dias;
- `SAUDAVEL`: cobertura acima de 30 dias;
- `SEM_ESTOQUE_SEM_GIRO`: sem estoque e sem demanda recente;
- `SEM_GIRO`: estoque positivo e sem demanda recente.

A data estimada de ruptura ainda nao considera compras ou reposicoes futuras.
Essa premissa fica gravada no proprio objeto e sera substituida quando a agenda
de compras do OneDrive entrar no Nexus.

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

# A fotografia diaria de estoque tambem pode ser construida isoladamente
npm run gold -- kpi_estoque_diario

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
- `pedidos_faturados`;
- `pedidos_devolvidos`;
- `pedidos_status_conflitante`;
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

Sem data explicita, `painel` usa o dia mais recente que tenha o conjunto
comercial completo. Tambem e possivel pedir explicitamente
`recencia=mais_recente` ou `recencia=mais_recente_completo`.

Na operacao `painel`, a resposta inclui ainda o resumo de estoque do dia:
quantidades em ruptura e risco, marca mais afetada e horario do saldo utilizado.
Esses campos nao sao somados em consultas de intervalo. A resposta tambem
explicita `estoque_atual` com sua propria data; assim, uma fonte de estoque mais
recente nao transforma vendas ainda nao carregadas em vendas zeradas.
Quando o provider enviar ao painel uma data posterior a cobertura comercial, a
tool utiliza a ultima data disponivel e devolve `ajuste_cobertura` com as duas
datas. O ajuste e explicito e se aplica somente a operacao `painel`.

O perfil `indicadores` usa apenas essa tool e permanece compacto. Listagens de
pedidos continuam no Silver, rankings de produtos permanecem na fato de itens e
auditorias continuam no Bronze.

## Tool `analisar_rupturas`

Resume as classificacoes, lista os produtos mais urgentes ou ranqueia as marcas
pela quantidade de produtos em alerta, incluindo as saidas dos ultimos 30 dias.
Todas as consultas usam a empresa 10.

## Outras tools Gold

- `analisar_desempenho`: resume ou ranqueia produto, marca, grupo, subgrupo,
  categoria e plataforma por quantidade, faturamento, custo, margem e comissao.
  Rankings possuem metrica de ordenacao explicita e filtros dimensionais.
- `analisar_operacao`: resume o funil de pedidos ou ranqueia plataformas sem
  misturar os graos de pedido e nota; aceita filtro por plataforma.
- `analisar_frete`: resume ou ranqueia frete por plataforma e regra de
  transporte, aceita esses mesmos filtros e sempre informa se o custo possui
  cobertura suficiente.

## Proximos modelos candidatos

1. perfil e recorrencia de cliente;
2. saude e qualidade do catalogo;
3. SLA de separacao, emissao e entrega;
4. compras e previsao de reposicao quando a agenda do OneDrive entrar;
5. custo e margem historicos, quando a origem correta for disponibilizada.
