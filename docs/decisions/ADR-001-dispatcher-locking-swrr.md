# ADR-001: Dispatcher com SWRR e lock de linha em `call_centers`

- Status: aceita
- Data: 2026-10-15

## Contexto
Cada lead recebido precisa ir para um call center na proporção configurada (50/30/20 no seed), mesmo com muitas requisições simultâneas. Duas requisições não podem ler o mesmo estado e escolher com base nele, nem perder uma atualização. A distribuição precisa ser atômica com o insert do lead: não pode existir lead commitado "meio distribuído". O projeto não usa Redis, fila nem worker (PLAN.md §3.4).

## Decisão
- **Algoritmo: Smooth Weighted Round Robin** (o do nginx), em função pura (`algorithm.ts`).
  - Cada call center guarda um crédito inteiro (`dispatch_credit`).
  - A cada pick, todos os elegíveis somam o próprio peso ao crédito. O de maior crédito vence e paga o peso total; o empate vai para o menor `id`.
  - A cada `soma(pesos)` leads, a divisão é exata e os créditos voltam a zero. A sequência é intercalada: `A,B,C,A,A,B,A,C,B,A`.
- **Concorrência:** a distribuição acontece na **mesma transação** do insert do lead, em READ COMMITTED.
  - Usa `SELECT … FROM call_centers WHERE is_active AND weight > 0 ORDER BY id FOR UPDATE`.
  - O segundo dispatcher espera o commit do primeiro e relê os créditos já commitados.
  - `ORDER BY id` fixa a ordem de aquisição, o que evita deadlock.
- **O lock é adquirido depois do insert do lead.**
  - A seção crítica fica restrita a pick, update de créditos, insert da distribuição e commit.
  - Duplicatas saem pelo `ON CONFLICT` sem tocar no lock.
- **Saturação:** `lock_timeout` (padrão de 3 s) e `statement_timeout` são definidos por transação.
  - Lock não obtido vira `503 dispatch_busy` com `Retry-After`.
  - Pool de conexões esgotado vira `503 service_busy`.
  - A transação é desfeita e o intake é idempotente, então o reenvio é seguro.
- **Segunda barreira:** `UNIQUE (distributions.lead_id)`.

## Alternativas consideradas
- **Aleatório ponderado:** só converge no longo prazo, então 100 leads podem dar 47/33/20, e os testes ficam instáveis.
- **SERIALIZABLE sem lock explícito:** funciona, mas falha com erros de serialização sob carga e exige laço de retry, o que é mais difícil de explicar e de testar.
- **`pg_advisory_xact_lock` global:** serializa da mesma forma, mas o estado continua precisando de `UPDATE` e o lock fica desacoplado das linhas que protege.
- **Contador atômico em Redis ou fila com consumidor único:** maior vazão, mas adiciona serviço, perde a atomicidade com o insert e força o lead a nascer pendente. É a evolução prevista na §15.

## Consequências e trade-offs
- **Ganho:** divisão exata e determinística, que dá para provar em teste: 100 leads simultâneos com pool de 20 saem exatamente 50/30/20 e os créditos voltam a 0. Removendo o `FOR UPDATE`, o mesmo teste falha (deu 52/…). Nenhum componente extra.
- **Custo:** um ponto de serialização global. Medido nesta máquina (Docker Desktop/WSL2, pool de 10, `npm run load:leads`): **~100 leads/s com 100 simultâneos e ~130–150 leads/s com 500–1000**. É suficiente para o volume do teste.
- **Se a vazão precisar crescer:**
  1. distribuição em lote;
  2. shard do dispatcher por produto, com um conjunto de créditos por shard;
  3. contadores em Redis com reconciliação periódica, aceitando o lead nascer pendente por alguns milissegundos.
- **Mudança de pesos** zera os créditos na mesma transação (rota admin, fase de auth), para evitar uma rajada de compensação.
