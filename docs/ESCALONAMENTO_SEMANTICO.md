# Escalonamento semantico

O escalonamento semantico escolhe a capacidade de raciocinio necessaria para
cada consulta sem retirar do roteador e do planejador a autoridade sobre tools,
filtros e camadas. Ele e independente do fallback tecnico: uma promocao ocorre
por complexidade; um fallback ocorre por quota, timeout, rede, 5xx, estrutura
invalida ou esgotamento de rodadas.

## Faixas

- `deterministica`: protocolo, autorizacao, SQL compilado e respostas que nao
  exigem outra chamada de modelo.
- `basica`: uma fachada, um dominio, alta confianca e transformacoes de
  apresentacao como agrupar, ordenar ou destacar.
- `assistida`: comparacao temporal, derivacao controlada ou combinacao moderada
  de evidencias.
- `avancada`: multiplos dominios, capacidade ausente, plano rejeitado,
  Gold/Silver/Bronze, auditoria, SQL, baixa confianca ou risco alto.

O roteador sugere transformacoes, complexidade, risco e necessidade de
intervencao. O seletor local valida a sugestao, calcula a pontuacao e pode
elevar a faixa. A faixa nunca e reduzida durante o turno.

Quando a complexidade aparece somente depois das tools, o Nexus promove a
sintese final e reutiliza integralmente as evidencias ja consultadas. A falha
dessa intervencao preserva a resposta corporativa anterior comprovada.

## Modos

```env
NEXUS_SEMANTIC_ESCALATION_MODE=shadow
```

- `off`: nao classifica nem troca providers.
- `shadow`: calcula, registra e compara, mas usa o provider atual.
- `v1`: aplica a selecao de provider e evita uma segunda sintese generalista
  quando o raciocinio corporativo ja entregou uma resposta pronta.

## Configuracao inicial Groq e Claude

```env
LLM_PROVIDER=groq
GROQ_MODEL=openai/gpt-oss-120b
LLM_FALLBACK_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-sonnet-5

NEXUS_MODEL_TIER_BASIC_PROVIDER=
NEXUS_MODEL_TIER_BASIC_MODEL=
NEXUS_MODEL_TIER_ASSISTED_PROVIDER=anthropic
NEXUS_MODEL_TIER_ASSISTED_MODEL=claude-haiku-4-5
NEXUS_MODEL_TIER_ADVANCED_PROVIDER=anthropic
NEXUS_MODEL_TIER_ADVANCED_MODEL=claude-sonnet-5
```

A faixa basica vazia reutiliza `LLM_PROVIDER`, portanto usa Groq nessa
composicao. O generalista pode continuar em Claude independentemente.

## Gemini preparado, mas inativo

O adapter reconhece `gemini-3.5-flash-lite`, mas a politica segura padrao e:

```env
NEXUS_GEMINI_USAGE_MODE=disabled
```

Valores aceitos:

- `disabled`: nenhuma chamada Gemini e autorizada;
- `free_public`: somente conhecimento geral sem dados corporativos;
- `paid`: permite a selecao para dados corporativos.

Mesmo que uma faixa seja configurada acidentalmente com Gemini, o modo
`disabled` impede a chamada. Para uma futura ativacao paga:

```env
NEXUS_GEMINI_USAGE_MODE=paid
NEXUS_MODEL_TIER_BASIC_PROVIDER=gemini
NEXUS_MODEL_TIER_BASIC_MODEL=gemini-3.5-flash-lite
```

## Observabilidade

A migration `006_escalonamento_semantico.sql` registra faixa e pontuacao
inicial/final no turno e a faixa de cada chamada de modelo. O trace mostra
motivos de promocao e o relatorio executivo agrega custo por faixa.

```powershell
npm run nexus:usage:report -- --faixa avancada
npm run nexus:usage:trace -- <trace_id>
```

O CLI aceita `--semantic-escalation-mode` e `--semantic-tier`. Uma faixa
explicita pode elevar a analise para teste, mas nunca reduzir uma faixa exigida
por seguranca ou risco.
