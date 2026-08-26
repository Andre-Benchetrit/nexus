# Pesquisa web e imagens

O Nexus trata pesquisa externa e imagens como capabilities governadas. Elas nao
passam pelo roteador de dados corporativos e nao recebem acesso implicito a dados
da FID.

## Pesquisa

`NEXUS_WEB_MODE=shadow` registra quando uma busca seria necessaria sem consultar
o fornecedor. Em `v1`, fatos necessariamente atuais continuam forçando evidência
externa; pedidos explícitos com assunto definido oferecem `pesquisar_web` ao
generalista para que ele formule a consulta. Um pedido vago, como "pesquise algo
para mim", gera uma pergunta de esclarecimento antes de consumir créditos.

A consulta passa por uma guarda contra dados internos, SQL, credenciais e dados
pessoais. O catálogo `config/web-entities.json` expande aliases públicos e define
termos obrigatórios para entidades ambíguas. Resultados abaixo de
`NEXUS_WEB_MIN_SCORE` ou sem correspondência com a entidade são descartados; uma
busca avançada pode ser tentada sem repetir a busca básica. A resposta final
aceita apenas links devolvidos pela busca. Se a síntese falhar, o Nexus mostra no
máximo três referências, sem despejar os trechos brutos das páginas.

Custos da Tavily usam `usage_line_items` com servico `tavily_search`, separados
dos tokens da sintese. Importe o manifesto depois da migration:

```powershell
npm run nexus:db:migrate
npm run nexus:pricing:import
```

## Imagens

O Hub aceita ate quatro arquivos PNG, JPEG ou WebP de 10 MB e 20 megapixels. A
API decodifica e reencoda cada arquivo, corrige orientacao e remove EXIF antes de
gravar a versao sanitizada em `NEXUS_ATTACHMENTS_ROOT`.

`NEXUS_IMAGE_MODE=local` libera OCR, QR, codigo de barras e metadados seguros sem
enviar imagens a um provider. Em `v1`, pedidos realmente visuais podem usar o
provider configurado por `NEXUS_VISION_PROVIDER` e `NEXUS_VISION_MODEL`.
Documentos de identidade, dados medicos, bancarios, credenciais e outros sinais
sensíveis bloqueiam esse envio externo.

Defina `NEXUS_VISION_MODEL` explicitamente quando o provider visual for diferente
do generalista. O modelo generalista só é reutilizado automaticamente quando os
dois usam o mesmo provider; uma configuração visual incompleta preserva o OCR e
os códigos locais sem tentar uma chamada externa.

O texto de OCR e os codigos encontrados existem somente no turno. A auditoria
guarda contagens, megapixels, duracao e erros sanitizados, nunca o conteudo
extraido. A exclusao do chat tambem remove seus anexos; falhas de storage entram
na fila `attachment_cleanup_jobs`.
