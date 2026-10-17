# Decisões de arquitetura (ADRs)

Um arquivo por decisão relevante, nomeado `ADR-NNN-titulo-curto.md` (ex.: `ADR-001-dispatcher-locking.md`). Máximo de uma página.

Modelo:

```
# ADR-NNN: <título>

- Status: aceita | substituída por ADR-XXX
- Data: YYYY-MM-DD

## Contexto
Qual problema e quais restrições.

## Decisão
O que foi decidido.

## Alternativas consideradas
Cada uma com o motivo de não ter sido escolhida.

## Consequências e trade-offs
O que ganhamos, o que aceitamos perder, o que fazer se o cenário mudar.
```

ADRs previstos no plano: dispatcher (locking e SWRR), idempotência do intake, log de eventos com reducer determinístico, HMAC do webhook, sessão em vez de JWT, paginação por cursor, denormalização de `call_center_id`.
