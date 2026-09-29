# Estado atual do Nexus

Atualizado em 29 de setembro de 2026.

Este documento e a referencia resumida do produto que existe no repositorio hoje.
Os demais guias explicam cada subsistema em mais detalhes. Uma capability estar
implementada nao significa que ela esteja habilitada em todos os ambientes: os
modos `off`, `shadow`, `read`, `local` e `v1` permitem liberar recursos de forma
gradual.

## O que e o Nexus

O Nexus e um assistente corporativo governado. Ele combina conversa geral,
dados internos, documentos da empresa, anexos do usuario e pesquisa publica sem
dar ao modelo acesso direto a bancos, arquivos ou credenciais.

O modelo interpreta a solicitacao e redige a resposta. O codigo continua sendo
responsavel por:

- autenticar o usuario e fixar o setor ativo;
- decidir quais fontes podem ser consultadas;
- autorizar cada capability;
- executar consultas e calculos locais;
- limitar o que chega a providers externos;
- validar evidencias, arquivos e resultados;
- registrar auditoria, custo e proveniencia.

A FID e a primeira implantacao. Sysemp, marca FID, setores e integracoes sao
configuracoes dessa implantacao, e nao dependencias obrigatorias do produto.

## Experiencia no Hub

O Hub e uma aplicacao Next.js autenticada pelo Microsoft Entra. A API Fastify
fica na rede privada e e a unica camada que acessa providers, banco operacional,
lake e volumes.

Cada mensagem pode usar um modo explicito:

| Modo | Comportamento |
|---|---|
| `Automatico` | Interpreta a intencao e escolhe entre resposta geral, dados, Knowledge ou web. |
| `Conhecimento geral` | Nao consulta Sysemp, web ou documentacao opcional. Politicas obrigatorias continuam valendo. |
| `Consultar dados` | Forca a rota corporativa autorizada. |
| `Verificar documentacao` | Consulta procedimentos, manuais e politicas publicados. |
| `Pesquisar na web` | Usa pesquisa publica governada e citada. |
| `Criar imagem` | Gera ou edita um projeto visual privado quando a Sprint 11 esta habilitada. |

O modo vale por uma mensagem e o compositor volta para `Automatico` depois do
envio. Retry preserva o modo e os anexos da tentativa original, cria uma nova
versao da resposta e nao usa a resposta descartada como contexto ativo.

## Capacidades disponiveis

### Conversa e roteamento

- conversa generalista com historico limitado e memoria governada;
- roteamento semantico validado por um registro de capabilities;
- continuacoes contextuais, como comparar um painel anterior com outro periodo;
- composicao de fontes quando uma pergunta exige, por exemplo, anexo e Sysemp;
- fallback entre providers sem repetir tools ja concluidas no mesmo turno;
- respostas com selo de proveniencia e trace para diagnostico.

Uma classificacao semantica nunca concede permissao. Modos explicitos,
governanca, seguranca e disponibilidade real das fontes continuam soberanos.

### Dados corporativos

- consultas somente leitura de vendas, faturamento, pedidos, produtos, estoque,
  ruptura, giro, reposicoes, frete, operacao, pessoas e indicadores;
- fachadas de negocio sobre Gold e Silver, com Bronze reservado a auditoria,
  historico e investigacao de divergencias;
- SQL assistido por `QuerySpec`, catalogo autorizado e validacao com `EXPLAIN`;
- calculos e filtros executados em codigo ou DuckDB, e nao confiados somente ao
  modelo;
- autorizacoes de dominio como `vendas.consultar`, `estoque.consultar` e
  `catalogo.consultar` revalidadas antes da leitura e da exportacao.

Na implantacao FID, as respostas corporativas devem identificar a fonte como
`Dados do Sysemp`, evitando apresentar Sysemp como se fosse o proprio Nexus.

### Knowledge corporativo

