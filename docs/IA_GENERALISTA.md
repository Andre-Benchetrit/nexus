# IA generalista do Nexus

A IA generalista fica acima do consultor corporativo. Ela conversa normalmente e
possui somente a capability `consultar_nexus`. Essa capability delega ao roteador
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

Somente `ia.conversar` e `ia.nexus.consultar` estao habilitadas. Visao, web,
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
```

Precos e cambio ficam em `config/ai-pricing.json`. Sem tarifa exata, o custo e
`null` e aparece como nao precificado. `NEXUS_USAGE_POLICY_MODE=observe` apenas
observa consumo; ele nao limita tokens ou orcamento.

O relatorio executivo detalha consumo por provider/modelo/estagio, por
usuario/setor ativo e por finalidade. O trace reconstrui a ordem e as relacoes
entre chamadas de modelo e tools sem armazenar seus payloads internos.

Mensagens visiveis sao guardadas separadamente da telemetria. Prompts de sistema,
mensagens internas, SQL e resultados brutos nao entram no historico de chat nem
nos eventos de custo.
