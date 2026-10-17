# ADR-004: Webhook autenticado por HMAC-SHA256 por call center

- Status: aceita
- Data: 2026-10-16

## Contexto
`POST /api/webhooks/callcenter` é público: qualquer pessoa na internet pode chamá-lo. O enunciado (§17) pede uma estratégia para que ninguém consiga enviar atualizações falsas. Cada call center só pode atualizar os leads que recebeu.

## Decisão
- **Cada call center tem um segredo próprio** (`call_centers.webhook_secret`), que nunca é devolvido por nenhuma API.
- **Headers:**
  - `X-Callcenter-Id`: o slug, que seleciona o segredo;
  - `X-Elevate-Timestamp`: em segundos Unix;
  - `X-Elevate-Signature: sha256=<hex>`, onde `hex = HMAC_SHA256(segredo, timestamp + "." + corpo_cru)`.
- **A assinatura é calculada sobre o corpo cru.** O parser JSON da rota fica num plugin encapsulado e entrega o `Buffer` original; o JSON só é lido depois que a assinatura confere. Re-serializar o objeto mudaria espaços ou a ordem das chaves.
- **A comparação usa `crypto.timingSafeEqual`**, com tamanho fixo (32 bytes), para não vazar por tempo quantos bytes estavam certos.
- **Janela anti-replay:** `|agora − timestamp| ≤ WEBHOOK_TOLERANCE_SECONDS` (300). O timestamp faz parte do MAC, então não dá para trocá-lo.
- **Toda falha** (call center desconhecido, assinatura errada, expirada, headers ausentes) responde o **mesmo `401`**. O motivo só vai para o log. Para slug desconhecido também se calcula um HMAC, para o tempo de resposta não revelar quais slugs existem.
- **Autorização:** lead de outro call center responde `404`, igual a um lead que não existe.

## Alternativas consideradas
- **API key num header:** o segredo trafega em toda requisição e não protege a integridade do corpo nem impede replay.
- **mTLS:** é mais forte, mas exige PKI e configuração no call center. Desproporcional para o escopo.
- **JWT assinado pelo call center:** é equivalente ao HMAC, com mais formato e dependências.

## Consequências e trade-offs
- Integridade, autenticidade e replay limitado, sem dependências: só `node:crypto`.
- **O relógio do call center importa:** a janela de 5 minutos tolera skew moderado.
- **Rotação de segredo não implementada:** a v2 aceitaria `current` e `previous` durante uma janela de troca.
- **Retries legítimos** reassinam com um timestamp novo; a deduplicação por `(lead_id, event_key)` (ADR-002) garante que o evento seja aplicado uma vez.
