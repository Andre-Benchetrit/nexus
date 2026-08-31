# Base de conhecimento documental

O Nexus trata procedimentos, politicas e manuais como conhecimento governado, nao como anexos livres do chat. O OneDrive continua sendo a origem oficial dos arquivos importados; o PostgreSQL operacional guarda metadados, versoes, paginas, chunks e estados de revisao. Os binarios ficam no `KnowledgeAssetStorage`.

## Regra de acesso

A autorizacao acontece antes da busca. Uma conversa recebe somente:

- documentos globais publicados;
- documentos publicados do setor ao qual o chat esta vinculado.

Nem titulo, trecho ou existencia de documento de outro setor e entregue ao roteador ou ao modelo. Administradores tambem consultam no chat apenas o setor ativo mais o conteudo global.

Papeis:

- usuario e analista: consulta textual e visual autorizada;
- gestor: cria, importa, edita e publica no proprio setor;
- auditor: consulta historico operacional;
- administrador: administra qualquer setor, politicas e manuais globais.

## Ciclo de vida

```text
rascunho -> em revisao -> publicado -> substituido
```

Uma alteracao externa no OneDrive cria uma nova versao em revisao. Se ja houver versao publicada, ela continua respondendo ate a nova publicacao. A publicacao gera representacoes DOCX e PDF, indexa o texto e registra o responsavel.

Politicas globais recebem precedencia de recuperacao. Semelhanca entre uma politica global e um procedimento setorial e apresentada ao publicador como conflito potencial; ela nao e resolvida silenciosamente pela IA.

## Importacao inicial

1. Aplique as migrations.
2. Use o ator tecnico `knowledge-sync`, criado pelas migrations somente com as permissoes documentais necessarias.
3. Para a copia sincronizada local do OneDrive:

```powershell
npm run nexus:knowledge:import-local -- "C:\caminho\para\PROCEDIMENTOS"
```

4. Para Microsoft Graph, configure `FID_ONEDRIVE_DRIVE_ID` com o ID da biblioteca do
   SharePoint/OneDrive e use `NEXUS_KNOWLEDGE_ONEDRIVE_SOURCES_JSON` para declarar as fontes:

```env
NEXUS_KNOWLEDGE_ONEDRIVE_SOURCES_JSON=[{"key":"procedimentos","rootItemId":"ID_DA_PASTA"},{"key":"politica-global","itemId":"ID_DO_ARQUIVO","tipo":"politica","escopo":"global"}]
```

Uma fonte com `rootItemId` ou `rootPath` percorre a pasta recursivamente. Pastas como
`PROCEDIMENTOS FINANCEIRO` e `PROCEDIMENTOS TECNOLOGIA` determinam o setor antes da
ingestao. Uma fonte com `itemId` representa um arquivo exato e exige `tipo` e `escopo`;
se o escopo for `setor`, tambem exige `setorSlug`.

As configuracoes singulares `NEXUS_KNOWLEDGE_ONEDRIVE_ROOT_ITEM_ID` e
`NEXUS_KNOWLEDGE_ONEDRIVE_ROOT_PATH` continuam aceitas quando o catalogo plural estiver
vazio. Em seguida, execute:

```powershell
npm run nexus:knowledge:sync
```

Toda carga inicial entra na fila de revisao. Repetir a importacao nao duplica a mesma versao:
o Nexus compara a identidade externa e o checksum. Ao substituir uma importacao local pela
origem Graph, ele reconcilia caminho/checksum e preserva o documento e seu historico.

## Texto, imagens e busca

- PDF preserva a pagina real para citacoes.
- DOCX/DOTX preserva texto e detecta imagens, mas sua paginacao e marcada como nao preservada.
- Paginas PDF com screenshots e imagens incorporadas em Word sao renderizadas localmente somente quando solicitadas.
- A busca combina full-text, similaridade de titulo e embedding local de 384 dimensoes.
- `multilingual-e5-small` e o modo recomendado. O modo `hash` existe para desenvolvimento sem download de modelo.

O modelo recebe somente os trechos autorizados e suas citacoes. Uma pagina visual exige a permissao `documentacao.visual.consultar`; a interpretacao externa tambem exige `ia.imagem.interpretar`. Configure `NEXUS_KNOWLEDGE_VISION_MODEL` para ativar essa etapa, limitada por padrao a duas paginas relevantes.

## Hub

Gestores e administradores encontram **Base de conhecimento** no painel. A tela permite:

- criar conteudo estruturado;
- importar PDF, DOCX ou DOTX para revisao;
- editar uma nova versao sem retirar a atual do ar;
- enviar para revisao;
- publicar e baixar DOCX/PDF.

O chat consulta a tool `consultar_documentacao` e responde com citacoes no formato `Documento - versao N, pagina P`.