- sincronizacao de documentos publicados do OneDrive/SharePoint;
- importacao local controlada para preparacao e revisao;
- versoes, setor, estado editorial e acesso governado;
- busca lexical, estrutural e vetorial local;
- citacao por documento, versao, pagina ou secao;
- validacao obrigatoria de politicas separada da consulta documental opcional;
- download autenticado somente da fonte atualmente publicada quando o texto nao
  e suficiente ou o tutorial depende de prints.

Rascunhos e versoes em revisao nao aparecem nas respostas nem no download.

### Pesquisa web

- funciona como ferramenta de verificacao factual do agente, e nao apenas como
  uma pagina de resultados;
- o agente formula consultas de busca a partir da intencao real do usuario;
- conteudo principal das melhores fontes e recuperado, sanitizado e resumido;
- links da resposta precisam ter sido devolvidos pela pesquisa;
- informacoes internas e identificadores pessoais sao removidos antes da busca;
- temas fiscais ou juridicos priorizam fontes oficiais e deixam explicita a
  limitacao quando a regra nao pode ser confirmada.

### Imagens recebidas

- PNG, JPEG e WebP sao decodificados, reencodados e privados de EXIF;
- OCR, QR, codigo de barras e metadados seguros sao processados localmente;
- visao externa e opcional e exige permissao propria;
- sinais medicos, bancarios, credenciais, documentos de identidade e outros
  conteudos sensiveis bloqueiam envio externo.

### PDF, DOCX, XLS e XLSX

- validacao de assinatura real, estrutura Office, limites e conteudo ativo;
- PDF textual, digitalizado ou misto com OCR seletivo;
- DOCX com titulos, paragrafos, listas, tabelas e imagens ligadas as secoes;
- XLS e XLSX com abas, tipos, formulas, valores armazenados e nomes definidos;
- deteccao de cabecalho real em relatorios com capas ou linhas iniciais;
- comparacoes, contagens, agrupamentos, duplicidades, ausencias e joins locais;
- referencias verificaveis por pagina, secao, tabela, aba, intervalo ou celula.

O upload cria uma representacao canonica (`Attachment IR`) reutilizavel. O banco
guarda hashes, localizadores e metadados seguros; o conteudo integral fica em
derivados comprimidos no volume. O prompt recebe apenas evidencias relevantes e
limitadas. Texto do arquivo e sempre `untrusted_attachment_evidence`: nao pode
alterar intencao, selecionar tools, conceder acesso ou iniciar acoes.

### Arquivos gerados

- XLSX com multiplas abas, filtros, congelamento, formatos, formulas permitidas,
  formatacao condicional e graficos locais;
- DOCX para relatorios, memorandos e procedimentos;
- PDF final para leitura ou impressao;
- identidade visual configuravel por implantacao;
- reabertura e validacao do binario antes da entrega;
- armazenamento privado na conversa, com classificacao herdada das fontes.

Nenhum arquivo gerado entra automaticamente no Knowledge ou no OneDrive.

### Geracao conversacional de imagens

A Sprint 11 esta implementada na branch de trabalho e deve ser considerada
**beta ate migration, configuracao, deploy e smoke test de producao**.

- provider OpenAI separado do generalista principal;
- criacao, variacao e edicao por conversa;
- formatos quadrado, retrato, story e paisagem;
- saida PNG, JPEG ou WebP;
- imagem-base achatada com logo, textos e formas como camadas independentes;
- modos de marca `none`, `visual_identity` e `full_brand`;
- logo opcional, sempre carregada do arquivo oficial;
- mudanca de posicao ou tamanho da logo sem regenerar o fundo;
- versoes navegaveis, preview autenticado, download e selo de rascunho;
- cotas por turno e por dia.

O editor visual de arrastar camadas e a edicao de objetos internos da imagem-base
nao fazem parte da versao atual.

## Governanca e isolamento

- login pelo Microsoft Entra;
- usuario e conversa vinculados a setores;
- papeis, permissoes e overrides individuais;
- autorizacao antes de cada tool, sintese, exportacao e download;
- isolamento de anexos, cache, conversas e artefatos por principal;
- DLP e classificacao aplicados antes de providers externos;
- memoria somente por candidatura, revisao e publicacao governada;
- auditoria sanitizada de rota, tool, provider, tokens, custo, duracao e origem;
- banco e logs nao armazenam prompts completos, resultados corporativos brutos,
  credenciais ou conteudo integral dos anexos.

