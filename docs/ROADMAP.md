# Roadmap do Nexus

Este documento registra decisoes futuras para evitar que capacidades diferentes
sejam antecipadas dentro da arquitetura do lake.

## Agora: inteligencia sobre dados internos

Enquanto o foco for consultar Bronze, Silver e Gold, o Nexus deve manter o loop
de agente proprio e os providers intercambiaveis. As tools de negocio continuam
pequenas, somente leitura e validadas por contrato.

Claude pode entrar nessa fase como mais um provider pela Messages API, usando as
mesmas tools de Gemini, Groq e OpenAI. Nao e necessario adotar o Claude Agent SDK
para consultar o lake.

## Marco futuro: agente geral e automacoes

Reavaliar o **Claude Agent SDK** depois que o lake e a camada Gold estiverem
estaveis e o Nexus comecar a executar tarefas como:

- pesquisa e consulta na web;
- leitura e producao de documentos;
- criacao e analise de planilhas e dashboards;
- automacoes longas, com varias etapas e retomada de sessao;
- integracoes via MCP;
- agentes configuraveis por usuarios e subagentes especializados.

Nesse momento, o Agent SDK deve ser uma camada de orquestracao geral acima das
tools do Nexus, nao um substituto para os contratos de dados. Consultas ao lake
continuam passando por tools seguras; acesso a arquivos, web e acoes externas
recebe permissoes, hooks, auditoria e aprovacao humana conforme o risco.

## Criterios para a decisao

Adotar o Agent SDK quando pelo menos dois destes sinais forem recorrentes:

1. tarefas precisam combinar lake, web e arquivos na mesma execucao;
2. o loop atual exige controle complexo de sessao, retomada ou subagentes;
3. MCP passa a ser uma integracao central, e nao apenas experimental;
4. automacoes precisam de hooks antes e depois de cada acao;
5. manter a orquestracao propria custa mais do que adaptar o SDK.

Antes da adocao, executar um piloto medindo qualidade, latencia, tokens e custo
por tipo de tarefa. A assinatura do Claude nao deve ser confundida com creditos
da API; o consumo precisa ser registrado por provider, modelo, tool e usuario.

