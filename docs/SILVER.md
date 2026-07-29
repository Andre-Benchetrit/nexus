# Camada Silver

A camada Silver transforma os dados brutos do Bronze em conjuntos prontos para
uso de negocio. Ela nao substitui nem altera o Bronze: sempre pode ser
reconstruida a partir dele.

Os modelos ficam organizados pela fonte de origem. Os objetos derivados do
PostgreSQL estao em:

```text
silver/postgres/
  core/
    regras_venda.js
    util.js
  dimensoes/
    dim_cliente.js
    dim_funcionario.js
    dim_transportadora.js
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
    fato_pedido.js
    fato_pedido_item.js
    fato_nota_fiscal.js
    fato_nota_fiscal_item.js
    fato_estoque_atual.js
    fato_movimento_estoque.js
onedrive/
  fatos/
    fato_agendamento_compra.js
```

## Fluxo

```text
PostgreSQL/OneDrive -> Bronze -> DuckDB (limpeza e joins)
                    -> Silver (Parquet validado) -> tools -> agentes
```

Uma tabela nova entra primeiro no Bronze. A partir dela, o Silver gera dimensoes
e fatos enriquecidas. Isso preserva a origem para auditoria e reprocessamento.

## Agendamentos de compra

`fato_agendamento_compra` preserva uma linha por parcela da aba `BASE`. Mantem
somente cinco meses pela data prevista e relaciona produto primeiro por
`id_produto`, usando SKU apenas como alternativa.

NF de entrada, data de entrada e quantidade recebida prevalecem sobre a anotacao
manual do fornecedor. Os estados sao `PREVISTO`, `ATRASADO`, `NAO_RECEBIDO`,
`RECEBIDO_PARCIAL` e `RECEBIDO`.

Quando `data_entrada_original` esta no futuro em relacao a extracao e a inversao
dia/mes produz uma data valida ate a extracao, o Silver usa a data corrigida e
marca `data_entrada_corrigida_dia_mes=true`. A data original permanece publicada
para auditoria.

As parcelas nao sao consolidadas no fato. A soma acontece apenas na tool de
reposicoes quando a pergunta solicita quantidade. A operacao
`ultimo_recebimento` consolida excepcionalmente todas as parcelas do produto na
data de entrada mais recente e apresenta todos os pedidos e NFs. O campo
`afeta_estoque_oficial` e sempre falso: estoque disponivel continua vindo
exclusivamente do Sysemp.

## Graos de venda

```text
nota_saida PD -----------------> fato_pedido ---------> fato_pedido_item
nota_saida NF autorizada ------> fato_nota_fiscal ----> fato_nota_fiscal_item
nota_saida sem filtro ---------> fato_venda ----------> fato_venda_item
```

- `fato_pedido`: uma linha por pedido PD, identificado por
  `(id_empresa, id_pedido_vda_importado)`. E a fonte correta para quantidade,
  situacao, plataforma e valor de pedidos.
- `fato_pedido_item`: itens pertencentes aos documentos PD. E a fonte correta
  para valor e quantidade de produtos pedidos.
- `fato_nota_fiscal`: uma linha por documento fiscal emitido valido. E a fonte
  correta para quantidade e valor de notas e faturamento.
- `fato_nota_fiscal_item`: itens das notas fiscais emitidas validas. E a fonte
  correta para produto, marca, custo e margem do faturamento.
- `fato_venda` e `fato_venda_item`: visoes amplas no grao de documento da
  origem. Continuam disponiveis para auditoria e localizacao de registros, mas
  nao devem ser usadas para contar pedidos ou calcular faturamento oficial.
- No vocabulario de negocio, **numero do pedido** e `marketplace_pedido`; o agente
  o apresenta como `numero_pedido`. `id_nota_saida` e apenas o identificador
  interno do registro, apresentado como `id_registro_venda`, e `id_nr_nf` e o
  numero da nota fiscal.

