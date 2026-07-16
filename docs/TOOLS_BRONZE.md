# Tools do Bronze

O agente possui duas tools somente leitura. Nenhuma delas aceita SQL livre.
Entidades e colunas continuam limitadas pelo catálogo em
`exportadores/postgres/entidades`.

## 1. `consultar_bronze`

Usada para descobrir entidades, descrever colunas, contar registros e retornar
linhas.

### Operações

- `listar_entidades`: mostra entidades, quantidade de extrações e atualização.
- `descrever_entidade`: mostra somente as colunas liberadas ao agente.
- `contar`: conta registros depois dos filtros.
- `consultar`: retorna colunas e linhas, com limite máximo de 100 por chamada.

### Parâmetros

- `entidade`: `cliente` ou `nota_saida`.
- `visao`: `atual` ou `historico`; o padrão é `atual`.
- `id`: busca direta pela chave primária.
- `colunas`: campos que devem aparecer no resultado.
- `filtros`: condições estruturadas e parametrizadas.
- `combinacao_filtros`: `todos` (E) ou `qualquer` (OU).
- `ordenacao`: um `campo` aprovado e uma `direcao` (`asc` ou `desc`).
- `deslocamento`: linhas a pular, de 0 a 10.000, para paginação.
- `limite`: quantidade a retornar, de 1 a 100 para o agente.

### Operadores de filtro

| Operador | Uso |
|---|---|
| `igual` | Igualdade; com `null`, usa `IS NULL`. |
| `diferente` | Diferença; com `null`, usa `IS NOT NULL`. |
| `contem` | Texto em qualquer posição, ignorando maiúsculas. |
| `comeca_com` | Texto no início do campo. |
| `termina_com` | Texto no final do campo. |
| `maior_que` | Comparação `>`. |
| `maior_ou_igual` | Comparação `>=`. |
| `menor_que` | Comparação `<`. |
| `menor_ou_igual` | Comparação `<=`. |
| `entre` | Intervalo fechado, usando `valor` e `valor_final`. |
| `em` | Campo presente em uma lista de até 50 `valores`. |
| `nao_em` | Campo ausente da lista de `valores`. |
| `esta_vazio` | Campo nulo ou texto vazio. |
| `nao_esta_vazio` | Campo preenchido. |

Datas aceitam `DD/MM/AAAA` e `AAAA-MM-DD`. Para manter um contrato estrito com
os providers, cada filtro possui `valor`, `valor_final` e `valores`; parâmetros
que não pertencem ao operador usado devem ser enviados como `null`.

Exemplo conceitual: últimos pedidos com nota preenchida.

```json
{
  "operacao": "consultar",
  "entidade": "nota_saida",
  "visao": "atual",
  "id": null,
  "colunas": ["id_nr_nf", "data_pedido", "marketplace_pedido"],
  "filtros": [
    {
      "campo": "id_nr_nf",
      "operador": "maior_que",
      "valor": "0",
      "valor_final": null,
      "valores": null
    }
  ],
  "combinacao_filtros": "todos",
  "ordenacao": { "campo": "data_pedido", "direcao": "desc" },
  "deslocamento": 0,
  "limite": 10
}
```

## 2. `agregar_bronze`

Usada para análises que não devem ser feitas contando manualmente uma amostra:
quantidade por categoria, valores distintos, soma, média, mínimo e máximo.

### Parâmetros

- `entidade` e `visao`: iguais aos da consulta.
- `agrupamentos`: até 3 campos ou `null` para um cálculo global.
- `granularidade`: `valor`; ou `dia`, `mes` e `ano` para campos de data.
- `calculos`: de 1 a 5 cálculos.
- `filtros` e `combinacao_filtros`: iguais aos da consulta.
- `ordenacao`: escolhe `agrupamento` ou `calculo`, seu índice começando em 0 e a direção.
- `limite`: até 100 grupos.

### Cálculos

- `contar`: com `campo: null`, conta todas as linhas.
- `somar`: somente coluna numérica.
- `media`: somente coluna numérica.
- `minimo`: menor valor de um campo.
- `maximo`: maior valor de um campo.

Exemplo conceitual: quantidade e faturamento por mês.

```json
{
  "entidade": "nota_saida",
  "visao": "atual",
  "agrupamentos": [
    { "campo": "data_pedido", "granularidade": "mes" }
  ],
  "calculos": [
    { "operacao": "contar", "campo": null },
    { "operacao": "somar", "campo": "total_nota_fiscal" }
  ],
  "filtros": null,
  "combinacao_filtros": "todos",
  "ordenacao": { "tipo": "agrupamento", "indice": 0, "direcao": "desc" },
  "limite": 12
}
```

O resultado usa aliases como `grupo_1` e `calculo_1`, acompanhados de metadados
que informam qual campo, granularidade e cálculo cada alias representa.

## Escolha rápida

```text
Quero linhas específicas ou detalhes       → consultar_bronze
Quero apenas saber quantos existem          → consultar_bronze / contar
Quero quantidade por UF ou valores distintos → agregar_bronze / contar + agrupar
Quero soma, média, mínimo ou máximo          → agregar_bronze
Quero comparar dois períodos                 → duas chamadas de agregar_bronze
```

Ainda não há joins livres entre entidades. Relacionamentos frequentes devem ser
modelados depois na camada Silver, onde os nomes e regras de negócio ficam mais
estáveis.

## Regra de negócio: pedido versus nota emitida

Na entidade `nota_saida`, a existência de uma linha não garante que a nota
fiscal já foi emitida. Em geral:

- valor de pedidos do dia: filtrar `data_pedido` e somar `total_nota_fiscal`;
- faturamento fiscal emitido: filtrar `data_emissao` e exigir `id_nr_nf > 0`;
- perguntas com `id_tp_pedido` ou marketplace normalmente se referem ao fluxo de
  pedidos, salvo indicação explícita de emissão.

O agente deve mencionar qual campo de data e qual definição utilizou.
