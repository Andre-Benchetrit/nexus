# Nexus — Plataforma de Inteligência Governada

O Nexus é uma plataforma de inteligência governada para operações e serviços. Ele une dados internos, IA generalista, pesquisa web citada e análise local de imagens em uma experiência em que a IA interpreta a pergunta, mas o código conserva a autoridade sobre dados, permissões, tools, custos e evidências.

A FID é a primeira implantação corporativa do projeto, não uma limitação da arquitetura. Fontes, regras de negócio, identidade visual, setores, permissões, providers e catálogo semântico podem ser adaptados para cada organização ou oferta de serviço.

O projeto possui duas formas de uso:

- **CLI**, para operação, desenvolvimento e validação técnica;
- **Hub web**, para colaboradores autenticados pela Microsoft, com chats, setores, composição de resposta e painel administrativo.

## Visão geral

```text
Fontes corporativas (PostgreSQL, OneDrive e integrações)
  → Bronze / Silver / Gold em Parquet
  → DuckDB e fachadas de negócio seguras
  → roteador híbrido + protocolo de interação
  → IA corporativa e generalista
  → API Fastify → Hub Next.js

PostgreSQL operacional separado
  → identidade, permissões, conversas, memória, auditoria e custos
```

O PostgreSQL operacional não substitui o lake nem os bancos de origem. Ele guarda o estado transacional do Nexus: usuários, setores, sessões, tarefas interativas, mensagens visíveis, memória governada e telemetria sanitizada. Na implantação FID, `sysemp` é a primeira origem PostgreSQL modelada.

## O que o Nexus faz hoje

- Consulta vendas, faturamento, pedidos, bloqueios, estoque, reposições, frete, operação e pessoas através de fachadas de negócio.
- Usa Bronze somente para auditoria, histórico ou divergência; Gold e Silver são liberados apenas quando uma capacidade realmente não existe na fachada adequada.
- Gera SQL PostgreSQL somente leitura por meio de um catálogo autorizado e valida a consulta com `EXPLAIN` sem executar os dados. O primeiro catálogo disponível cobre `sysemp`; novos destinos podem receber catálogos e compiladores próprios.
- Mantém tarefas interativas: pergunta somente o que falta, pausa em troca de assunto e retoma com os slots confirmados.
- Permite conversa generalista e delega dados internos ao Nexus quando são necessários fatos comprovados.
- Faz fallback entre providers sem repetir tools já concluídas no mesmo turno.
- Pesquisa a web com fontes citadas e proteção contra vazamento de dados corporativos.
- Processa imagens localmente para OCR, QR, códigos de barras e metadados seguros; visão externa é opcional e governada.
- Audita chamadas de IA, tokens, custos, tools, autorização, fallback e proveniência sem gravar prompts, SQL, credenciais ou resultados técnicos brutos.

## Fluxo de uma pergunta

```text
Pergunta do usuário
  → política de fonte e autorização
  → conversa geral, pesquisa web ou consulta corporativa
  → roteador + plano de capabilities validados
  → tools e evidências autorizadas
  → validação factual
  → resposta com proveniência
```

Para consultas corporativas, o modelo não escolhe tabelas, camadas ou SQL livremente. Ele recebe somente as capabilities liberadas pelo planejador. Em uma solicitação de SQL, o compilador aceita uma `QuerySpec` estruturada e produz exclusivamente `SELECT` ou `WITH ... SELECT` dentro do schema autorizado.

## Início rápido

### 1. Instale e configure

```powershell
npm install
Copy-Item .env.example .env
```

Preencha no `.env` apenas as integrações que serão usadas. Para o modo completo, a configuração central é `NEXUS_DATABASE_URL`; não mantenha um segundo `.env` em `hub/`.

### 2. Prepare o banco operacional

```powershell
npm run nexus:db:health
npm run nexus:db:migrate
npm run nexus:db:status
```

Para importar sessões e conhecimentos existentes de arquivos:

```powershell
npm run nexus:memory:import
npm run nexus:memory:verify
```

### 3. Use o CLI

```powershell
# Consulta corporativa
npm run agente:nexus -- --assistant-mode generalist --sessao desenvolvimento "Quais pedidos estão bloqueados por falta de estoque hoje?"

# SQL assistido: o Nexus pergunta somente os campos que faltarem
npm run agente:nexus -- --interaction-mode v1 --sessao sql "Gere um SQL de produtos ativos com espaço no final do SKU."

# Testes
npm test
```

