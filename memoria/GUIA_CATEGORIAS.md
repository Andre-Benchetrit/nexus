# Guia de categorias da memoria longa

A memoria longa guarda somente conhecimentos estaveis e revisados. Ela nao deve
guardar numeros de vendas, resultados pontuais, respostas completas ou dados que
mudam a cada atualizacao do lake.

## Categorias recomendadas

| Categoria | Use para | Exemplo |
| --- | --- | --- |
| `regra_negocio` | Definicoes oficiais, inclusoes e exclusoes de metricas. | Faturamento considera somente NF-e autorizada com cStat 100. |
| `vocabulario_negocio` | Como a FID chama campos, codigos e conceitos. | Numero do pedido significa `marketplace_pedido`. |
| `fonte_de_dados` | Onde um assunto deve ser consultado. | Estoque atual vem de `produto_inventario`; compras futuras virao do OneDrive. |
| `regra_temporal` | Qual data representa cada fato. | Faturamento usa data de emissao; pedidos usam data do pedido. |
| `classificacao` | Significado de status, tipos e classificacoes. | Pedido pendente e faturado sem cancelamento. |
| `qualidade_dados` | Limites conhecidos e cuidados de interpretacao. | Resultado de frete exige cobertura de custo; nao e lucro liquido. |
| `preferencia_resposta` | Preferencias estaveis de formato ou comunicacao. | Em lista de pedidos, mostrar marketplace_pedido antes do identificador interno. |
| `sinonimo` | Termos alternativos que usuarios usam para o mesmo conceito. | Nota fiscal, NF e nota se referem a NF-e emitida quando o contexto for faturamento. |
| `correcao_agente` | Correcao pontual de comportamento que nao altera uma regra de negocio. | Ao receber varios marketplace_pedido, informar encontrados e ausentes. |
| `limite_atual` | Algo que o Nexus ainda nao consegue responder com seguranca. | Previsao de reposicao nao considera compras futuras ate integrar a planilha. |

## Como escolher

- Se muda a formula ou a definicao de uma metrica, use `regra_negocio`.
- Se explica o que uma palavra do time significa, use `vocabulario_negocio` ou
  `sinonimo`.
- Se define qual tabela, camada ou integracao responde algo, use
  `fonte_de_dados`.
- Se evita uma interpretacao enganosa por ausencia ou atraso de dados, use
  `qualidade_dados` ou `limite_atual`.
- Se corrige a forma como o agente responde sem mudar os dados, use
  `correcao_agente` ou `preferencia_resposta`.

## Exemplos de cadastro

```powershell
# Regra de negocio
npm run agente:memoria -- --lembrar "Pedidos com marketplace_pedido terminado em _ sao reversas e nao entram no faturamento." --categoria regra_negocio --gatilhos "reversa,marketplace_pedido,faturamento"

# Fonte de dados
npm run agente:memoria -- --lembrar "Estoque atual usa produto_inventario para id_empresa 10; compras futuras dependem da planilha de agendamento." --categoria fonte_de_dados --gatilhos "estoque,compras,produto_inventario"

# Correcao do agente
npm run agente:memoria -- --lembrar "Em consulta de lote por marketplace_pedido, informar pedidos encontrados, ausentes e encontrados sem nota fiscal." --categoria correcao_agente --gatilhos "marketplace_pedido,lote,nota fiscal"
```

## O que nao cadastrar

- Valores, rankings ou quantidades de uma consulta especifica.
- Senhas, chaves de API, dados pessoais ou informacoes confidenciais.
- SQL, caminhos internos ou instrucoes para ignorar as tools.
- Hipoteses ainda nao confirmadas.

Quando uma correcao alterar a regra oficial do lake, atualize tambem o modelo
Silver/Gold, a tool e os testes. A memoria longa complementa o contrato; ela nao
substitui codigo nem documentacao oficial.
