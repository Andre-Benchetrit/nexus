# Roadmap do Nexus

O estado implementado esta em [ESTADO_ATUAL.md](ESTADO_ATUAL.md). Este arquivo
registra somente os proximos marcos; pesquisa web, leitura de anexos e geracao de
XLSX, DOCX e PDF ja nao sao itens futuros.

## Curto prazo

- concluir rollout e smoke tests da geracao conversacional de imagens;
- estabilizar armazenamento persistente de anexos e artefatos em producao;
- medir custo, latencia, qualidade e uso por capability;
- ampliar testes de recuperacao de volume, retry e continuidade de contexto;
- revisar qualidade do roteamento automatico com traces reais, sem transformar
  intencoes em listas rigidas de palavras-chave.

## Proximos produtos

- editor visual simples para mover, redimensionar, bloquear e reordenar camadas;
- segmentacao, mascaras e inpainting para objetos dentro da imagem-base;
- mais modelos de documentos e identidade visual por implantacao;
- automacoes longas com retomada, aprovacao humana e notificacao;
- integracoes via MCP quando houver demanda operacional validada;
- avaliacao de um lakehouse somente quando volume, concorrencia, historico e
  governanca justificarem a complexidade adicional.

## Programa MCP e automacoes de IA

O proximo ciclo de evolucao ativa do Nexus sera executado em cinco sprints. MCP
sera um executor abaixo das capabilities governadas do Nexus, e as automacoes
poderao usar tanto tools locais quanto conectores MCP. Nenhum conector externo
substituira permissoes, aprovacao, DLP ou auditoria.

### Sprint 13 - Fundacao MCP (implementada; rollout pendente)

- adicionar um cliente MCP independente do provider de LLM;
- suportar Streamable HTTP em producao e stdio apenas em desenvolvimento;
- manter catalogo administrativo de servidores, versoes e tools homologadas;
- mapear toda tool externa para uma capability interna antes de expo-la ao
  modelo;
- validar schemas, aplicar timeout, limite de resultado, sanitizacao, health
  check e auditoria;
- permitir somente servidores e versoes presentes em allowlist.

O codigo, a migration, o laboratorio e o painel administrativo foram
entregues. O rollout segue o procedimento em [MCP.md](MCP.md): primeiro
`shadow`, verificacao de identidade e hashes, depois `v1` apenas para o smoke
administrativo.

### Sprint 14 - Microsoft 365 somente leitura

- integrar e-mail, calendario, OneDrive, SharePoint e estrutura organizacional;
- priorizar identidade delegada do usuario e uma App Registration separada;
- avaliar os servidores oficiais do Microsoft Agent 365 e, quando indisponiveis
  no tenant, manter o mesmo contrato por meio de um MCP interno sobre Graph;
- nao enviar mensagens, criar reunioes ou modificar conteudo nesta etapa.

### Sprint 15 - Automacoes de IA somente leitura

- criar definicoes versionadas, agendas, execucoes, etapas e notificacoes;
- adicionar dispatcher e worker separados da API, com fila inicial em
  PostgreSQL, lease, heartbeat, retry e idempotencia;
- revalidar identidade, setor, permissoes, freshness das fontes e orcamento em
  cada execucao;
- oferecer templates para resumos, alertas e consultas recorrentes, com entrega
  inicial somente na Central de Atividades do Hub.

### Sprint 16 - Aprovacoes e acoes Microsoft

- permitir rascunhos de e-mail, envio, reunioes e notificacoes do Teams por
  capabilities especificas;
- exigir previa e aprovacao humana para efeitos externos;
- vincular a aprovacao a argumentos imutaveis, prazo de validade, revalidacao de
  permissao, idempotencia e auditoria;
- manter exclusoes e outras acoes destrutivas bloqueadas inicialmente.

### Sprint 17 - Navegador isolado e agentes flexiveis

- executar Playwright MCP apenas em worker e sandbox temporarios;
- limitar dominios, rede, uploads, downloads, tempo e credenciais;
- exigir aprovacao antes de submeter formularios ou produzir efeito externo;
- permitir que o usuario descreva uma rotina e converter o pedido em uma
  especificacao revisavel de gatilho, fontes, capabilities, condicoes, limites
  e saida, sem executar o prompt livre como configuracao administrativa.

O primeiro marco de produto sera o final da Sprint 15: conectores MCP de leitura
e rotinas agendadas governadas. As Sprints 16 e 17 adicionarao capacidade de
agir com aprovacao e, depois, navegacao isolada.

## Possivel camada de orquestracao

O Nexus deve manter suas tools pequenas, somente leitura e validadas por
contrato. Um Agent SDK pode ser reavaliado quando automacoes longas, MCP,
subagentes ou retomada de sessao tornarem o loop atual mais caro de manter. Esse
SDK seria uma camada acima das tools governadas, nunca um substituto para
permissoes, contratos de dados, DLP ou auditoria.

## Criterios para a decisao

Reavaliar uma nova camada de orquestracao quando pelo menos dois destes sinais
forem recorrentes:

1. tarefas longas exigem pausa e retomada fora do turno atual;
2. MCP passa a ser uma integracao central, e nao apenas experimental;
3. automacoes precisam de hooks e aprovacao antes e depois de cada acao;
4. agentes configuraveis ou subagentes tornam-se requisito de produto;
5. manter o loop proprio custa mais do que adaptar um SDK sem perder governanca.

Antes de qualquer adocao, executar um piloto medindo qualidade, latencia, tokens
e custo por tipo de tarefa. Assinaturas de produtos nao devem ser confundidas
com creditos de API.
