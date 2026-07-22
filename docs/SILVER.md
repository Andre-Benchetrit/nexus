# Camada Silver

A camada Silver transforma os dados brutos do Bronze em conjuntos prontos para
uso de negocio. Ela nao substitui nem altera o Bronze: sempre pode ser
reconstruida a partir dele.

Os modelos ficam organizados pela fonte de origem. Os objetos derivados do
PostgreSQL estao em:

```text
silver/postgres/
  core/
    util.js
  dimensoes/
    dim_cliente.js
    dim_grupo.js
    dim_subgrupo.js
    dim_marca.js
    dim_categoria.js
    dim_tipo_pedido.js
    dim_transporte_regra.js
    dim_plataforma_ecommerce.js
    dim_produto.js
  fatos/
    fato_venda.js
    fato_venda_item.js
```

## Fluxo

```text
PostgreSQL -> Bronze (copia fiel) -> DuckDB (limpeza e joins)
           -> Silver (Parquet validado) -> tools -> agentes
```

Uma tabela nova entra primeiro no Bronze. A partir dela, o Silver gera dimensoes
e fatos enriquecidas. Isso preserva a origem para auditoria e reprocessamento.

## Modelo atual

```text
dim_cliente -----------\
dim_tipo_pedido --------+-> fato_venda ---------\
dim_transporte_regra ----+                      +-> fato_venda_item
dim_plataforma_ecommerce/   dim_produto --------/

dim_grupo -----\
dim_subgrupo ---+-> dim_produto
dim_marca ------+
dim_categoria --/
```

- `fato_venda`: uma linha por registro interno de venda (`id_nota_saida`).
- `fato_venda_item`: uma linha por `(id_nota_saida, item)`, ideal para produtos,
  quantidades e valores vendidos.
- No vocabulario de negocio, **numero do pedido** e `marketplace_pedido`; o agente
  o apresenta como `numero_pedido`. `id_nota_saida` e apenas o identificador
  interno do registro, apresentado como `id_registro_venda`, e `id_nr_nf` e o
  numero da nota fiscal.
- As dimensoes podem ser consultadas sozinhas ou usadas para traduzir IDs em
  nomes nas fatos.

## Primeiro objeto: dim_produto

Grao: uma linha por `id_produto` atual.

Ligacoes:

- `produto.id_grupo -> grupo.id_grupo`
- `produto.id_subgrupo -> subgrupo.id_subgrupo`
- `produto.id_marca -> marca.id_marca`
- `produto.id_categoria -> categoria.id_categoria`

Os joins sao `LEFT JOIN`. Um cadastro auxiliar ausente e registrado nas
metricas de qualidade, mas nao elimina o produto.

As flags `inativo`, `disponivel` e `envia_site`, originalmente `T/F`, sao
convertidas para booleanos. `catalogo_site_ativo` significa que o produto nao
esta inativo, esta disponivel e esta configurado para envio ao site.

## Comandos

```powershell
npm run silver -- --listar
npm run silver -- --todos
npm run silver -- dim_produto

npm run consultar:silver -- --listar
npm run consultar:silver -- dim_produto --schema
npm run consultar:silver -- dim_produto --contar
npm run consultar:silver -- dim_produto --filtro grupo=ELETRODOMESTICO --limite 10
npm run agregar:silver -- dim_produto --agrupar grupo --contar --filtro produto_ativo=true --limite 10
```

Cada construcao gera:

```text
lake/silver/dim_produto/
  dt_processamento=AAAA-MM-DD/
    execucao=.../
      dados.parquet
      manifest.json
```

O manifesto e o marcador de sucesso. O leitor ignora Parquets sem um
`manifest.json` valido.

## Qualidade

A construcao falha antes de publicar o manifesto quando:

- a quantidade de produtos muda durante o join;
- `id_produto` esta nulo;
- existem chaves duplicadas;
- o schema produzido diverge do contrato.

Relacionamentos ausentes sao contabilizados no manifesto para diagnostico.

## Estado atual