## Arquitetura e producao

```text
Hub Next.js publico
  -> API Fastify privada
     -> PostgreSQL operacional (identidade, chats, governanca e auditoria)
     -> Lake Bronze/Silver/Gold em Parquet
     -> DuckDB e tools somente leitura
     -> Volume persistente (anexos, Knowledge, datasets e artefatos)
     -> providers de LLM, web, visao e imagem sob autorizacao

Worker isolado
  -> atualiza o lake
  -> publica snapshots atomicos no Bucket S3
  -> grava lock, watermarks e execucoes no PostgreSQL
```

Em desenvolvimento, o lake pode usar `filesystem`. Em producao, o adapter S3
publica o manifesto por ultimo, portanto um upload parcial nunca se torna um
snapshot consultavel. A API nao executa o scheduler do lake; somente o Worker
adquire o advisory lock e atualiza os dados.

O Volume da API e o Bucket do lake tem responsabilidades diferentes. O Bucket
armazena o lake. O Volume persistente guarda arquivos privados usados pelo Hub.
Com storage local, a API deve operar com uma unica replica ou com um backend
realmente compartilhado.

## O que o Nexus nao faz hoje

- nao escreve no Sysemp nem executa transacoes nos bancos de origem;
- nao executa macros, JavaScript de PDF, objetos OLE, links externos ou formulas
  recebidas em planilhas;
- nao aceita DOC, XLSM, DOCM ou PowerPoint no pipeline de anexos;
- nao preserva o layout original ao editar Word, Excel ou PDF existentes;
- nao publica arquivos automaticamente no OneDrive ou no Knowledge;
- nao transforma resposta juridica, fiscal, medica ou financeira em parecer
  profissional definitivo;
- nao compartilha cache ou arquivo privado entre usuarios;
- nao possui ainda canvas visual de arrastar/redimensionar;
- nao garante disponibilidade de uma capability configurada como `off` ou ainda
  nao liberada no ambiente.

## Status por configuracao

| Area | Variavel principal | Valores relevantes |
|---|---|---|
| Autorizacao | `NEXUS_AUTHZ_MODE` | `audit`, `enforce` |
| Roteador | `NEXUS_ROUTER_MODE` | `legacy`, `shadow`, `v2` |
| Web | `NEXUS_WEB_MODE` | `off`, `shadow`, `v1` |
| Imagens recebidas | `NEXUS_IMAGE_MODE` | `off`, `local`, `v1` |
| Arquivos recebidos | `NEXUS_FILES_MODE` | `off`, `read`, `v1` |
| Inteligencia de anexos | `NEXUS_ATTACHMENT_INTELLIGENCE_MODE` | `off`, `shadow`, `v1` |
| Arquivos gerados | `NEXUS_ARTIFACTS_MODE` | `off`, `shadow`, `v1` |
| Imagens geradas | `NEXUS_IMAGE_GENERATION_MODE` | `off`, `shadow`, `v1` |
| Datasets temporarios | `NEXUS_DATASETS_MODE` | `off`, `shadow`, `v1` |
| Knowledge | `NEXUS_KNOWLEDGE_MODE` | `off`, `shadow`, `v1` |
| Lake | `NEXUS_LAKE_STORAGE` | `filesystem`, `s3` |

Use [.env.example](../.env.example) como contrato de configuracao e nunca copie
o `.env` local inteiro para producao.

## Guias relacionados

- [Arquitetura](ARQUITETURA.md)
- [Hub](HUB.md)
- [Governanca](GOVERNANCA.md)
- [Knowledge](CONHECIMENTO.md)
- [Pesquisa web e imagens](WEB_E_IMAGENS.md)
- [Producao no Railway](PRODUCAO_RAILWAY.md)
- [Comandos](COMANDOS.md)

