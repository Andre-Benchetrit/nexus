# Comandos do Nexus

Esta e a referencia central dos comandos disponiveis no projeto. Execute-os na
raiz do repositorio `nexus`.

## Instalacao e configuracao

```powershell
npm install
Copy-Item agentes/.env.example agentes/.env
```

Preencha `agentes/.env` com a chave do provider escolhido. Arquivos `.env` nao
devem ser versionados.

## Testes

```powershell
npm test
```

## Exportacao para o Bronze

```powershell
# Listar entidades cadastradas
npm run exportar -- --listar

# Simular uma entidade incremental sem gravar dados
npm run exportar -- nota_saida --inicio 2026-07-16 --fim 2026-07-17 --dry-run

# Exportar uma janela incremental; o fim e exclusivo
npm run exportar -- nota_saida --inicio 2026-07-16 --fim 2026-07-17

# Reprocessar intencionalmente uma janela ja exportada
npm run exportar -- nota_saida --inicio 2026-07-16 --fim 2026-07-17 --forcar

# Exportar uma entidade configurada como snapshot
npm run exportar -- grupo

# Exportar itens de venda de um dia (chave composta nota + item)
npm run exportar -- nota_saida_itens --inicio 2026-07-16 --fim 2026-07-17

# Exportar clientes novos ou alterados em uma janela
npm run exportar -- cliente --inicio 2026-07-20 --fim 2026-07-21

# Estoque atual: snapshot completo; a analise usa id_empresa 10
npm run exportar -- produto_inventario --forcar

# Movimentos de estoque; o fim e exclusivo
npm run exportar -- log_estoque --inicio 2026-07-23 --fim 2026-07-25
```

Entidades `incremental_data` exigem `--inicio` e `--fim`. Entidades `snapshot`
nao exigem intervalo.

`nota_saida_itens` usa `dthr_atualizacao` como cursor. Para uma carga historica,
prefira janelas mensais ou diarias em vez de uma unica consulta de varios anos.

`cliente`, `produto` e `nota_saida` consideram tanto `dt_alteracao` quanto
`dt_cadastro`. Isso captura registros novos cuja data de alteracao ainda e nula.

## Consulta direta ao Bronze

```powershell
npm run consultar -- --listar
npm run consultar -- produto --schema
npm run consultar -- cliente --contar
npm run consultar -- cliente --contar --visao historico
npm run consultar -- nota_saida --limite 10
npm run consultar -- cliente --id 123
npm run consultar -- nota_saida --colunas id_nota_saida,id_cliente,situacao --filtro situacao=B
npm run consultar -- nota_saida --filtro data_pedido=16/07/2026 --ordenar data_pedido --direcao desc --limite 10
npm run consultar -- produto --limite 50 --deslocamento 50
npm run consultar -- nota_saida_itens --contar
npm run consultar -- nota_saida_itens --colunas id_nota_saida,item,id_produto,qtde,valor_liquido --limite 10
```

A consulta de terminal nao aceita SQL livre. Os filtros usam `campo=valor` e as
colunas sao validadas contra o Parquet.

## Construcao do Silver

```powershell
npm run silver -- --listar
npm run silver -- --todos
npm run silver -- dim_produto
npm run silver -- fato_venda
npm run silver -- fato_venda_item
npm run silver -- fato_pedido
npm run silver -- fato_pedido_item
npm run silver -- fato_nota_fiscal
npm run silver -- fato_nota_fiscal_item
npm run silver -- fato_estoque_atual
npm run silver -- fato_movimento_estoque
npm run silver -- fato_agendamento_compra
```

Cada construcao cria um snapshot novo. A consulta atual usa a ultima execucao
com `manifest.json` de sucesso.

## Construcao da Gold

```powershell
npm run gold -- --listar
npm run gold -- --todos
npm run gold -- kpi_vendas_diario
npm run gold -- kpi_faturamento_diario
npm run gold -- kpi_estoque_diario
npm run gold -- desempenho_produto_diario
npm run gold -- kpi_plataforma_diario
npm run gold -- kpi_frete_diario
npm run gold -- painel_executivo_diario
npm run gold -- risco_ruptura_produto
```

Ao construir um objeto Gold, suas dependencias Gold sao processadas primeiro.
As fontes sao sempre objetos Silver materializados e aprovados.

