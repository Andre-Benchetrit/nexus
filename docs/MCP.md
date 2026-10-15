# Fundacao MCP governada

O MCP no Nexus e uma camada de integracao subordinada a governanca existente.
Um servidor externo nunca define sozinho o nome que o modelo ve, a capability,
a permissao ou o efeito de uma tool.

## Fluxo

```text
manifesto versionado
  -> configuracao de endpoint e segredo no Railway
  -> descoberta MCP
  -> comparacao de identidade, protocolo e hashes
  -> binding habilitado no PostgreSQL
  -> autorizacao + DLP
  -> tools/call
  -> validacao e sanitizacao da resposta
  -> evidencia externa nao confiavel para o agente
```

O runtime usa o SDK oficial MCP v2 e fixa o laboratorio no protocolo
`2026-07-28`. Em producao, o transporte permitido e Streamable HTTP. `stdio`
existe somente para desenvolvimento e usa comando definido no codigo.

## Fronteiras de configuracao

- `nexus/mcp_manifest.js`: servidores, identidade permitida, protocolo,
  schemas, hashes, capability, permissao, efeito e exposicao;
- Railway: endpoint efetivo e segredo Bearer;
- PostgreSQL: ativacao, estado observado, saude e historico operacional;
- Hub: somente habilita, desabilita, verifica e testa itens que ja existem no
  manifesto. O Hub nao aceita URL, comando, schema ou permissao livre.

Mudanca de identidade, protocolo ou schema marca o servidor ou binding como
`drifted`. Um binding com drift deixa de ser entregue ao modelo antes de uma
nova conversa e tambem e conferido novamente imediatamente antes da chamada.

## Modos

- `off`: nao sincroniza, descobre nem executa;
- `shadow`: sincroniza o manifesto, descobre e registra saude, sem executar;
- `v1`: executa somente bindings homologados, saudaveis e habilitados.

## Laboratorio

O servico `nexus-mcp-lab` possui uma unica tool deterministica de leitura:
`consultar_item_laboratorio`. Ela consulta tres itens estaticos e nao acessa
banco, arquivos ou internet.

O binding usa `exposure: admin_lab`. Por isso ele nao aparece no modo
Automatico nem nos chats dos pilotos. A chamada so ocorre em **Administracao >
Conectores MCP**, com as permissoes `mcp.administrar` e
`mcp.laboratorio.testar`.

Para desenvolvimento:

```powershell
$env:NEXUS_MCP_LAB_TOKEN="um-segredo-aleatorio-com-32-caracteres"
npm run nexus:mcp:lab
```

O fixture stdio pode ser iniciado com `npm run nexus:mcp:stdio` e nunca e
permitido em `NODE_ENV=production`.

## Controles de seguranca

- URL publica exige HTTPS e resolucao DNS publica;
- endpoint Railway privado exige hostname exato homologado;
- IP literal, redirect e troca de origem sao bloqueados;
- argumentos adicionais ou fora do schema sao rejeitados;
- tokens, senhas e credenciais nos argumentos sao bloqueados por DLP;
- somente texto e JSON estruturado sao aceitos;
- imagens, audio, arquivos e conteudo incorporado sao rejeitados;
- links externos sao removidos e sinais de prompt injection bloqueiam o
  resultado;
- limite de bytes falha explicitamente, sem truncamento silencioso;
- timeout, cancelamento, concorrencia e circuito aberto limitam falhas;
- uma unica repeticao ocorre apenas em leitura quando a conexao cai antes de
  qualquer resposta;
- auditoria armazena metadados, nunca token, argumentos ou resposta bruta.

## Implantacao no Railway

Crie um servico a partir de `services/nexus-mcp-lab/Dockerfile`. Na API e no
laboratorio, defina o mesmo `NEXUS_MCP_LAB_TOKEN`. Na API, configure:

```env
NEXUS_MCP_MODE=shadow
NEXUS_MCP_SERVERS_JSON=[{"key":"laboratorio","url":"http://nexus-mcp-lab.railway.internal:3010/mcp","transport":"streamable_http","networkScope":"railway_private"}]
NEXUS_MCP_LAB_TOKEN=<mesmo-segredo>
```

No laboratorio, configure:

```env
PORT=3010
NEXUS_MCP_LAB_TOKEN=<mesmo-segredo>
NEXUS_MCP_LAB_ALLOWED_HOSTS=nexus-mcp-lab.railway.internal
```

Depois da migration `028_mcp_foundation.sql` e do deploy:

1. abra **Conectores MCP**;
2. execute **Verificar** ainda em `shadow`;
3. confirme protocolo, identidade, versao e hashes aprovados;
4. habilite o servidor e o binding;
5. altere a API para `NEXUS_MCP_MODE=v1`;
6. execute o teste do laboratorio e confirme trace e auditoria.

Falha no laboratorio nao torna `/health/ready` indisponivel.

## Fora desta sprint

Nao ha Microsoft 365, OAuth delegado, automacoes, escrita externa, MCP Apps,
resources, prompts, sampling, roots, elicitation, subscriptions ou tasks. Essas
capacidades exigem novos bindings e novas permissoes; nao podem ser liberadas
somente por configuracao no painel.
