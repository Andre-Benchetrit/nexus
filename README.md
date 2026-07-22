# Nexus

Referencia completa de comandos: [`docs/COMANDOS.md`](docs/COMANDOS.md).

Indicadores e definicoes de negocio: [`docs/GOLD.md`](docs/GOLD.md).

O Nexus é o hub de entrada do data lake. Ele busca dados em bancos, APIs e arquivos e os guarda de forma padronizada para consumo posterior por análises, APIs e IAs.

## Modelo mental

- **Entidade**: o que será copiado, por exemplo `nota_saida`.
- **Exportador**: o motor compartilhado que faz conexão, Parquet, validação e logs.
- **Catálogo**: a lista das entidades disponíveis.
- **Bronze**: cópia bruta da fonte, sem regra de negócio.
- **Manifesto**: recibo da execução com horário e total de linhas.

## Comandos

```powershell
# Ver entidades cadastradas
npm run exportar -- --listar

# Simular sem conectar ao banco (fim é exclusivo)
npm run exportar -- nota_saida --inicio 2026-07-01 --fim 2026-07-02 --dry-run

# Executar a exportação
npm run exportar -- nota_saida --inicio 2026-07-01 --fim 2026-07-02

# Testes locais
npm test
```

## Consultar o bronze com DuckDB

O leitor considera apenas Parquets acompanhados por um `manifest.json` com
`status: "sucesso"`. Para entidades incrementais, ele disponibiliza duas visões:

- `historico`: todas as versões extraídas;
- `atual`: somente a versão mais recente de cada chave primária.

```powershell
# Ver entidades que possuem cargas válidas
npm run consultar -- --listar

# Contar clientes na visão atual (padrão)
npm run consultar -- cliente --contar

# Contar todas as versões históricas
npm run consultar -- cliente --contar --visao historico

# Consultar pelas colunas padrão, com limite
npm run consultar -- nota_saida --limite 10

# Buscar pela chave primária
npm run consultar -- cliente --id 123

# Selecionar colunas e aplicar filtros de igualdade
npm run consultar -- nota_saida --colunas id_nota_saida,id_cliente,situacao --filtro situacao=B

# Buscar por data brasileira e ordenar os registros mais recentes
npm run consultar -- nota_saida --filtro data_pedido=16/07/2026 --ordenar data_pedido --direcao desc --limite 10

# Inspecionar o schema completo
npm run consultar -- cliente --schema
```

As colunas e entidades são validadas contra o catálogo e o schema do Parquet;
valores de filtros são parametrizados. O limite padrão é 50 e o máximo é 500.

## Tool e agente do bronze

A referência completa de operações, filtros e agregações está em
[`docs/TOOLS_BRONZE.md`](docs/TOOLS_BRONZE.md).

A tool `consultar_bronze` encapsula o leitor DuckDB e oferece quatro operações
estruturadas: `listar_entidades`, `descrever_entidade`, `contar` e `consultar`.
Ela não aceita SQL e limita o agente às colunas aprovadas em
`consulta.colunasAgente` ou `consulta.colunasPadrao` no catálogo. Somente
entidades com `consulta.habilitadaParaAgente: true` aparecem nas tools; essa
lista é gerada automaticamente a partir do catálogo. O limite de retorno da
tool é 100 linhas.
Os filtros aceitam igualdade e busca textual parcial (`contem`). Também podem
ser combinados com `todos` (E) ou `qualquer` (OU), permitindo procurar um nome
em `fantasia` ou `razsocial` sem expor SQL ao modelo.
Também estão disponíveis `diferente`, `maior_que`, `maior_ou_igual`,
`menor_que` e `menor_ou_igual`, sempre com valores parametrizados.
Consultas também aceitam ordenação por uma coluna aprovada. Datas de colunas
`DATE` podem ser informadas como `DD/MM/AAAA` ou `AAAA-MM-DD`; internamente são
normalizadas antes da comparação.

`dt_alteracao` é o cursor técnico da extração incremental: ele decide quais
linhas precisam ser copiadas novamente. Para perguntas de negócio, prefira
`data_emissao` para notas emitidas e `data_pedido` para pedidos. A data da última
extração indica quando o lake foi processado, não a maior data existente nos
registros.

Em `nota_saida`, a extração usa `dt_alteracao` para capturar atualizações e
`dt_cadastro` para capturar registros novos cujo `dt_alteracao` ainda é nulo.
`data_pedido` não é cursor de ingestão: ela permanece como data de negócio.

O agente possui adaptadores separados para Gemini, Groq e OpenAI. A tool, as regras de
acesso e o DuckDB são os mesmos nos três casos. Para configurá-lo, copie
`agentes/.env.example` para `agentes/.env` e escolha o provider:

```text
LLM_PROVIDER=gemini
LLM_FALLBACK_PROVIDER=groq
LLM_REQUEST_TIMEOUT_MS=20000

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite

GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
```