## Consulta direta a Gold

```powershell
npm run consultar:gold -- --listar
npm run consultar:gold -- painel_executivo_diario --schema
npm run consultar:gold -- painel_executivo_diario --contar
npm run consultar:gold -- painel_executivo_diario --ordenar data_referencia --direcao desc --limite 7
npm run consultar:gold -- kpi_vendas_diario --filtro data_referencia=2026-07-17
npm run consultar:gold -- kpi_faturamento_diario --filtro data_referencia=2026-07-17
npm run consultar:gold -- desempenho_produto_diario --filtro data_referencia=2026-07-17 --limite 20
npm run consultar:gold -- kpi_plataforma_diario --filtro data_referencia=2026-07-17 --limite 20
npm run consultar:gold -- kpi_frete_diario --filtro data_referencia=2026-07-17 --limite 20
npm run consultar:gold -- risco_ruptura_produto --filtro classificacao_risco=RUPTURA_ATUAL --limite 20
npm run consultar:gold -- risco_ruptura_produto --filtro tem_reposicao_prevista=true --limite 20
npm run consultar:gold -- kpi_estoque_diario --ordenar data_referencia --direcao desc --limite 7
```

O ultimo dia disponivel e marcado com `dados_parciais=true`. Consulte
[`GOLD.md`](GOLD.md) para as definicoes oficiais das metricas.

## Consulta direta ao Silver

```powershell
npm run consultar:silver -- --listar
npm run consultar:silver -- dim_funcionario --contar
npm run consultar:silver -- dim_funcionario --colunas id_funcionario,funcionario,id_empresa,funcionario_ativo --limite 20
npm run consultar:silver -- dim_transportadora --contar
npm run consultar:silver -- dim_transportadora --colunas id_transportadora,transportadora,id_empresa,transportadora_ativa --limite 20
npm run consultar:silver -- dim_produto --schema
npm run consultar:silver -- dim_produto --contar
npm run consultar:silver -- dim_produto --contar --filtro produto_ativo=true
npm run consultar:silver -- dim_produto --contar --filtro catalogo_site_ativo=true
npm run consultar:silver -- dim_produto --filtro grupo=ELETRODOMESTICO --colunas id_produto,descricao_produto,grupo,subgrupo,marca --limite 10
npm run consultar:silver -- dim_produto --ordenar descricao_produto --direcao asc --limite 50 --deslocamento 50
npm run consultar:silver -- dim_produto --visao historico --limite 10
npm run consultar:silver -- fato_venda --contar
npm run consultar:silver -- fato_venda --colunas id_nota_saida,data_pedido,cliente,tipo_pedido,plataforma,transporte_regras,valor_total_venda --limite 10
npm run consultar:silver -- fato_venda_item --contar
npm run consultar:silver -- fato_venda_item --colunas id_nota_saida,item,data_pedido,descricao_produto,marca,cliente,plataforma,transporte_regras,quantidade,valor_total_item --limite 10
npm run consultar:silver -- fato_pedido --colunas marketplace_pedido,data_pedido,status_pedido,plataforma,transporte_regra,valor_total_venda --limite 10
npm run consultar:silver -- fato_nota_fiscal --colunas id_nr_nf,marketplace_pedido,data_emissao,valor_total_venda --limite 10
npm run consultar:silver -- fato_pedido_item --colunas marketplace_pedido,data_pedido,descricao_produto,quantidade,valor_total_item --limite 10
npm run consultar:silver -- fato_nota_fiscal_item --colunas id_nr_nf,data_emissao,descricao_produto,marca,quantidade,valor_total_item --limite 10
```

Na visao historica, a mesma chave pode aparecer em mais de um snapshot Silver.

## Agregacao direta ao Silver

