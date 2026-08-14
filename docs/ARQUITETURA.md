# Arquitetura do Nexus

## Fluxo principal

```text
PostgreSQL + Microsoft 365
  -> exportadores + catalogo Bronze
  -> Parquets Bronze + manifestos
  -> modelos Silver + qualidade
  -> Parquets Silver + manifestos
  -> indicadores Gold + reconciliacao
  -> Parquets Gold + manifestos
  -> leitores DuckDB
  -> tools seguras
  -> roteador local
  -> provider LLM
```

## Banco operacional

Governança, conversas, memória estruturada, tarefas interativas e auditoria usam
um PostgreSQL próprio no schema `nexus`. Esse banco não substitui o lake nem o
`sysemp`: ele mantém o estado transacional da aplicação. A configuração e os
comandos estão em [GOVERNANCA.md](GOVERNANCA.md).

O modelo de linguagem nunca recebe SQL livre nem acesso direto aos arquivos. Ele
escolhe uma tool por um contrato JSON; a tool valida campos e filtros antes de
usar o leitor DuckDB.

## Responsabilidades

- `exportadores/`: ingestao fiel da origem e contratos das entidades Bronze.
- `integracoes/microsoft/`: autenticacao corporativa e cliente Microsoft Graph.
- `integracoes/thorpe/`: autenticacao e consulta somente leitura do estoque do CD.
- `silver/`: dimensoes, fatos, dependencias e validacoes de qualidade.
- `gold/`: metricas oficiais, paineis e comparacoes derivados somente do Silver.
- `duckdb/`: repositorios de consulta somente leitura para Bronze, Silver e Gold.
- `tools/core/`: contratos e validacoes compartilhadas, sem depender de camada.
- `tools/analisar_*.js`: fachadas de negocio com respostas autoexplicativas.
- `agentes/roteador.js`: escolhe localmente o menor perfil de tools.
- `agentes/ferramentas.js`: registro central e injecao dos executores.
- `agentes/recuperacao_tools.js`: amplia uma vez uma rota automatica incompleta.
- `agentes/resposta.js`: normaliza a apresentacao sem misturar regras ao fluxo.
- `agentes/providers/`: adapters para Gemini, Groq e OpenAI.
- `agentes/consultor_nexus.js`: facade de orquestracao e entrada de linha de comando.

## Padroes utilizados

### Catalogo como metadata

Entidades e objetos consultaveis sao derivados dos catalogos Bronze e Silver.
As tools genericas nao mantem listas paralelas de tabelas ou campos.

### Repository

`criarLeitorBronze` e `criarLeitorSilver` escondem descoberta de manifestos,
views DuckDB, filtros parametrizados e paginacao.

### Facade

As tools `analisar_*` oferecem operacoes de negocio pequenas sobre os leitores.
A IA nao precisa conhecer fatos, aliases internos ou dezenas de colunas para
perguntas comuns. Regras oficiais permanecem nos modelos Gold, e nao no prompt.

### Strategy e Adapter

O consultor usa um contrato unico de provider. Gemini, Groq e OpenAI adaptam
esse contrato aos seus formatos sem alterar tools ou regras de negocio.

### Registry

`agentes/ferramentas.js` concentra definicoes e executores. Testes podem injetar
implementacoes falsas sem alterar o agente.

### Router hibrido

O roteador classifica palavras de negocio localmente. Isso nao consome API e
evita enviar todas as tools em cada pergunta. O roteador v2 usa uma LLM separada
para produzir dominio, intencao, entidades, campos e plano sugerido. O registro
de capacidades valida esse plano antes de qualquer tool ser exposta. Regras
locais continuam soberanas para perfil explicito, seguranca e Bronze.

Os modos sao `legacy`, `shadow` e `v2`. `shadow` e o padrao inicial: calcula a
rota semantica, registra a divergencia e ainda executa a rota legada. Em `v2`,
uma ambiguidade material gera uma pergunta de esclarecimento sem consultar dados.
Gold e Silver so ficam disponiveis quando a rota registra uma capacidade ausente;
Bronze continua restrito a auditoria.

## Perfis de tools

