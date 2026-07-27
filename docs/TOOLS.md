# Tools disponiveis no Nexus

Este documento lista as tools que o agente pode chamar. Todas sao somente
leitura, recebem parametros validados e nao aceitam SQL livre.

O roteador escolhe um perfil pequeno para cada pergunta. Isso reduz tokens e
evita oferecer ao modelo ferramentas que nao pertencem ao assunto.

## Tools de negocio

| Tool | Perfil | Para que serve | Base principal |
| --- | --- | --- | --- |
| `analisar_indicadores` | `indicadores` | Painel executivo, totais, comparacao de periodos e tendencia diaria. | Gold |
| `analisar_influencias` | `influencias` | Compara dois faturamentos e mostra marcas, produtos e plataformas que mais contribuíram para altas e quedas. | Silver fiscal |
| `analisar_rupturas` | `estoque` | Ruptura atual, risco futuro, cobertura e ranking de marcas ou classificacoes. | Gold de estoque |
| `analisar_desempenho` | `desempenho` | Rankings faturados por produto, marca, classificacao ou plataforma, incluindo custo e margem bruta. | Gold |
| `analisar_frete` | `frete` | Frete cobrado, custo, resultado e cobertura por plataforma ou regra de transporte. | Gold |
| `analisar_operacao` | `operacao` | Funil e status de pedidos por plataforma sem contar pedido e nota como registros diferentes. | Gold |
| `analisar_vendas` | `vendas` | Totais, rankings, listagens de pedidos/notas e localizacao de NFs por `marketplace_pedido`. | Silver |
| `analisar_catalogo` | `catalogo` | Composicao do cadastro atual por produto, marca, grupo, subgrupo ou categoria. | Silver |

### Observacao sobre influencias

`analisar_influencias` aceita dois modos:

- periodo atual informado e periodo anterior automatico de mesma duracao;
- dois periodos explicitamente informados, inclusive quando vierem da memoria
  curta de uma conversa.

A tool devolve o total atual, anterior, diferenca, variacao percentual e as
maiores altas e quedas por dimensao. Essas contribuicoes mostram onde a variacao
ocorreu; nao provam causalidade externa.

## Tools genericas

| Tool | Perfil | Para que serve |
| --- | --- | --- |
| `consultar_silver` | `silver` | Listar objetos, descrever schema, contar e consultar linhas modeladas. |
| `agregar_silver` | `silver` | Agrupar e calcular contagem, soma, media, minimo e maximo no Silver. |
| `consultar_bronze` | `bronze` | Auditar entidades, schemas, linhas atuais e historico bruto. |
| `agregar_bronze` | `bronze` | Fazer agregacoes controladas sobre entidades Bronze aprovadas. |

As tools genericas existem para perguntas avancadas ou auditoria. Perguntas
recorrentes de negocio devem preferir as fachadas `analisar_*`, que aplicam
conceitos e limites mais claros.

## Perfis enviados ao modelo

| Perfil | Tools enviadas |
| --- | --- |
| `indicadores` | `analisar_indicadores` |
| `influencias` | `analisar_influencias` |
| `estoque` | `analisar_rupturas` |
| `desempenho` | `analisar_desempenho` |
| `frete` | `analisar_frete` |
| `operacao` | `analisar_operacao` |
| `vendas` | `analisar_vendas` |
| `catalogo` | `analisar_catalogo` |
| `negocio` | `analisar_vendas`, `analisar_catalogo` |
| `silver` | `consultar_silver`, `agregar_silver` |
| `bronze` | `consultar_bronze`, `agregar_bronze` |
| `completo` | Todas as tools, somente para diagnostico |

O registro executavel que define essa relacao fica em
`agentes/ferramentas.js`. Este documento deve ser atualizado quando uma tool ou
perfil for adicionado, removido ou renomeado.
