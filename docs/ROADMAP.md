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
