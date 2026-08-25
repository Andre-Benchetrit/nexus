# IA generalista do Nexus

A IA generalista fica acima do consultor corporativo. Ela conversa normalmente e
possui a capability corporativa `consultar_nexus` e a sinalizacao nao terminal
`solicitar_revisao_memoria`. A primeira delega ao roteador
semantico existente, que continua escolhendo perfis e tools corporativas.

```text
usuario -> generalista -> resposta direta
                       -> consultar_nexus -> roteador -> tools -> generalista
```

## Ativacao

O modo corporativo continua sendo o padrao durante a implantacao. Para testar:

```powershell
npm run agente:nexus -- --assistant-mode generalist --sessao teste "Ola, quem e voce?"
```

Configure `NEXUS_GENERALIST_PROVIDER`, `NEXUS_GENERALIST_MODEL` e a chave do
provider. Anthropic nao possui modelo implicito: o ID exato deve ser informado.
O provider e o modelo do roteador continuam independentes.

## Fontes e capabilities

Uma guarda local obriga consulta para identificadores e fatos corporativos
mutaveis. Ela nao escolhe tools. Respostas retornam `conhecimento_geral` ou
`dados_nexus`, e o CLI mostra um rotulo curto da fonte.

Somente `ia.conversar`, `ia.nexus.consultar` e `ia.memoria.revisar` estao
habilitadas. A ultima apenas solicita uma avaliacao: nao cria nem publica
memoria. Visao, web,
geracao de imagens e planilhas constam como extensoes desabilitadas: atualizar
um SDK nunca libera servicos do provider automaticamente.

## Auditoria e custo

Cada requisicao real ao modelo recebe `trace_id`, `turn_id`, `call_id`, estagio,
provider, modelo, usage real, duracao e custo estimado. A composicao do input e
estimada por categoria sem guardar prompts ou resultados de tools.

```powershell
npm run nexus:pricing:import
npm run nexus:pricing:status
npm run nexus:usage:report -- --de 2026-08-01 --ate 2026-09-01
npm run nexus:usage:trace -- <trace_id>
npm run nexus:usage:compare -- --sessoes groq-shadow,groq-v1
```

Precos e cambio ficam em `config/ai-pricing.json`. Sem tarifa exata, os custos
ficam `null` e aparecem como nao precificados. Quando existe tarifa, mas falta
o cambio corporativo da competencia, o custo USD continua calculado e apenas o
BRL fica como `missing_exchange_rate`. `NEXUS_USAGE_POLICY_MODE=observe` apenas
observa consumo; ele nao limita tokens ou orcamento.

O relatorio executivo detalha consumo por provider/modelo/estagio, por
usuario/setor ativo e por finalidade. O trace reconstrui a ordem e as relacoes
entre chamadas de modelo e tools sem armazenar seus payloads internos.
O relatorio comparativo resume acerto factual observado, chamadas, fallback,
tokens, custo, latencia, perda de evidencia e possiveis tools duplicadas por
sessao usada como composicao de teste.

Mensagens visiveis sao guardadas separadamente da telemetria. Prompts de sistema,
mensagens internas, SQL e resultados brutos nao entram no historico de chat nem
nos eventos de custo.

## Continuidade entre providers

`NEXUS_HANDOFF_MODE=shadow` mede o handoff sem alterar a conversa. Em `v1`, quota,
timeout, rede, 5xx, resposta estrutural invalida ou limite de rodadas acionam um
unico fallback. O provider substituto recebe rota, plano, evidencias e ledger de
tools sanitizados. Leituras concluidas sao reutilizadas no mesmo turno; escritas
nunca sao repetidas automaticamente.

Autorizacao, seguranca, ausencia de dados, capability nao suportada,
esclarecimento e 401/403 nao acionam fallback. A troca fica invisivel no log
normal e aparece no relatorio de trace. Use `--debug-fallback` para diagnostico.

## Escalonamento semantico

Complexidade de negocio nao usa o fallback tecnico como atalho. O Nexus
classifica a consulta em faixa basica, assistida ou avancada e pode promover a
sintese sem repetir tools. Consulte [ESCALONAMENTO_SEMANTICO.md](ESCALONAMENTO_SEMANTICO.md).

O Gemini 3.5 Flash-Lite esta preparado, mas permanece bloqueado por padrao com
`NEXUS_GEMINI_USAGE_MODE=disabled`. A composicao ativa inicial usa Groq nas
consultas basicas e Claude nas faixas superiores.