### 4. Execute o Hub localmente

Cadastre primeiro um administrador e configure a App Registration Microsoft Entra conforme o [guia do Hub](docs/HUB.md).

```powershell
npm run nexus:hub:bootstrap-admin -- --email administrador@empresa.com --nome "Administrador Nexus"
npm run nexus:api
```

Em outro terminal:

```powershell
npm run nexus:hub
```

O Hub local abre em `http://localhost:3000`.

## Configurações importantes

As variáveis completas e seus valores de exemplo ficam em [.env.example](.env.example). As principais são:

| Área | Variáveis |
|---|---|
| Banco operacional | `NEXUS_DATABASE_URL`, `NEXUS_MEMORY_BACKEND`, `NEXUS_AUTHZ_MODE` |
| Agente corporativo | `LLM_PROVIDER`, `LLM_MODEL`, `NEXUS_ROUTER_MODE`, `NEXUS_INTERACTION_MODE` |
| Generalista | `NEXUS_ASSISTANT_MODE`, `NEXUS_GENERALIST_PROVIDER`, `NEXUS_GENERALIST_MODEL` |
| Fallback e aprendizado | `NEXUS_HANDOFF_MODE`, `NEXUS_MEMORY_AUTOMATION_MODE`, `NEXUS_PLAYBOOK_MODE` |
| Pesquisa web | `NEXUS_WEB_MODE`, `NEXUS_WEB_PROVIDER`, `TAVILY_API_KEY` |
| Imagens | `NEXUS_IMAGE_MODE`, `NEXUS_ATTACHMENTS_ROOT`, `NEXUS_VISION_PROVIDER`, `NEXUS_VISION_MODEL` |
| Hub | `AUTH_SECRET`, `NEXUS_HUB_*`, `NEXUS_API_INTERNAL_URL` |

Para o piloto, o Hub opera com `NEXUS_AUTHZ_MODE=enforce`. O CLI pode permanecer em `audit` enquanto a governança é calibrada.

## Governança e dados

- Cada capability possui uma permissão explícita.
- Usuários pertencem a um ou mais setores; chats ficam vinculados ao setor de criação.
- A autorização é avaliada antes de cada tool. Em `audit`, uma negação é registrada como `would_deny`; em `enforce`, ela bloqueia a execução.
- O lake usa Parquet e manifestos de publicação atômica. O adapter atual é filesystem, preparado para futura troca por Object Storage, BigLake ou BigQuery sem alterar o Hub nem as tools públicas.
- Dados internos nunca são enviados automaticamente para pesquisa externa. Conteúdo visual sensível também não é enviado a providers de visão.

## Comandos úteis

```powershell
# Lake
npm run lake:status
npm run lake:plano
npm run lake:atualizar

# Memória e candidaturas governadas
npm run nexus:memory:candidates -- list --principal auditor
npm run nexus:memory:candidates -- approve <id> --principal gestor --setor comercial --motivo "Confirmado"

# Custos e rastreabilidade
npm run nexus:pricing:import
npm run nexus:usage:report
npm run nexus:usage:trace -- <trace_id>

# Qualidade do Hub
npm run nexus:hub:build
npm test
```

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Comandos completos](docs/COMANDOS.md)
- [Hub, Microsoft Entra e Railway](docs/HUB.md)
- [Governança e memória](docs/GOVERNANCA.md)
- [IA generalista, providers e custos](docs/IA_GENERALISTA.md)
- [Memória governada e avaliação](docs/MEMORIA_E_AVALIACAO.md)
- [Pesquisa web e imagens](docs/WEB_E_IMAGENS.md)
- [Gold e definições de negócio](docs/GOLD.md)
- [Automação do lake](docs/AUTOMACAO.md)
- [OneDrive como fonte corporativa](docs/ONEDRIVE.md)
- [Roadmap](docs/ROADMAP.md)

## Segurança

Não versione `.env`, chaves de providers, URLs de banco, certificados, anexos de usuários ou snapshots corporativos. O Nexus deve usar somente credenciais com o menor privilégio necessário e conexões de dados somente leitura quando estiver consultando fontes de negócio.