```powershell
# Quantidade por grupo
npm run agregar:silver -- dim_produto --agrupar grupo --contar --limite 10

# Composicao do catalogo atual
npm run agregar:silver -- dim_produto --agrupar grupo --contar --filtro produto_ativo=true --limite 10

# Catalogo do site por grupo e subgrupo
npm run agregar:silver -- dim_produto --agrupar grupo,subgrupo --contar --filtro catalogo_site_ativo=true --limite 20

# Estoque por grupo; o saldo atual fica na fato de estoque
npm run agregar:silver -- fato_estoque_atual --agrupar grupo --somar estoque_disponivel --limite 10

# Mais de um calculo
npm run agregar:silver -- fato_estoque_atual --agrupar grupo --contar --somar estoque_disponivel --limite 10
npm run agregar:silver -- fato_agendamento_compra --agrupar descricao_produto --somar quantidade_pendente --filtro data_prevista=2026-07-30 --limite 10

# Quantidade de pedidos por plataforma; fato_pedido tem uma linha por pedido
npm run agregar:silver -- fato_pedido --agrupar plataforma --contar --limite 10

# Quantidade de pedidos por conjunto de regras de transporte
npm run agregar:silver -- fato_pedido --agrupar transporte_regra --contar --limite 10

# Produtos faturados por grupo
npm run agregar:silver -- fato_nota_fiscal_item --agrupar grupo --contar --somar valor_total_item --limite 10
```

Calculos disponiveis: `--contar`, `--somar`, `--media`, `--minimo` e `--maximo`.

## Agente Nexus

```powershell
# Provider configurado no .env
npm run agente:nexus -- "Quais tipos de produto predominam no catalogo atual?"

# Gemini escolhido pela linha de comando
npm run agente:nexus -- --provider gemini --model gemini-3.1-flash-lite "Quais tipos de produto predominam no catalogo atual?"

# Groq
npm run agente:nexus -- --provider groq --model llama-3.3-70b-versatile "Quantos clientes temos?"

# OpenAI
npm run agente:nexus -- --provider openai "Quantos clientes temos?"

# Gemini com fallback Groq definido pela linha de comando
npm run agente:nexus -- --provider gemini --fallback-provider groq "Quantos clientes temos?"

# Desativa o fallback somente nesta execucao
npm run agente:nexus -- --provider gemini --no-fallback "Quantos clientes temos?"

# Rupturas e cobertura de estoque
npm run agente:nexus -- "Quais produtos estão em ruptura atual?"
npm run agente:nexus -- "Quais produtos têm cobertura crítica e quando devem acabar?"
npm run agente:nexus -- "Quais marcas têm mais produtos em ruptura ou risco de ruptura?"

# Desempenho e margem estimada do faturamento
npm run agente:nexus -- "Quais marcas mais faturaram em 17/07/2026 e qual foi a margem bruta estimada?"

# Funil operacional por plataforma
npm run agente:nexus -- "Quais plataformas tiveram mais pedidos cancelados no mes?"

# Frete; a resposta avisa quando o custo nao tem cobertura
npm run agente:nexus -- "Quanto cobramos de frete em julho e quais plataformas concentraram esse valor?"
```

O agente seleciona automaticamente um perfil compacto de tools. Para forcar um
perfil durante diagnostico:

```powershell
npm run agente:nexus -- --perfil vendas "Qual marca mais vendeu hoje?"
npm run agente:nexus -- --perfil desempenho "Qual produto teve maior margem no mes?"
npm run agente:nexus -- --perfil operacao "Qual plataforma teve mais cancelamentos?"
npm run agente:nexus -- --perfil frete "Quanto cobramos de frete hoje?"
npm run agente:nexus -- --perfil indicadores "Compare o faturamento deste mes com o anterior"
npm run agente:nexus -- --perfil estoque "Quais produtos podem acabar nos proximos 15 dias?"
npm run agente:nexus -- --perfil produto "Resolva este EAN para o SKU do produto"
npm run agente:nexus -- --perfil catalogo "Quais grupos predominam no catalogo?"
npm run agente:nexus -- --perfil pessoas "Quais transportadoras estao ativas?"
npm run agente:nexus -- --perfil hibrido "Como estamos?"
npm run agente:nexus -- --perfil gold "Quais indicadores Gold estao disponiveis?"
npm run agente:nexus -- --perfil silver "Quantos clientes existem?"
npm run agente:nexus -- --perfil bronze "Liste os dados brutos disponiveis"
npm run agente:nexus -- --perfil completo "Quais dados temos?"
```

Perfis disponiveis: `automatico`, `indicadores`, `influencias`, `desempenho`,
`operacao`, `frete`, `estoque`, `estoque_reposicoes`, `reposicoes`, `produto`, `vendas`,
`catalogo`, `pessoas`, `negocio`, `hibrido`, `silver`, `bronze` e `completo`.

