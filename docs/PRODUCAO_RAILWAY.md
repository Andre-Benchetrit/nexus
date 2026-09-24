# Produção do Nexus no Railway

Este guia prepara a fundação de produção. O lake local continua oficial até a
migração do Sprint Produção 2.

## Topologia mínima

No ambiente `production`, mantenha os seguintes recursos:

| Recurso | Exposição | Comando |
|---|---|---|
| `nexus-hub` | domínio público | `npm run start --workspace @nexus/hub` |
| `nexus-api` | somente rede privada | `npm run nexus:api` |
| `nexus-lake-worker` | cron, sem domínio | `npm run lake:worker` |
| PostgreSQL | somente rede privada | serviço gerenciado Railway |
| `nexus-lake` | Bucket privado | credenciais S3 por referências |
| `nexus-runtime` | Volume na API | anexos, Knowledge, datasets e artefatos |

Configure o Hub com `NEXUS_API_INTERNAL_URL=http://nexus-api.railway.internal:3001`
e a API com `PORT=3001`. Use `npm run nexus:db:migrate` como comando de
pre-deploy da API.

O cron do Worker é `15 * * * *`. O processo inicia a cada hora, mas executa
somente a carga completa às 02h ou as cargas intradiárias configuradas. A agenda
do Railway usa UTC; a decisão final ocorre no código usando
`NEXUS_LAKE_WORKER_TIMEZONE`.

## Variáveis do Bucket

Crie referências do Bucket no serviço `nexus-api` e no `nexus-lake-worker`:

```env
NEXUS_LAKE_STORAGE=s3
NEXUS_LAKE_CONTROL=postgres
NEXUS_LAKE_PREFIX=nexus-lake
NEXUS_LAKE_S3_BUCKET=${{nexus-lake.BUCKET}}
NEXUS_LAKE_S3_ENDPOINT=${{nexus-lake.ENDPOINT}}
NEXUS_LAKE_S3_REGION=${{nexus-lake.REGION}}
NEXUS_LAKE_S3_ACCESS_KEY_ID=${{nexus-lake.ACCESS_KEY_ID}}
NEXUS_LAKE_S3_SECRET_ACCESS_KEY=${{nexus-lake.SECRET_ACCESS_KEY}}
NEXUS_LAKE_S3_URL_STYLE=virtual
NEXUS_LAKE_WORKER_ENABLED=0
```

Confirme na aba de credenciais do Bucket se a instância exige `virtual` ou
`path`. Não copie os valores das credenciais para o repositório.

Enquanto o Sprint 2 não for concluído:

- mantenha `NEXUS_LAKE_WORKER_ENABLED=0`;
- mantenha `NEXUS_LAKE_REQUIRE_DATA=0`;
- não exclua nem altere o lake local;
- não execute `npm run lake:atualizar` no Railway.

## Segredos e dados locais

- Gere `AUTH_SECRET` e `NEXUS_HUB_INTERNAL_SECRET` novos para produção.
- Use uma chave Anthropic de produção diferente da chave local.
- A App Registration de login pode ser reutilizada, desde que o callback de
  produção esteja explicitamente cadastrado.
- A aplicação Graph atual pode ser reutilizada com `Sites.Selected`.
- As credenciais do Sysemp podem ser compartilhadas inicialmente somente se
  forem estritamente de leitura.
- O PostgreSQL de produção nunca deve ser configurado no `.env` local.

Monte o Volume da API, por exemplo em `/data/nexus-runtime`, e configure nele as
raízes atuais de anexos, Knowledge, datasets e artefatos. O Bucket deste sprint
é exclusivo do lake.

## Validação antes da migração

Depois de aplicar as migrations e configurar o Bucket, execute manualmente no
serviço Worker:

```bash
npm run nexus:db:status
npm run nexus:db:health
npm run lake:storage:smoke
```

O smoke test cria um prefixo `_smoke/<uuid>`, publica um Parquet, consulta-o com
DuckDB, confere a integridade registrada e remove o prefixo. Ele não lê nem
grava dados corporativos.

## Migração do lake e corte de produção

O Sprint 2 usa dry-run por padrão e mantém o lake local intacto:

```bash
npm run lake:migrate -- --from ./lake
npm run lake:migrate -- --from ./lake --apply
npm run lake:migrate -- --from ./lake --apply --resume
npm run lake:validate -- --from ./lake
```

O migrador envia os dados antes do manifesto, confere tamanho e SHA-256 e não
sobrescreve snapshots. `--resume` aceita somente objetos cuja integridade seja
idêntica à origem. A validação compara todos os snapshots e abre o Parquet mais
recente de cada objeto tanto localmente quanto pelo S3.

Depois da validação, importe o estado e rode o próprio Worker manualmente:

```bash
npm run lake:state:import -- --from ./lake/_controle/estado.json
npm run lake:state:import -- --from ./lake/_controle/estado.json --apply
npm run lake:worker -- --run full
npm run lake:worker -- --run intraday
```

Somente após as duas execuções manuais terminarem com sucesso, configure
`NEXUS_LAKE_REQUIRE_DATA=1`, `NEXUS_LAKE_WORKER_ENABLED=1` e habilite o cron.

## Limpeza dos chats de pré-produção

Crie um backup verificado do PostgreSQL antes de executar:

```bash
npm run nexus:chats:cleanup
npm run nexus:chats:cleanup -- --apply --confirmation <token-do-dry-run>
```

O token fixa o instante e o conjunto de conversas do dry-run. A limpeza mantém
usuários, permissões, auditoria e conhecimento aprovado, mas remove mensagens,
anexos, artefatos e datasets dos chats existentes naquele instante. Falhas de
remoção física entram nas filas de limpeza.

Valide também:

- `/health/ready` na API;
- `GET /v1/admin/lake` por um administrador;
- ausência de chaves, URLs de banco ou segredos nos logs;
- Worker desativado até o corte do Sprint 2.

## Watermarks atuais

O importador é idempotente e começa em dry-run:

```bash
npm run lake:state:import -- --from "C:\caminho\lake\_controle\estado.json"
npm run lake:state:import -- --from "C:\caminho\lake\_controle\estado.json" --apply
```

A execução com `--apply` será feita somente no Sprint 2, imediatamente antes do
corte para o Bucket.