- todas as tabelas Bronze disponiveis possuem uma dimensao ou fato Silver;
- os modelos sao construidos em ordem automatica com `--todos`;
- joins e chaves sao conferidos no manifesto de cada execucao;
- todos os objetos estao liberados pelas tools seguras do agente Nexus.

As tools seguras `consultar_silver` e `agregar_silver` ja estao conectadas ao
agente Nexus.

## Fato de venda por item

`fato_venda_item` possui uma linha por `(id_nota_saida, item)` e combina os
itens do Bronze com a `fato_venda` e a `dim_produto`. Ela separa
explicitamente `valor_liquido_unitario` de `valor_total_item`.

A fato pode ser consultada pelo terminal e pelo agente Nexus. O manifesto
registra inicio/fim da cobertura e quantos itens nao encontraram venda ou produto
correspondente.

## Exemplo completo: dim_transporte_regra

Este e o mesmo processo usado para criar uma dimensao nova.

### 1. A fonte continua no Bronze

`exportadores/postgres/entidades/transporte_regras.js` define a tabela, a chave
`id_transporte` e as colunas copiadas. O Bronze continua fiel a origem.

```powershell
npm run exportar -- transporte_regras
npm run consultar -- transporte_regras --schema
```

### 2. A dimensao define seu contrato

`silver/postgres/dimensoes/dim_transporte_regra.js` declara a chave, as colunas finais e a
politica de consulta. Ela limpa a descricao e preserva os criterios da regra,
como transportadora associada, plataforma, empresa, serie, UF, CEP e peso.

Exemplo simplificado da transformacao:

```sql
SELECT
  id_transporte,
  descricao AS transporte_regra,
  id_transportadora,
  plataformas,
  serie,
  uf
FROM transporte_regras_atual
```

### 3. O catalogo publica o objeto

`silver/catalogo.js` registra `dim_transporte_regra`. A partir desse registro, o
construtor conhece a dependencia e as tools passam a aceitar o objeto e suas
colunas aprovadas. Nao e necessario manter uma lista paralela nas tools.

### 4. A fato faz o LEFT JOIN

Uma transportadora pode ter varias regras. Por isso, `fato_venda.js` primeiro
agrupa as regras por `id_transportadora` e depois liga:

```sql
LEFT JOIN regras_por_transportadora tr
  ON tr.id_transportadora = nota_saida.id_transportadora
```

O campo `transporte_regras` concatena as descricoes quando existe mais de uma.
Isso preserva o pedido e impede que um join um-para-muitos multiplique a venda.
Uma chave sem regra aumenta `vendas_sem_regra_transporte_correspondente`.

### 5. Construir, conferir e consultar

```powershell
npm run silver -- --todos
npm run consultar:silver -- dim_transporte_regra --schema
npm run consultar:silver -- fato_venda --colunas id_nota_saida,data_pedido,id_transportadora,transporte_regras --limite 10
npm run agregar:silver -- fato_venda --agrupar transporte_regras --contar --limite 10
```

Na origem atual existem 63 regras e 58 transportadoras distintas. O join usa
`transporte_regras.id_transportadora`, pois e essa coluna que corresponde a
`nota_saida.id_transportadora`; `id_transporte` identifica a regra individual.

## Licao de qualidade: baseline de cliente

O primeiro baseline de `cliente` usava somente `dt_alteracao`. As metricas da
`fato_venda` mostraram pedidos com IDs sem correspondencia. A verificacao da
origem revelou clientes com `dt_alteracao` nula e `dt_cadastro` preenchida.

A entidade passou a usar os dois cursores:

```text
dt_alteracao dentro da janela OR dt_cadastro dentro da janela
```

Depois do backfill e da reconstrucao, `dim_cliente` ficou com 829.044 chaves
validas e `vendas_sem_cliente_correspondente` caiu para zero. Esse e o fluxo
esperado: a metrica detecta a lacuna, corrige-se a ingestao e o Silver e
reconstruido sem editar Parquet manualmente.
