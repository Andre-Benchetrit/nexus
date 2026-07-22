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
```

Cada construcao cria um snapshot novo. A consulta atual usa a ultima execucao
com `manifest.json` de sucesso.

## Construcao da Gold

```powershell
npm run gold -- --listar
npm run gold -- --todos
npm run gold -- kpi_vendas_diario
npm run gold -- kpi_faturamento_diario
npm run gold -- painel_executivo_diario
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
```

O ultimo dia disponivel e marcado com `dados_parciais=true`. Consulte
[`GOLD.md`](GOLD.md) para as definicoes oficiais das metricas.

## Consulta direta ao Silver

```powershell
npm run consultar:silver -- --listar
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

# Estoque por grupo
npm run agregar:silver -- dim_produto --agrupar grupo --somar estoque --limite 10

# Mais de um calculo
npm run agregar:silver -- dim_produto --agrupar grupo --contar --somar estoque --limite 10

# Quantidade de pedidos por plataforma; fato_venda tem uma linha por pedido
npm run agregar:silver -- fato_venda --agrupar plataforma --contar --limite 10

# Quantidade de pedidos por conjunto de regras de transporte
npm run agregar:silver -- fato_venda --agrupar transporte_regras --contar --limite 10

# Vendas por grupo de produto; fato_venda_item tem uma linha por item
npm run agregar:silver -- fato_venda_item --agrupar grupo --contar --somar valor_total_item --limite 10
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
```

O agente seleciona automaticamente um perfil compacto de tools. Para forcar um
perfil durante diagnostico:

```powershell
npm run agente:nexus -- --perfil vendas "Qual marca mais vendeu hoje?"
npm run agente:nexus -- --perfil indicadores "Compare o faturamento deste mes com o anterior"
npm run agente:nexus -- --perfil catalogo "Quais grupos predominam no catalogo?"
npm run agente:nexus -- --perfil silver "Quantos clientes existem?"
npm run agente:nexus -- --perfil bronze "Liste os dados brutos disponiveis"
npm run agente:nexus -- --perfil completo "Quais dados temos?"
```

Perfis disponiveis: `automatico`, `indicadores`, `vendas`, `catalogo`, `negocio`,
`silver`, `bronze` e `completo`.

Datas informadas apenas como `DD/MM` recebem automaticamente o ano da data de
referencia da FID (`America/Sao_Paulo`). Em rankings de transportadora, a tool
agrupa por `id_transportadora` e exclui registros sem transportadora informada.

Para medir o contexto fixo sem consumir API:

```powershell
npm run agente:contexto
```

O comando antigo continua como alias compativel:

```powershell
npm run agente:bronze -- --provider gemini --model gemini-3.1-flash-lite "Quantos clientes temos?"
```

Para perguntas comuns, o agente usa `analisar_vendas` ou `analisar_catalogo`.
As tools genericas `consultar_bronze`, `agregar_bronze`, `consultar_silver` e
`agregar_silver` continuam disponiveis nos perfis tecnicos.

Configuracao recomendada em `agentes/.env`:

```text
LLM_PROVIDER=gemini
LLM_FALLBACK_PROVIDER=groq
LLM_RETRY_ATTEMPTS=1
LLM_RETRY_DELAY_MS=500
LLM_REQUEST_TIMEOUT_MS=20000

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
