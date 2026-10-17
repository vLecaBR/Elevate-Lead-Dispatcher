# ADR-003: Idempotência do intake com uma única coluna `dedupe_key`

- Status: aceita
- Data: 2026-10-16

## Contexto
Landing pages reenviam formulários (duplo clique, retry de rede, recarregamento). O enunciado (§8) pede que a mesma requisição enviada várias vezes não gere registros duplicados. Isso precisa continuar valendo quando as cópias chegam **ao mesmo tempo**: duas transações não podem concluir, ambas, que "ainda não existe".

## Decisão
- **Uma coluna, `leads.dedupe_key`, com `UNIQUE`.** Ela é preenchida de duas formas:
  1. **Com o header `Idempotency-Key`:** `idem:` + sha256(chave). Quem chama define o que é "a mesma requisição".
  2. **Sem o header:** `fp:` + sha256 de `[produto, funil, e-mail, telefone E.164]`, ou seja, a mesma pessoa no mesmo funil do mesmo produto.
- **Inserção com `INSERT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`.** Se não voltar linha, a requisição é duplicata: o lead existente é lido e a resposta é `200 {duplicate: true}`, sem uma segunda distribuição.
- **Quem decide a corrida é a constraint, não o código.** Em READ COMMITTED, a segunda transação espera a primeira no índice único e depois enxerga a linha commitada.
- **`request_hash`:** sha256 do input **já normalizado**, com as chaves ordenadas. A mesma `Idempotency-Key` com um corpo diferente dá `422 idempotency_key_reuse`. Diferenças de espaço ou de maiúsculas no e-mail não contam como corpo diferente.
- **Teste de concorrência:** 100 requisições idênticas e simultâneas, com pool de 20, criam 1 lead e 1 distribuição.

## Alternativas consideradas
- **`SELECT` antes do `INSERT`:** é racy (duas transações leem "não existe"). Exigiria lock ou `SERIALIZABLE`.
- **Lock advisory por hash:** funciona, mas é mais código e esconde a regra que o `UNIQUE` torna explícita no schema.
- **Dedupe só por `Idempotency-Key`:** landing pages simples não enviam o header.

## Consequências e trade-offs
- **Sem janela de tempo:** a mesma pessoa no mesmo funil meses depois volta como duplicata. Se o negócio quiser recaptura, a janela entra na composição da chave (por exemplo, o dia ou a semana).
- **Com `Idempotency-Key`, o fingerprint não é consultado.** A mesma pessoa com chaves diferentes vira dois leads. Foi escolhido assim (uma regra por requisição) e está documentado.
- **Em tabela particionada** (10M+), `UNIQUE` exige a chave de partição. A evolução é uma tabela `lead_dedupe(dedupe_key pk, lead_id)` não particionada (PLAN.md §15).
