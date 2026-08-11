# Tools disponiveis no Nexus

Este documento lista as tools que o agente pode chamar. Todas sao somente
leitura, recebem parametros validados e nao aceitam SQL livre.

O roteador escolhe um perfil pequeno para cada pergunta. Isso reduz tokens e
evita oferecer ao modelo ferramentas que nao pertencem ao assunto.

## Tools de negocio

| Tool | Perfil | Para que serve | Base principal |
| --- | --- | --- | --- |
| `resolver_produto` | `produto` e estoque/reposicoes | Converte EAN, SKU, ID ou descricao no produto canonico. | Silver |
| `analisar_indicadores` | `indicadores` | Painel executivo, totais, comparacao de periodos e tendencia diaria. | Gold |
| `analisar_influencias` | `influencias` | Compara dois faturamentos e mostra marcas, produtos e plataformas que mais contribuíram para altas e quedas. | Silver fiscal |
| `analisar_rupturas` | `estoque` | Ruptura atual, risco futuro, cobertura e ranking de marcas ou classificacoes. | Gold de estoque |
| `analisar_reposicoes` | `reposicoes` | Parcelas previstas, atrasadas ou recebidas; consolida o ultimo recebimento do produto por dia. | Silver de compras |
| `analisar_desempenho` | `desempenho` | Rankings faturados por produto, marca, classificacao ou plataforma, incluindo custo e margem bruta. | Gold |
| `analisar_frete` | `frete` | Frete cobrado, custo, resultado e cobertura por plataforma ou regra de transporte. | Gold |
| `analisar_operacao` | `operacao` | Funil e status de pedidos por plataforma sem contar pedido e nota como registros diferentes. | Gold |
| `analisar_vendas` | `vendas` | Totais, rankings, listagens de pedidos/notas e localizacao de NFs por `marketplace_pedido`. | Silver |
| `analisar_catalogo` | `catalogo` | Composicao do cadastro atual por produto, marca, grupo, subgrupo ou categoria. | Silver |
| `analisar_pessoas` | `pessoas` | Funcionarios e transportadoras cadastrados, ativos ou inativos, considerando todas as empresas. | Silver |
| `consultar_bloqueios_sem_estoque` | `bloqueios_estoque` | Resume, lista ou detalha pedidos com o bloqueio 58, aplicando deterministicamente a excecao do canal MELI COLETA EXT. | Gold |
| `diagnosticar_bloqueio_sem_estoque` | `bloqueios_estoque` | Cruza bloqueio, estoque oficial, saldo do CD no Thorpe e reposicoes para explicar a situacao do pedido. | Gold + Silver + Thorpe |
| `solicitar_aprofundamento` | perfis automaticos | Libera uma unica camada tecnica quando a fachada nao cobre todos os dados necessarios. | Catalogos |

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
| `consultar_gold` | `gold` ou aprofundamento | Listar, descrever, contar e consultar indicadores Gold aprovados. |
| `agregar_gold` | `gold` ou aprofundamento | Agrupar e calcular indicadores Gold oficiais. |
| `consultar_silver` | `silver` ou aprofundamento | Listar objetos, descrever schema, contar e consultar linhas modeladas. |
| `agregar_silver` | `silver` ou aprofundamento | Agrupar e calcular contagem, soma, media, minimo e maximo no Silver. |
| `consultar_bronze` | `bronze` ou auditoria dinamica | Auditar entidades, schemas, linhas atuais e historico bruto. |
| `agregar_bronze` | `bronze` ou auditoria dinamica | Fazer agregacoes controladas sobre entidades Bronze aprovadas. |

As tools genericas existem para perguntas avancadas ou auditoria. Perguntas
recorrentes de negocio devem preferir as fachadas `analisar_*`, que aplicam
conceitos e limites mais claros.

## Perfis enviados ao modelo

| Perfil | Tools enviadas |
| --- | --- |
| `indicadores` | `analisar_indicadores` |
| `influencias` | `analisar_influencias` |
| `produto` | `resolver_produto` |
| `estoque` | `resolver_produto`, `analisar_rupturas` |
| `estoque_reposicoes` | `resolver_produto`, `analisar_rupturas`, `analisar_reposicoes` |
| `reposicoes` | `resolver_produto`, `analisar_reposicoes` |
| `desempenho` | `analisar_desempenho` |
| `frete` | `analisar_frete` |
| `operacao` | `analisar_operacao` |
| `vendas` | `analisar_vendas` |
| `catalogo` | `analisar_catalogo` |
| `pessoas` | `analisar_pessoas` |
| `bloqueios_estoque` | `consultar_bloqueios_sem_estoque`, `diagnosticar_bloqueio_sem_estoque` |
| `negocio` | `analisar_vendas`, `analisar_catalogo` |
| `hibrido` | Todas as fachadas `analisar_*`, sem tools tecnicas |
| `gold` | `consultar_gold`, `agregar_gold` |
| `silver` | `consultar_silver`, `agregar_silver` |
| `bronze` | `consultar_bronze`, `agregar_bronze` |
| `completo` | Todas as tools, somente para diagnostico |

O registro executavel que define essa relacao fica em
`agentes/ferramentas.js`. Este documento deve ser atualizado quando uma tool ou
perfil for adicionado, removido ou renomeado.

## Datas e horarios

Datas comerciais (`data_pedido`, `data_emissao`, `data_referencia` e similares)
continuam como datas, sem deslocamento de fuso. Timestamps tecnicos, como
`atualizado_em`, `processado_em`, `dt_extracao` e `ultimaConstrucao`, sao
armazenados em UTC e entregues pelas tools com o offset de
`America/Sao_Paulo`. Por exemplo, `2026-08-03T12:32:29.487Z` e apresentado pela
tool como `2026-08-03T09:32:29.487-03:00`.

## Como o roteamento automatico se recupera

Perguntas reconhecidas por regras locais recebem apenas o menor perfil e a tool
compacta `solicitar_aprofundamento`. Quando nenhuma regra tem confianca
suficiente, o perfil `hibrido` oferece as fachadas de negocio e esse mesmo
gateway, sem carregar schemas tecnicos antecipadamente.

Quando uma fachada nao basta, o modelo pode liberar uma unica camada na mesma
conversa: Gold para metricas oficiais, Silver para detalhes modelados e Bronze
somente para auditoria, historico ou divergencia. Apos a liberacao, cabe uma
descoberta de schema e uma consulta ou agregacao final. Chamadas identicas sao
bloqueadas.

Se um provider tentar chamar uma fachada de negocio conhecida que nao estava no
perfil inicial, o agente pode ampliar o perfil e repetir a execucao uma unica
vez. Consultas tecnicas usam exclusivamente `solicitar_aprofundamento`; perfis
escolhidos explicitamente com `--perfil` nao sao ampliados.
