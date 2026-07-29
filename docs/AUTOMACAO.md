# Automacao de atualizacao do lake

## Objetivo

O pipeline executa Bronze, Silver e Gold em ordem, usando os catalogos como
fonte de configuracao. Ao adicionar uma entidade ou objeto aos catalogos
existentes, ele entra automaticamente na atualizacao completa.

```text
catalogo Bronze -> extracoes -> catalogo Silver -> modelos -> catalogo Gold -> indicadores
```

Nao existe uma lista paralela de entidades, dimensoes, fatos ou indicadores
dentro do orquestrador.

## Modos de atualizacao

### Dias completos

E o modo padrao e recomendado. Em 27/07, o fim incremental e `2026-07-27`
exclusivo, portanto entram dados ate 26/07.

```powershell
npm run lake:atualizar
```

O watermark de cada entidade incremental avanca somente depois de sua extracao
terminar com sucesso.

### Intradiario

Inclui o dia atual usando uma janela sobreposta. O padrao reprocessa dois dias
anteriores para capturar registros que chegaram depois de outra execucao.

```powershell
npm run lake:atualizar -- --incluir-hoje
npm run lake:atualizar -- --incluir-hoje --sobreposicao-dias 3
```

Esse modo usa `--forcar` internamente e nao avanca o watermark oficial. Assim, a
proxima carga de dias completos continua capaz de capturar o dia inteiro.

## Planejamento e estado

Confira todas as etapas sem consultar PostgreSQL nem gravar o lake:

```powershell
npm run lake:plano
```

Veja watermarks e a ultima execucao:

```powershell
npm run lake:status
```

O controle local fica em `lake/_controle/`:

- `estado.json`: watermark confiavel de cada entidade incremental;
- `pipeline.lock`: impede duas atualizacoes simultaneas;
- `ultima-execucao.json`: resultado mais recente;
- `execucoes/*.json`: auditoria detalhada de cada execucao.

Como `lake/` nao e versionado, esses arquivos tambem ficam fora do Git.

## Execucao seletiva

```powershell
# Somente Bronze
npm run lake:atualizar -- --camadas bronze

# Entidades Bronze especificas
npm run lake:atualizar -- --camadas bronze --entidades nota_saida,nota_saida_itens

# Um objeto Silver e suas dependencias Silver
npm run lake:atualizar -- --camadas silver --silver fato_nota_fiscal_item

# Um objeto Gold e suas dependencias Gold
npm run lake:atualizar -- --camadas gold --gold painel_executivo_diario

# Janela explicita para diagnostico ou backfill
npm run lake:atualizar -- --camadas bronze --entidades log_estoque --inicio 2026-07-01 --fim 2026-07-27
```

`--fim` e exclusivo. Use `--forcar` somente para reprocessar uma janela
incremental que ja exista.

## Primeira carga de uma entidade nova

Entidades `snapshot` entram automaticamente. Uma entidade incremental nova nao
possui watermark, então exige que o inicio seja escolhido explicitamente:

```powershell
npm run lake:atualizar -- --camadas bronze --entidades funcionario --inicio 2026-01-01
```

Depois dessa primeira carga, as execucoes seguintes continuam a partir do fim
registrado. Isso evita que o pipeline invente quanto historico deve ser buscado.

Para excluir intencionalmente uma entidade do processo, adicione ao contrato:

```js
automacao: {
  habilitada: false
}
```

## Falhas e retomada

O pipeline para ao primeiro erro e nao executa camadas dependentes com fontes
incompletas. Etapas Bronze concluidas preservam seus manifestos e watermarks.
Ao executar novamente, o planejamento continua de onde cada entidade parou.

Uma trava com menos de 24 horas impede outra instancia. Travas mais antigas sao
consideradas residuos de processo interrompido e podem ser recuperadas
automaticamente.

## Agendamento no Windows

Primeiro valide manualmente:

```powershell
npm run lake:plano
npm run lake:atualizar
npm run lake:status
```

Depois registre uma tarefa diaria para 02:00:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agendar-lake-windows.ps1 -Horario "02:00"
```

O instalador nao substitui uma tarefa existente sem autorizacao. Para atualizar
uma tarefa ja criada:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agendar-lake-windows.ps1 -Horario "03:00" -Substituir
```

A tarefa usa o usuario atual, ignora uma segunda instancia concorrente e possui
limite de 12 horas. Em producao Linux ou cloud, o mesmo comando
`npm run lake:atualizar` pode ser chamado por cron, systemd, Cloud Scheduler ou
outro orquestrador.

## Novas fontes

Entidades e modelos novos sao descobertos pelos catalogos. Uma fonte diferente
de PostgreSQL precisa de um adaptador de extracao com o mesmo retorno de
manifesto. O registro central fica em `exportadores/adaptadores.js`; Silver,
Gold, controle, dependencias e agendamento continuam iguais.

O adaptador OneDrive ja esta registrado. Consulte [ONEDRIVE.md](ONEDRIVE.md)
para conexoes, permissoes, comandos e contrato de planilhas.