Execute usando o provider configurado:

```powershell
npm run agente:nexus -- "Quantas notas de saída estão na situação B?"
```

Também é possível escolher sem alterar o arquivo `.env`:

```powershell
npm run agente:nexus -- --provider gemini "Quantos clientes temos?"
npm run agente:nexus -- --provider groq "Quantos clientes temos?"
npm run agente:nexus -- --provider openai "Quantos clientes temos?"
npm run agente:nexus -- --provider gemini --model gemini-3.1-flash-lite "Quais dados temos?"
```

Com `LLM_FALLBACK_PROVIDER=groq`, erros transitórios do Gemini acionam o Groq.
Erros de quota (`429`) mudam imediatamente; indisponibilidade (`503`) e timeout
têm uma tentativa curta antes da troca. Erros de configuração, autenticação ou
validação não acionam fallback. Use `--no-fallback` para desativá-lo em uma execução.
O agente usa a visão atual por padrão, informa a última extração
quando disponível e nunca executa SQL produzido pelo modelo.

Para reduzir custo e erros, um roteador local envia somente as tools relevantes
para cada pergunta. Vendas e catalogo possuem fachadas compactas; consultas
avancadas ainda podem usar os perfis Silver ou Bronze:

```powershell
npm run agente:nexus -- --perfil vendas "Qual marca mais vendeu hoje?"
npm run agente:contexto
```

O desenho completo esta em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

### Exemplo do fluxo completo

Ao executar:

```powershell
npm run agente:nexus -- --provider gemini --model gemini-3.1-flash-lite "Quantos clientes possuem MMA no nome fantasia ou razão social?"
```

o fluxo é:

```text
Terminal
  → agentes/consultor_nexus.js: envia pergunta, regras e definições das tools ao provider
  → Gemini: escolhe uma ação estruturada, por exemplo contar clientes
  → tools/consultar_bronze.js: valida operação, entidade, colunas, filtros e limites
  → duckdb/bronze.js: monta uma consulta interna parametrizada e somente leitura
  → DuckDB: lê os Parquets do Bronze
  → tool: devolve o resultado estruturado ao Gemini
  → Gemini: transforma o resultado em uma resposta em português
```

Para essa pergunta, o Gemini pode pedir conceitualmente:

```json
{
  "operacao": "contar",
  "entidade": "cliente",
  "visao": "atual",
  "filtros": [
    { "campo": "fantasia", "operador": "contem", "valor": "MMA" },
    { "campo": "razsocial", "operador": "contem", "valor": "MMA" }
  ],
  "combinacao_filtros": "qualquer"
}
```

Não há um campo para SQL nessa interface. A tool aceita somente operações e
filtros previstos, e o leitor usa valores parametrizados. Assim, o modelo
interpreta a intenção, enquanto o código decide o que ele pode consultar.

## Cadastrar outra tabela PostgreSQL

1. Copie `exportadores/postgres/entidades/nota_saida.js`.
2. Troque `nome`, `schema`, `tabela` e, se desejar, liste as colunas.
3. Importe a configuração em `exportadores/catalogo.js`.

Exemplo:

```js
module.exports = {
  nome: 'clientes',
  fonte: 'postgres',
  schema: 'public',
  tabela: 'clientes',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    colunas: ['id', 'nome', 'updated_at']
  }
};
```

Todo o restante é responsabilidade do exportador genérico.

## Saída

Cada execução cria uma pasta própria:

```text
lake/bronze/postgres/nota_saida/
  dt_extracao=2026-07-10/
    execucao=20260710T143012345Z/
      dados.parquet
      manifest.json
```

O `manifest.json` é o marcador de conclusão da carga. Consumidores ignoram
qualquer Parquet sem manifesto com `status: "sucesso"`. Antes de gravar o
manifesto, o exportador lê todas as colunas, conta as linhas e calcula um
checksum para detectar inclusive textos com codificação inválida.

`nota_saida` exige uma janela de `dt_alteracao` para impedir uma cópia completa acidental e capturar registros novos ou modificados. O início é inclusivo e o fim é exclusivo. Para exportar as alterações de 1º de julho, use `--inicio 2026-07-01 --fim 2026-07-02`.

Uma janela concluída não é exportada novamente. Para um reprocessamento intencional, acrescente `--forcar`.

## Configuração

As variáveis antigas (`HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD`) continuam funcionando. Para novas instalações, prefira:

```text
POSTGRES_HOST=
POSTGRES_PORT=
POSTGRES_DATABASE=
POSTGRES_USER=
POSTGRES_PASSWORD=
```

O arquivo `.env` não deve ser versionado.

## Próximos passos

A versão inicial trabalha com snapshots PostgreSQL. Extração incremental, APIs e arquivos serão adicionados como novos adaptadores, sem duplicar o motor existente.