As regras comuns de PD, nota autorizada, devolucao, cancelamento fiscal e sufixo
reverso ficam centralizadas em `silver/postgres/core/regras_venda.js`. Assim,
uma correcao de negocio nao precisa ser repetida em cada fato.

### Ligacao entre pedido, nota e devolucao

Pedido, nota fiscal e devolucao sao registros separados na origem. A ligacao
principal usa `(id_empresa, id_pedido_vda_importado)`, e nao apenas o texto de
`marketplace_pedido`.

`fato_pedido` classifica cada pedido como:

- `FATURADO`;
- `PENDENTE`;
- `CANCELADO`;
- `DEVOLVIDO`, quando existe documento DV ligado ao pedido;
- `CANCELADO_FISCAL`, quando a nota possui cancelamento fiscal;
- `FATURADO_COM_STATUS_CANCELADO`, quando o PD esta cancelado, mas ainda existe
  NF autorizada sem DV ou cancelamento fiscal encontrado.

O ultimo estado e preservado como conflito de origem. Ele nao e corrigido
silenciosamente e ainda depende da definicao oficial do negocio.

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

- um join multiplica indevidamente o grao declarado;
- alguma parte obrigatoria da chave primaria esta nula;
- existem chaves duplicadas;
- o schema produzido diverge do contrato.

Relacionamentos ausentes e reducoes intencionais de linhas em fatos filtradas
sao contabilizados no manifesto para diagnostico.

## Estado atual

- todas as tabelas Bronze disponiveis possuem uma dimensao ou fato Silver;
- os modelos sao construidos em ordem automatica com `--todos`;
- joins e chaves sao conferidos no manifesto de cada execucao;
- objetos aprovados sao publicados automaticamente para as tools genericas.

As tools seguras `consultar_silver` e `agregar_silver` ja estao conectadas ao
agente Nexus.

## Fatos de item

`fato_venda_item` possui uma linha por `(id_nota_saida, item)` e combina os
itens do Bronze com a `fato_venda` e a `dim_produto`. Ela separa
explicitamente `valor_liquido_unitario` de `valor_total_item`.

Para analise de negocio, prefira `fato_pedido_item` ou
`fato_nota_fiscal_item`, conforme a pergunta seja sobre pedidos ou faturamento.
Os manifestos registram inicio/fim da cobertura e quantos itens nao encontraram
cabecalho ou produto correspondente.

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

Quando `nota_saida.id_regra_transporte` esta preenchido, a fato liga diretamente
a regra:

```sql
LEFT JOIN dim_transporte_regra tr
  ON tr.id_transporte = nota_saida.id_regra_transporte
```

Isso preserva uma unica regra por documento e impede que transportadoras com
varias regras multipliquem a venda. O nome descritivo sai em
`transporte_regra`.

### 5. Construir, conferir e consultar

```powershell
npm run silver -- --todos
npm run consultar:silver -- dim_transporte_regra --schema
npm run consultar:silver -- fato_pedido --colunas marketplace_pedido,data_pedido,id_transportadora,transporte_regra,status_pedido --limite 10
npm run agregar:silver -- fato_pedido --agrupar transporte_regra --contar --limite 10
```

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

### Clientes, funcionarios e transportadoras

A tabela `sysemp.cliente` tambem armazena pessoas operacionais. O Nexus usa as
flags nativas da origem, sem restringir `id_empresa`:

- `funcionario_vend = 'T'` alimenta `dim_funcionario`;
- `transportadora = 'T'` alimenta `dim_transportadora`;
- `dim_cliente` preserva todas as chaves necessarias para relacionar compradores
  aos pedidos.

O Bronze de `cliente` possui uma projecao explicita de atributos de negocio.
CPF, salario, contas bancarias e outros campos pessoais nao entram em novas
extracoes. As dimensoes operacionais publicam somente nome, empresa, situacao e
classificadores necessarios.
