# ADR-002: Status como projeção de um log de eventos com reducer determinístico

- Status: aceita
- Data: 2026-10-16

## Contexto
Os call centers informam mudanças de status por webhook, e a entrega não tem ordem garantida: `contacted` pode chegar depois de `sale`, e um `refund` pode chegar antes do `sale` a que se refere. Também há reenvios (o mesmo evento várias vezes) e webhooks concorrentes para o mesmo lead. O status do lead precisa refletir o que aconteceu, e não a ordem em que as mensagens chegaram.

## Decisão
- **`lead_status_events` é append-only e é a fonte da verdade.** `leads.status` é uma projeção.
- **A cada evento novo, o status é recalculado** com `reduceStatus` (função pura) sobre **todos** os eventos do lead.
  - Os eventos são ordenados por `(event_ts, rank do status, id)`.
  - O reducer parte de `new` e aplica a máquina de estados da §9.3, ignorando as transições inválidas, que ficam gravadas para auditoria.
- **Cada status tem um rank distinto.** Assim, dois eventos só empatam em `(event_ts, rank)` quando têm o mesmo status, e a ordem entre eles não muda nada. Consequência: o resultado é o mesmo para qualquer ordem de chegada. O teste unitário verifica todas as 720 permutações de um histórico de 6 eventos.
- **Dedupe:** `UNIQUE (lead_id, event_key)`, com `event_key = sha256(call center, external_id, status, event_ts em UTC, event_id)`. O reenvio responde `200 duplicate` e não grava nada.
- **Concorrência:** a transação começa com `SELECT … FROM leads WHERE id = $1 FOR UPDATE`. Webhooks do mesmo lead entram em fila; leads diferentes seguem em paralelo.

## Alternativas consideradas
- **Aplicar cada evento sobre o status atual ("last write wins"):** um `contacted` atrasado sobrescreveria uma `sale`, e um `refund` antecipado seria perdido.
- **Rejeitar eventos fora de ordem (409):** o provedor reenviaria indefinidamente ou desistiria, e o evento se perderia.
- **Fila com reordenação por janela de tempo:** exige um serviço a mais e só resolve atrasos menores que a janela.
- **Desempate pelo `id`** (como estava no plano): o `id` reflete a ordem de chegada, então quebraria a invariância a permutações.

## Consequências e trade-offs
- **Ganho:** o resultado é determinístico e auditável, porque o histórico completo fica gravado, inclusive os eventos ignorados. Um evento atrasado é corrigido automaticamente quando o que faltava chegar.
- **Custo:** cada webhook relê todos os eventos do lead. São poucos por lead, e a consulta usa o índice `(lead_id, event_ts)`.
- **Limitações:**
  - O `event_ts` vem do relógio do call center, então pode haver skew.
  - Eventos com mais de 5 minutos no futuro são rejeitados.
  - A troca manual pelo operador usa o relógio do servidor.
- **Validação do teste de concorrência:** sem o `FOR UPDATE` no lead, o teste falhou em todas as 6 execuções, porque a projeção final divergia do reducer. Com o lock, passou em todas.