A lista completa das tools e de seus perfis esta em [`TOOLS.md`](TOOLS.md).

Datas informadas apenas como `DD/MM` recebem automaticamente o ano da data de
referencia da FID (`America/Sao_Paulo`). Em rankings de transportadora, a tool
agrupa por `id_transportadora` e exclui registros sem transportadora informada.
"Hoje" usa literalmente a data nesse fuso. Se ainda nao houver Gold para ela, o
agente informa indisponibilidade em vez de trocar silenciosamente pela ultima
data carregada.
Timestamps de atualizacao e processamento permanecem UTC no armazenamento, mas
as tools e respostas os apresentam no horario de Sao Paulo.

Para medir o contexto fixo sem consumir API:

```powershell
npm run agente:contexto
```

O roteador semantico pode usar provider e modelo diferentes do modelo principal:

```powershell
npm run agente:nexus -- --router-mode shadow --router-provider openai --router-model gpt-5.6-luna "Como estamos?"
npm run agente:nexus -- --router-mode v2 --sessao financeiro "E no periodo anterior?"
```

Configuracao equivalente:

```text
NEXUS_ROUTER_MODE=shadow
NEXUS_ROUTER_PROVIDER=openai
NEXUS_ROUTER_MODEL=gpt-5.6-luna
NEXUS_MAX_RODADAS=10
NEXUS_SESSION_HISTORY_LIMIT=10
```

`legacy` usa apenas as regras anteriores; `shadow` compara sem alterar a resposta;
`v2` executa o plano semantico validado. `--perfil` continua tendo precedencia.
O teto de seguranca tambem pode ser ajustado por `--max-rodadas` entre 1 e 20.

O comando antigo continua como alias compativel:

```powershell
npm run agente:bronze -- --provider gemini --model gemini-3.1-flash-lite "Quantos clientes temos?"
```

Para perguntas comuns, o agente envia somente a fachada de negocio reconhecida.
Perguntas automaticas recebem as fachadas do perfil e o gateway compacto
`solicitar_aprofundamento`. Ele pode liberar uma unica camada tecnica na mesma
execucao sem carregar previamente todos os schemas. Gold e Silver servem para
complemento; Bronze somente para auditoria, historico ou divergencia. Os perfis
`gold`, `silver`, `bronze` e `completo` continuam disponiveis para diagnostico.

Para localizar notas de varios pedidos marketplace, cole os identificadores como
texto. O resultado informa as NFs, os pedidos ausentes, os encontrados sem NF e
eventuais duplicatas da solicitacao:

```powershell
npm run agente:nexus -- "Me de as notas fiscais, separadas por espaco, dos marketplace_pedido 701-0572805-3561041, 702-4782159-6150621 e informe quais pedidos nao encontrou."
```

Configuracao recomendada em `agentes/.env`:

```text
LLM_PROVIDER=gemini
LLM_FALLBACK_PROVIDER=groq
LLM_RETRY_ATTEMPTS=1
LLM_RETRY_DELAY_MS=500
LLM_REQUEST_TIMEOUT_MS=20000

NEXUS_ROUTER_MODE=shadow
# NEXUS_ROUTER_PROVIDER=openai
# NEXUS_ROUTER_MODEL=gpt-5.6-luna
NEXUS_MAX_RODADAS=10
NEXUS_SESSION_HISTORY_LIMIT=10

GEMINI_API_KEY=sua_chave_gemini
GEMINI_MODEL=gemini-3.1-flash-lite

GROQ_API_KEY=sua_chave_groq
GROQ_MODEL=llama-3.3-70b-versatile
```

Em erro de quota (`429`), o agente troca direto para o fallback. Em `503` ou
timeout, ele repete uma vez e depois troca. Erros de chave, configuracao ou
validacao nao usam fallback. Quando houver troca, o terminal mostra qual provider
gerou a resposta.

Durante a execucao, o terminal informa a rodada do provider e o tempo de cada
tool. O timeout padrao por chamada e de 20 segundos e pode ser alterado somente
para uma execucao com `--timeout` (em milissegundos):

```powershell
npm run agente:nexus -- --timeout 30000 "Quantos clientes temos?"
```

Para diagnosticar filtros e argumentos escolhidos pelo provider:

```powershell
npm run agente:nexus -- --provider groq --debug-tools "Qual foi o faturamento de hoje?"
```

