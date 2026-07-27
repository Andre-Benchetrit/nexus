# Memoria e avaliacao do agente

## Memoria curta

O Nexus guarda localmente as tres ultimas interacoes de cada sessao. Cada item
contem a pergunta, uma versao compactada da resposta, o perfil utilizado e
referencias temporais detectadas. Esse contexto serve para continuacoes como
`e por marca?`, `compare com o periodo anterior` ou `use a mesma cobertura`.

Numeros anteriores nunca substituem uma nova consulta: dados mutaveis devem ser
confirmados pelas tools. Os arquivos ficam em `memoria/.runtime/`, fora do Git.
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

A memoria longa registra correcoes e vocabulario estaveis, nao resultados
numericos. Ela e consultada por relevancia e suas regras nunca prevalecem sobre
os contratos das tools ou sobre os modelos Silver e Gold.

O agente nao grava aprendizados sozinho. Isso evita transformar uma resposta
errada ou uma instrucao maliciosa em regra permanente. O aprendizado entra por
um comando explicito e fica versionado em `memoria/conhecimento.json`:

```powershell
npm run agente:memoria -- --listar

npm run agente:memoria -- --lembrar "Numero do pedido significa marketplace_pedido." `
  --categoria vocabulario_negocio `
  --gatilhos "numero do pedido,marketplace_pedido"

npm run agente:memoria -- --esquecer numero-do-pedido-significa-marketplace_pedido
```

`--esquecer` desativa o item em vez de apagar seu historico.

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
```

Relatorios reais sao gravados em `avaliacoes/resultados/` e ignorados pelo Git,
pois podem conter dados internos. A avaliacao automatica verifica roteamento,
erros internos e respostas vazias. Os criterios semanticos continuam visiveis
no relatorio para revisao humana. Quando um problema for corrigido, sua pergunta
deve permanecer na bateria e ganhar um teste deterministico sempre que possivel.
