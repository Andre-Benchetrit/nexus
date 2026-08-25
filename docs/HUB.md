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

Crie um ambiente de piloto separado com dois servicos apontando para o mesmo
repositorio:

- `nexus-hub`: Dockerfile `hub/Dockerfile`, porta 3000 e dominio publico;
- `nexus-api`: Dockerfile `services/nexus-api/Dockerfile`, porta 3001, somente
  rede privada e uma unica replica.

Anexe um volume ao servico da API em `/data/nexus-lake` e configure:

```env
NEXUS_LAKE_STORAGE=filesystem
NEXUS_LAKE_ROOT=/data/nexus-lake
NEXUS_LAKE_REQUIRE_DATA=1
NEXUS_LAKE_SCHEDULER_ENABLED=1
NEXUS_LAKE_INTRADAY_MINUTE=15
NEXUS_API_INTERNAL_URL=http://nexus-api.railway.internal:3001
NEXUS_AUTHZ_MODE=enforce
```

O agendador executa a carga completa diariamente as 02:00 e uma atualizacao
intradiaria no minuto 15 de cada hora, usando `America/Sao_Paulo`. Uma trava
PostgreSQL impede duas atualizacoes simultaneas.

O volume nao e preenchido durante o build. Depois do primeiro deploy, execute
uma carga completa no ambiente da API antes de liberar o readiness. Os
healthchecks sao:

```text
GET /health/live
GET /health/ready
```

O frontend expõe `GET /health`. Configure esse caminho como healthcheck do
serviço público. No primeiro deploy da API, mantenha
`NEXUS_LAKE_REQUIRE_DATA=0`, execute uma carga histórica diretamente das
fontes com `npm run lake:atualizar -- --inicio AAAA-MM-DD --forcar` no serviço
e só então altere para `1`.

## Lake portatil

`nexus/lake_storage.js` centraliza a localizacao, publicacao e verificacao dos
datasets. O adapter inicial e `FileSystemLakeStorage`; tools e leitores nao
dependem do caminho fisico. Uma migracao futura podera implementar um adapter
de Object Storage ou BigQuery sem alterar os contratos do Hub ou do agente.

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
