# Governança e banco operacional do Nexus

O Nexus usa um PostgreSQL operacional próprio para identidade, autorização,
memória e auditoria. Ele é independente do PostgreSQL empresarial `sysemp` e
das camadas Bronze, Silver e Gold.

## Configuração

```env
NEXUS_DATABASE_URL=postgresql://...
NEXUS_MEMORY_BACKEND=postgres
NEXUS_AUTHZ_MODE=audit
NEXUS_DB_POOL_MAX=10
NEXUS_DB_CONNECT_TIMEOUT_MS=10000
```

`NEXUS_AUTHZ_MODE` aceita `off`, `audit` ou `enforce`. Em `audit`, decisões
negativas são registradas como `would_deny`, mas o CLI continua funcionando.
Até o login Microsoft ser implantado, o CLI usa o ator técnico `legacy-cli` e
esse é o modo recomendado.

## Banco e migrations

```powershell
npm run nexus:db:health
npm run nexus:db:migrate
npm run nexus:db:status
npm run nexus:audit:status
```

As migrations são transacionais, possuem checksum e usam trava consultiva no
PostgreSQL. Uma migration aplicada nunca deve ser editada; crie outra migration.
Elas não são executadas automaticamente ao iniciar o agente.

## Memória

```powershell
npm run nexus:memory:import
npm run nexus:memory:verify
npm run nexus:memory:export-knowledge
```

A importação lê `memoria/.runtime/` e `memoria/conhecimento.json`, associa o
legado a `legacy-cli` e não modifica os arquivos. Checksum e chaves de origem
permitem repetir a operação sem duplicar interações.

O PostgreSQL conserva todo o histórico factual. O contexto enviado ao modelo
continua limitado às interações recentes configuradas em
`NEXUS_SESSION_HISTORY_LIMIT`.

## Auditoria de IA

A auditoria de IA usa tabelas dedicadas para turnos, chamadas de modelo e itens
de custo. Mensagens visiveis ficam em `conversation_messages`, separadas da
telemetria operacional. `NEXUS_USAGE_POLICY_MODE=observe` e independente de
`NEXUS_AUTHZ_MODE`: o primeiro prepara governanca de consumo; o segundo autoriza
capabilities e tools.

## Modelo de acesso

Uma pessoa pode pertencer a mais de um setor e receber papéis globais ou por
setor. Exceções individuais podem permitir ou negar uma permissão e expirar.
A ordem aplicada é: principal inativo, negação individual, permissão individual,
papel global, papel do setor e ausência de concessão.

As identidades Microsoft serão ligadas por `tenant_id` e `subject_id`; senhas e
tokens Microsoft não são armazenados no banco operacional.

A auditoria não guarda perguntas, respostas, SQL ou argumentos brutos. Ela
registra ator, sessão, permissão, tool, camada, decisão, duração, provider/modelo,
nomes das chaves dos argumentos e códigos de erro sanitizados.