| Perfil | Uso | Tools |
|---|---|---|
| `vendas` | pedidos, notas e produtos vendidos | `analisar_vendas` |
| `indicadores` | painel, KPIs e comparacoes | `analisar_indicadores` |
| `influencias` | altas e quedas por dimensao | `analisar_influencias` |
| `desempenho` | faturamento, custo e margem | `analisar_desempenho` |
| `operacao` | funil de pedidos e plataformas | `analisar_operacao` |
| `frete` | frete cobrado, custo e cobertura | `analisar_frete` |
| `estoque` | ruptura e cobertura | `analisar_rupturas` |
| `reposicoes` | compras previstas e recebimentos | `analisar_reposicoes` |
| `catalogo` | cadastro, composicao e estoque | `analisar_catalogo` |
| `pessoas` | funcionarios e transportadoras | `analisar_pessoas` |
| `bloqueios_estoque` | pedidos bloqueados por falta de estoque | `consultar_bloqueios_sem_estoque`, `diagnosticar_bloqueio_sem_estoque` |
| `negocio` | perfil manual legado | vendas e catalogo |
| `hibrido` | pergunta realmente ambigua | todas as fachadas de negocio |
| `gold` | consulta avancada de indicadores | tools Gold genericas |
| `silver` | consulta avancada modelada | tools Silver genericas |
| `bronze` | auditoria e dados brutos | tools Bronze genericas |
| `completo` | diagnostico manual | todas as tools |

Consulte [TOOLS.md](TOOLS.md) para a lista detalhada, finalidade e camada de
dados de cada tool.

O perfil padrao e `automatico`. Pode ser substituido no terminal:

```powershell
npm run agente:nexus -- --perfil silver "Quantos clientes existem?"
npm run agente:nexus -- --perfil bronze "Audite as versoes desse cliente"
npm run agente:nexus -- --perfil gold "Descreva os indicadores Gold disponiveis"
```

## Orcamento de contexto

O comando abaixo mede prompt e schemas, sem chamar API:

```powershell
npm run agente:contexto
```

A estimativa usa quatro caracteres por token apenas como referencia. Tokens sao
telemetria: contexto necessario para uma resposta verdadeira nao deve ser
removido para cumprir um limite artificial. A suite conserva apenas um teto de
seguranca contra crescimento patologico.

Medicao atual aproximada:

- indicadores com gateway: 893 tokens;
- estoque com gateway: 1.051;
- bloqueios de estoque com gateway: 781;
- desempenho com gateway: 990;
- frete com gateway: 823;
- operacao com gateway: 790;
- vendas com gateway: 1.045;
- catalogo com gateway: 753;
- negocio com gateway: 1.270;
- hibrido com gateway: 4.037;
- Gold generico, carregado sob demanda: 1.552;
- Silver generico, carregado sob demanda: 1.673;
- Bronze generico, carregado sob demanda: 1.679.

## Como adicionar uma capacidade

1. Modele e valide o dado na camada apropriada.
2. Exponha apenas campos seguros no catalogo.
3. Se a pergunta for recorrente, crie uma facade de negocio pequena.
4. Registre a tool em `agentes/ferramentas.js`.
5. Registre dominio, intencoes, entidades, campos e operacoes em
   `agentes/capacidades.js`.
6. Teste contrato, plano validado, resultado real, continuidade e telemetria.

## Camada Gold

A Gold fornece indicadores prontos, sem importar providers ou prompts:

```text
Silver -> modelos Gold -> leitor Gold -> tools de indicador -> roteador
```

Assim, metricas como faturamento, margem e ticket medio ficam definidas
uma vez no dado, em vez de serem reinterpretadas pelo modelo a cada pergunta.

Os objetos executivos incluem `kpi_vendas_diario`, `kpi_faturamento_diario`,
`kpi_pedidos_pagos_diario`, `desempenho_produto_diario`,
`kpi_plataforma_diario`, `kpi_frete_diario`, `kpi_estoque_diario` e
`painel_executivo_diario`. As definicoes, cobertura e comandos estao em
[GOLD.md](GOLD.md).

O marco para evoluir de consultor do lake para agente geral com web, documentos,
planilhas, automacoes e MCP esta registrado em [ROADMAP.md](ROADMAP.md).