O modo de diagnostico exibe argumentos estruturados das tools; ele nao mostra
SQL nem credenciais.

## Memoria e bateria permanente

O agente guarda as tres ultimas interacoes resumidas por sessao:

```powershell
npm run agente:nexus -- --sessao financeiro "Qual foi o faturamento de julho?"
npm run agente:nexus -- --sessao financeiro "E no periodo anterior?"
npm run agente:memoria -- --sessao financeiro --listar-curta
npm run agente:memoria -- --sessao financeiro --limpar-curta
```

Gerencie correcoes revisadas da memoria longa:

```powershell
npm run agente:memoria -- --listar
npm run agente:memoria -- --lembrar "Numero do pedido significa marketplace_pedido." --categoria vocabulario --gatilhos "numero do pedido,marketplace_pedido"
npm run agente:memoria -- --esquecer id-do-aprendizado
```

Valide a bateria sem API ou execute uma amostra real no Groq:

```powershell
npm run avaliar:agente
npm run avaliar:agente -- --executar --provider groq --limite 5
```

Consulte [`MEMORIA_E_AVALIACAO.md`](MEMORIA_E_AVALIACAO.md) para o contrato de
seguranca, sessoes e manutencao dos casos.

## OneDrive corporativo

```powershell
# Conferir configuracao sem revelar segredos
npm run onedrive:status

# Testar uma conexao configurada
npm run onedrive:status -- --conexao automacoes_onedrive --testar

# Descobrir drive da conta corporativa de automacoes
npm run onedrive:descobrir -- --conexao automacoes_onedrive

# Listar ou buscar arquivos
npm run onedrive:listar -- --conexao automacoes_onedrive
npm run onedrive:buscar -- --conexao automacoes_onedrive --termo "Agendamento"

# Sincronizar a fonte inicial depois de configurar o item
npm run onedrive:sincronizar
npm run silver -- fato_agendamento_compra
npm run gold -- risco_ruptura_produto
```

As permissoes, variaveis e fluxo completo estao em
[`docs/ONEDRIVE.md`](ONEDRIVE.md).

## Thorpe

Configure `THORPE_BASE_URL`, `THORPE_API_TOKEN`, `THORPE_USER` e
`THORPE_PASSWORD` no `.env` da raiz. O mesmo `api-token` e usado para emitir o
JWT e acompanha o JWT na consulta de estoque. Teste um SKU (`codigo_auxiliar`) sem
alterar dados no Thorpe:

```powershell
npm run thorpe:testar -- CODIGO_AUXILIAR
```

O comando autentica em `/v2/token`, consulta
`/v2/estoque/{sku}/lote` e exibe somente `disponivel`, `pulmao`, a soma
utilizavel, quantidade de lotes e horario da consulta. Tokens e credenciais
nao sao impressos.

## Atualizacao automatizada do lake

Revise o plano sem acessar as fontes nem alterar o lake:

```powershell
npm run lake:plano
```

Execute Bronze, Silver e Gold usando somente dias completos:

```powershell
npm run lake:atualizar
```

Quando precisar consultar dados do dia ainda em andamento, use a carga
intradiaria com sobreposicao. Ela nao avanca o cursor oficial:

```powershell
npm run lake:atualizar -- --incluir-hoje
```

Consulte o estado e a ultima execucao:

```powershell
npm run lake:status
```

O status pode ser `sucesso`, `parcial` ou `erro`. Em uma execucao parcial, os
ramos independentes sao publicados, as dependencias afetadas aparecem como
`bloqueadas` e o comando retorna codigo `2` para alertar a automacao.

Tambem e possivel limitar uma execucao:

```powershell
npm run lake:atualizar -- --camadas bronze --entidades nota_saida,nota_saida_itens
npm run lake:atualizar -- --camadas silver,gold --silver fato_venda,fato_venda_item
```

A arquitetura, primeira carga, recuperacao de falhas e instalacao opcional da
tarefa diaria do Windows estao em [`AUTOMACAO.md`](AUTOMACAO.md).

## Git e GitLab

```powershell
git status
git diff --check
git add .
git commit -m "feat: adiciona camada silver de produtos"
git push
```

Antes de adicionar arquivos, confirme que `.env`, `lake/`, `node_modules/` e
arquivos locais nao aparecem em `git status`.
