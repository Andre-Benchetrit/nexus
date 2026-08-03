# OneDrive como fonte do lake

## Decisao de arquitetura

O Nexus nao consulta o OneDrive durante uma pergunta do agente. O Microsoft
Graph e usado somente pela ingestao:

```text
Microsoft 365 -> Bronze -> Silver -> Gold -> tools do Nexus
```

Isso evita latencia e dependencia externa durante as consultas. A governanca
dos usuarios sera aplicada pelo Nexus sobre os dados ja publicados no lake.

## Conexoes cadastradas

| ID interno | Nome exibido | Finalidade |
|---|---|---|
| `fid_onedrive` | `FID - ONEDRIVE` | biblioteca corporativa compartilhada |
| `automacoes_onedrive` | `AUTOMAÇÕES - ONEDRIVE` | OneDrive da conta usada pelo N8N |

Os IDs internos nao possuem espacos ou acentos para permanecerem estaveis no
codigo. Os nomes exibidos podem ser alterados sem quebrar as entidades.

As duas conexoes usam a mesma aplicacao corporativa no Microsoft Entra. Cada
entidade informa a conexao, o drive e o arquivo que pode consumir.

## Autenticacao

O processo usa `client_credentials`: uma aplicacao autentica em segundo plano,
sem popup e sem depender de uma sessao de usuario. Durante o desenvolvimento,
as credenciais ficam apenas no `.env`, que e ignorado pelo Git:

```dotenv
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

Em producao, o segredo deve ser substituido por certificado ou por um cofre de
segredos. O codigo nunca registra nem devolve `clientSecret` ou access token.

### Cadastro no Microsoft Entra

1. Abra Microsoft Entra admin center.
2. Acesse **App registrations** e crie `Nexus Lake Sync`.
3. Escolha **Accounts in this organizational directory only**.
4. Nao e necessario cadastrar Redirect URI para esse fluxo.
5. Copie o **Application (client) ID** e o **Directory (tenant) ID**.
6. Crie um segredo temporario em **Certificates & secrets**.
7. Conceda e aprove as permissoes de aplicacao necessarias.

Para producao, prefira permissoes selecionadas:

- `Sites.Selected` para a biblioteca compartilhada;
- `Files.SelectedOperations.Selected` para o arquivo ou pasta privada;
- evite manter `Files.Read.All`, pois ela permite ler todos os arquivos
  acessiveis no tenant.

As permissoes `Selected` exigem duas etapas: consentimento administrativo para
a aplicacao e uma concessao explicita no site, pasta ou arquivo escolhido.

## Configuracao das origens

Copie apenas os campos Microsoft de `.env.example` para o `.env`.

Biblioteca compartilhada:

```dotenv
FID_ONEDRIVE_SITE_HOST=
FID_ONEDRIVE_SITE_PATH=
FID_ONEDRIVE_SITE_ID=
FID_ONEDRIVE_DRIVE_ID=
```

Conta de automacoes:

```dotenv
AUTOMACOES_ONEDRIVE_USUARIO=
AUTOMACOES_ONEDRIVE_DRIVE_ID=
```

Depois da descoberta, prefira manter o `DRIVE_ID`. Ele e mais estavel que nome,
email ou caminho.

## Comandos

Verifique quais campos ja estao configurados. O comando nao exibe segredos:

```powershell
npm run onedrive:status
npm run onedrive:status -- --conexao automacoes_onedrive
npm run onedrive:status -- --conexao automacoes_onedrive --testar
```

Descubra o site e os drives compartilhados:

```powershell
npm run onedrive:descobrir -- --conexao fid_onedrive `
  --host "empresa.sharepoint.com" `
  --site-path "sites/NomeDoSite"
```

Descubra o drive da conta de automacoes depois de configurar o email:

```powershell
npm run onedrive:descobrir -- --conexao automacoes_onedrive
```

Liste a raiz, uma pasta por caminho ou uma pasta por ID:

```powershell
npm run onedrive:listar -- --conexao automacoes_onedrive
npm run onedrive:listar -- --conexao automacoes_onedrive --caminho "Compras"
npm run onedrive:listar -- --conexao automacoes_onedrive --item "ID_DA_PASTA"
```

Busque um arquivo:

```powershell
npm run onedrive:buscar -- --conexao automacoes_onedrive `
  --termo "Agendamento"
```

As permissoes de acesso aos arquivos sao concedidas fora do Nexus, por um
administrador. O cliente Microsoft Graph do projeto aceita somente requisicoes
`GET` e `HEAD`; operacoes de criacao, edicao e exclusao sao bloqueadas no codigo.

## Fonte inicial

O contrato inicial esta em
`exportadores/onedrive/entidades/agendamento_compra.js`.

Ele permanece com automacao desabilitada ate confirmarmos:

- linha do cabecalho;
- colunas e aliases obrigatorios;
- chave de negocio;
- significado de quantidade, status e previsao.

A aba oficial da fonte e `BASE` e esta fixada no contrato da entidade.

Depois da descoberta do arquivo:

```dotenv
ONEDRIVE_AGENDAMENTO_COMPRA_ITEM_ID=
```

Para sincronizar manualmente:

```powershell
npm run onedrive:sincronizar
npm run onedrive:sincronizar -- --forcar
```

Quando o contrato estiver validado, a entidade sera habilitada e entrara
automaticamente em `npm run lake:atualizar`.

## O que o Bronze grava

Cada versao alterada gera:

```text
lake/bronze/onedrive/agendamento_compra/
  dt_extracao=AAAA-MM-DD/
    execucao=.../
      origem.xlsx
      dados.parquet
      manifest.json
```

O manifesto registra conexao, `driveId`, `itemId`, `eTag`, nome, tamanho,
data de modificacao, aba, cabecalhos e SHA-256. Tokens e segredos nao entram no
manifesto.

Antes de baixar, o adaptador compara a `eTag` com o ultimo manifesto. Arquivos
inalterados sao reutilizados. O `itemId` e usado como identificador principal,
portanto uma simples mudanca de nome nao exige reconfiguracao.

## Validacoes

- apenas `.xlsx` e aceito nesta primeira versao;
- tamanho maximo padrao de 100 MB;
- aba inexistente interrompe a publicacao;
- cabecalho vazio ou duplicado interrompe a publicacao;
- colunas obrigatorias ausentes interrompem a publicacao;
- o manifesto e gravado por ultimo e funciona como marcador de sucesso;
- a conversao DuckDB roda em processo separado para liberar arquivos
  corretamente no Windows.

## Estado da fonte de agendamentos

- aplicacao Entra e acesso selecionado configurados;
- cliente Graph bloqueia qualquer metodo diferente de `GET` e `HEAD`;
- aba oficial `BASE` e contrato de colunas validados;
- entidade Bronze habilitada na automacao;
- `fato_agendamento_compra` publica cinco meses de parcelas no Silver;
- Gold de rupturas recebe apenas sinais logisticos, sem somar compras ao estoque;
- `analisar_reposicoes` lista parcelas, soma sob solicitacao e consolida o ultimo
  recebimento do produto por dia, preservando pedidos e NFs;
- datas de entrada futuras causadas por inversao dia/mes sao corrigidas no
  Silver com a data original e uma flag de auditoria.
- cada linha Bronze recebe conexao, item, arquivo, aba e numero fisico da linha;
  essa origem forma a chave tecnica Silver. O `INDEX` da planilha e preservado
  apenas para auditoria, pois pode ser reutilizado em parcelas diferentes.

A proxima origem planejada e a biblioteca compartilhada `FID - ONEDRIVE`.
