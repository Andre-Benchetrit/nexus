# Memoria e avaliacao do agente

## Memoria curta

O Nexus guarda todo o historico factual estruturado no PostgreSQL operacional e
usa as dez ultimas interacoes de cada sessao como contexto padrao. O backend de
arquivo permanece disponivel com `NEXUS_MEMORY_BACKEND=file` para testes e
desenvolvimento.
Cada item contem pergunta original e autonoma, rota, plano, tools executadas,
argumentos seguros, entidades, identificadores, periodo, filtros, campos,
cobertura e resumo factual. Sessoes v1 sao lidas normalmente e migradas de forma
atomica na gravacao seguinte.

Identificadores vindos das tools nao sao truncados pelo resumo textual. Isso
permite resolver continuacoes como `esses pedidos novamente com EAN` sem perder
a lista original.

Numeros anteriores nunca substituem uma nova consulta: dados mutaveis devem ser
confirmados pelas tools. Os arquivos legados ficam em `memoria/.runtime/`, fora
do Git, e podem ser importados de forma idempotente com
`npm run nexus:memory:import`.
Em comparacoes, `mesma cobertura` reaproveita o dia da ultima data completa, mas
faz uma nova consulta para o periodo solicitado.

A sessao padrao atende ao CLI local. Para separar usuarios ou conversas:

```powershell
npm run agente:nexus -- --sessao financeiro "Qual foi o faturamento de julho?"
npm run agente:nexus -- --sessao financeiro "E no periodo anterior?"
npm run agente:memoria -- --sessao financeiro --listar-curta
npm run agente:memoria -- --sessao financeiro --limpar-curta
```

Use `--sem-memoria` para uma pergunta isolada.

## Memoria longa

A memoria longa governada registra tres tipos separados: conhecimento de
negocio, playbooks de execucao e preferencias pessoais. Nao registra resultados
numericos temporarios. Conhecimento entra no contexto corporativo, playbook
orienta somente roteador/planejador e preferencia vale apenas para seu usuario.
Nenhum deles prevalece sobre seguranca, permissao ou contratos das tools.

O generalista e regras locais podem pedir uma revisao depois de um processo
concluido. Um revisor dedicado produz no maximo uma candidatura, o usuario
confirma o envio e um aprovador autorizado publica a memoria. Nenhuma IA publica
diretamente. Em PostgreSQL, ate `--lembrar` cria uma candidatura; publicacao
direta permanece apenas no backend de arquivos para desenvolvimento:

```powershell
npm run agente:memoria -- --listar

npm run agente:memoria -- --lembrar "Numero do pedido significa marketplace_pedido." `
  --categoria vocabulario_negocio `
  --gatilhos "numero do pedido,marketplace_pedido"

npm run agente:memoria -- --esquecer numero-do-pedido-significa-marketplace_pedido
```

Fila e aprovacao pelo CLI:

```powershell
npm run nexus:memory:candidates -- list --principal auditor
npm run nexus:memory:candidates -- show <id> --principal gestor --setor comercial
npm run nexus:memory:candidates -- approve <id> --principal gestor --setor comercial --motivo "Regra confirmada"
npm run nexus:memory:candidates -- reject <id> --principal gestor --setor comercial --motivo "Sem evidencia"
npm run nexus:memory:candidates -- request-changes <id> --principal gestor --motivo "Ajustar escopo"
npm run nexus:memory:candidates -- revoke <id> --principal admin --motivo "Regra substituida"
```

Use `NEXUS_MEMORY_AUTOMATION_MODE=observe` durante avaliacao e `propose` para
ofertas reais. `NEXUS_PLAYBOOK_MODE=shadow` mede correspondencias; `assist`
entrega playbooks aprovados como dicas que continuam sujeitas ao validador.

Revogacao desativa o item sem apagar versoes, revisoes ou auditoria.

As categorias recomendadas, criterios e exemplos de cadastro ficam em
[`../memoria/GUIA_CATEGORIAS.md`](../memoria/GUIA_CATEGORIAS.md).

## Bateria permanente

`avaliacoes/perguntas_reais.json` e o catalogo versionado de perguntas reais.
Cada caso define o perfil esperado e criterios de revisao que nao dependem de
um valor numerico fixo.

A verificacao padrao e local, nao consome API:

```powershell
npm run avaliar:agente
npm run avaliar:agente -- --categoria estoque
npm run avaliar:agente -- --caso ruptura-atual
```

Para executar respostas reais diretamente no Groq:

```powershell
npm run avaliar:agente -- --executar --provider groq --limite 5
npm run avaliar:agente -- --executar --provider groq --categoria vendas --debug
npm run avaliar:agente -- --executar --provider openai --router-mode v2 `
  --router-provider openai --caso continuacao-bloqueios-com-ean --debug
```

Relatorios reais sao gravados em `avaliacoes/resultados/` e ignorados pelo Git,
pois podem conter dados internos. A avaliacao automatica registra roteamento
estruturado, intencao, plano, tools executadas, erros internos e respostas
vazias. Casos podem declarar `intencaoEsperada` e `ferramentasEsperadas`.
Os criterios semanticos continuam visiveis
no relatorio para revisao humana. Quando um problema for corrigido, sua pergunta
deve permanecer na bateria e ganhar um teste deterministico sempre que possivel.
