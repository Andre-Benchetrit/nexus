# Hub Nexus

O Hub Nexus e a interface web corporativa do agente. Ele possui um frontend
Next.js publico e uma API Fastify acessivel apenas pela rede privada do
Railway. O navegador nunca recebe chaves de providers nem pode escolher
principal, setor, sessao ou trace.

## Desenvolvimento local

1. Aplique as migrations e cadastre o primeiro administrador:

```powershell
npm run nexus:db:migrate
npm run nexus:hub:bootstrap-admin -- --email administrador@empresa.com --nome "Administrador Nexus"
```

2. Cadastre uma App Registration Microsoft Entra exclusiva para o Hub. Use o
callback `http://localhost:3000/api/auth/callback/microsoft-entra-id` e apenas
os escopos OIDC `openid`, `profile` e `email`.

3. Configure as variaveis `NEXUS_HUB_*`, `AUTH_SECRET` e
`NEXUS_API_INTERNAL_URL` no `.env` unico da raiz, conforme `.env.example`.
O workspace `hub` carrega esse arquivo automaticamente em desenvolvimento;
nao crie uma segunda copia em `hub/.env.local`.

4. Execute em terminais separados:

```powershell
npm run nexus:api
npm run nexus:hub
```

O Hub usa `NEXUS_AUTHZ_MODE=enforce` na execucao das conversas mesmo que o CLI
continue configurado em `audit`.

## Railway

Crie um ambiente de piloto separado com tres servicos apontando para o mesmo
repositorio:

- `nexus-hub`: Dockerfile `hub/Dockerfile`, porta 3000 e dominio publico;
- `nexus-api`: Dockerfile `services/nexus-api/Dockerfile`, porta 3001, somente
  rede privada;
- `nexus-lake-worker`: processo sem dominio, iniciado pelo cron do Railway.

O lake produtivo usa um Bucket privado e o controle de execucao usa PostgreSQL:

```env
NEXUS_LAKE_STORAGE=s3
NEXUS_LAKE_CONTROL=postgres
NEXUS_LAKE_PREFIX=nexus-lake
NEXUS_LAKE_WORKER_ENABLED=0
NEXUS_API_INTERNAL_URL=http://nexus-api.railway.internal:3001
NEXUS_AUTHZ_MODE=enforce
```

Configure o cron do Worker como `15 * * * *`. O processo decide pelo fuso
`America/Sao_Paulo` se deve executar a carga das 02:00, uma carga intradiaria
entre 08:00 e 22:00, ou encerrar sem processar. A API nao possui agendador
embutido. Uma trava PostgreSQL impede duas atualizacoes simultaneas.

Neste primeiro sprint, mantenha o Worker desativado e o lake local como fonte
oficial. O Volume da API continua reservado aos anexos, Knowledge, datasets e
artefatos; ele nao e substituido pelo Bucket. Os healthchecks sao:

```text
GET /health/live
GET /health/ready
```

O frontend expõe `GET /health`. Configure esse caminho como healthcheck do
serviço público. Consulte [PRODUCAO_RAILWAY.md](PRODUCAO_RAILWAY.md) para as
variáveis S3, o smoke test e o corte planejado para o Sprint Produção 2.

## Lake portatil

`nexus/lake_storage.js` centraliza a localizacao, publicacao e verificacao dos
datasets. Os adapters `FileSystemLakeStorage` e `S3LakeStorage` compartilham o
mesmo contrato; tools e leitores nao dependem do caminho fisico. A troca entre
filesystem e Object Storage nao altera os contratos do Hub ou do agente.

## Niveis de composicao

- `baixo`: conciso, sem impedir elevacao automatica;
- `medio`: padrao equilibrado;
- `alto`: no minimo faixa assistida;
- `extra_alto`: no minimo faixa avancada.

Alto e Extra-alto dependem de permissoes especificas. O nivel escolhido nunca
reduz seguranca, autorizacao ou exigencia de evidencia.

## Dependência nativa do DuckDB

O `npm audit` ainda reporta alertas na cadeia de instalação do `duckdb`
(`node-gyp`, `tar` e auxiliares). Esses módulos não processam entradas das
rotas do Hub em tempo de execução. O `tar` compatível foi atualizado, mas a
eliminação integral dos avisos depende de uma versão do driver DuckDB com
toolchain atualizada ou da migração planejada para um provider lakehouse.
Não force versões incompatíveis de `node-gyp` no Railway.
