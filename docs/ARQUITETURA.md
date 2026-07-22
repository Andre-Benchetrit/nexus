# Arquitetura do Nexus

## Fluxo principal

```text
PostgreSQL
  -> exportadores + catalogo Bronze
  -> Parquets Bronze + manifestos
  -> modelos Silver + qualidade
  -> Parquets Silver + manifestos
  -> leitores DuckDB
  -> tools seguras
  -> roteador local
  -> provider LLM
```

O modelo de linguagem nunca recebe SQL livre nem acesso direto aos arquivos. Ele
escolhe uma tool por um contrato JSON; a tool valida campos e filtros antes de
usar o leitor DuckDB.

## Responsabilidades

- `exportadores/`: ingestao fiel da origem e contratos das entidades Bronze.
- `silver/`: dimensoes, fatos, dependencias e validacoes de qualidade.
- `duckdb/`: repositorios de consulta somente leitura para Bronze e Silver.
- `tools/core/`: contratos e validacoes compartilhadas, sem depender de camada.
- `tools/analisar_*.js`: fachadas de negocio com respostas autoexplicativas.
- `agentes/roteador.js`: escolhe localmente o menor perfil de tools.
- `agentes/ferramentas.js`: registro central e injecao dos executores.
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

`analisar_vendas` e `analisar_catalogo` oferecem operacoes de negocio pequenas
sobre os leitores genericos. A IA nao precisa conhecer fatos, aliases internos
ou dezenas de colunas para perguntas comuns.

### Strategy e Adapter

O consultor usa um contrato unico de provider. Gemini, Groq e OpenAI adaptam
esse contrato aos seus formatos sem alterar tools ou regras de negocio.

### Registry

`agentes/ferramentas.js` concentra definicoes e executores. Testes podem injetar
implementacoes falsas sem alterar o agente.

### Router deterministico

O roteador classifica palavras de negocio localmente. Isso nao consome API e
evita enviar todas as tools em cada pergunta.

## Perfis de tools

| Perfil | Uso | Tools |
|---|---|---|
| `vendas` | pedidos, notas e produtos vendidos | `analisar_vendas` |
| `catalogo` | cadastro, composicao e estoque | `analisar_catalogo` |
| `negocio` | pergunta ambigua | as duas fachadas |
| `silver` | consulta avancada modelada | tools Silver genericas |
| `bronze` | auditoria e dados brutos | tools Bronze genericas |
| `completo` | diagnostico manual | todas as tools |

O perfil padrao e `automatico`. Pode ser substituido no terminal:

```powershell
npm run agente:nexus -- --perfil silver "Quantos clientes existem?"
npm run agente:nexus -- --perfil bronze "Audite as versoes desse cliente"
```

## Orcamento de contexto

O comando abaixo mede prompt e schemas, sem chamar API:

```powershell
npm run agente:contexto
```

A estimativa usa quatro caracteres por token apenas como referencia. Os testes
mantem os perfis comuns dentro de limites para impedir crescimento acidental.

Baseline anterior: aproximadamente 3.721 tokens fixos por rodada.

- vendas: aproximadamente 679;
- catalogo: aproximadamente 507;
- negocio: aproximadamente 889;
- Silver generico: aproximadamente 1.301;
- Bronze generico: aproximadamente 1.473.

## Como adicionar uma capacidade

1. Modele e valide o dado na camada apropriada.
2. Exponha apenas campos seguros no catalogo.
3. Se a pergunta for recorrente, crie uma facade de negocio pequena.
4. Registre a tool em `agentes/ferramentas.js`.
5. Acrescente a rota somente quando houver sinais deterministas suficientes.
6. Teste contrato, validacao, resultado real e orcamento de contexto.

## Preparacao para Gold

A Gold deve fornecer indicadores prontos, sem importar providers ou prompts.
O caminho recomendado e:

```text
Silver -> modelos Gold -> leitor Gold -> tools de indicador -> roteador
```

Assim, metricas como faturamento, margem, ticket medio e metas ficam definidas
uma vez no dado, em vez de serem reinterpretadas pelo modelo a cada pergunta.

O marco para evoluir de consultor do lake para agente geral com web, documentos,
planilhas, automacoes e MCP esta registrado em [ROADMAP.md](ROADMAP.md).
