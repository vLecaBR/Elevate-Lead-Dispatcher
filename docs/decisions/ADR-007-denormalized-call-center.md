# ADR-007: `leads.call_center_id` espelha `distributions`

- Status: aceita
- Data: 2026-10-16

## Contexto
`distributions` é o registro de auditoria da distribuição: a estratégia e o snapshot de pesos e créditos usado na decisão. As consultas mais frequentes, porém, filtram leads por call center:
- a lista do OPERATOR;
- o filtro do ADMIN;
- a fila de pendentes.

Fazer isso por JOIN impede um índice composto que já entregue as linhas na ordem da listagem.

## Decisão
- **`leads.call_center_id` e `leads.distributed_at` repetem a escolha registrada em `distributions`.** As duas escritas acontecem **na mesma transação** do dispatcher; os dois timestamps vêm do mesmo `now()` da transação e batem até o microssegundo.
- **Índices que essa decisão viabiliza:**
  - `leads (call_center_id, created_at DESC, id DESC)`, que atende a lista do OPERATOR;
  - o índice parcial `leads (id) WHERE call_center_id IS NULL`, a fila de pendentes, que é minúscula.
- **`UNIQUE (distributions.lead_id)`** é a segunda barreira contra distribuir o mesmo lead duas vezes.
- **Testes de consistência:** verificam `leads.call_center_id = distributions.call_center_id` e `distributed_at` iguais, inclusive sob concorrência com 100 leads.

## Alternativas consideradas
- **Só `distributions` com JOIN:** o filtro deixa de usar um índice que já entrega na ordem, e a paginação ordenada passa a exigir sort ou um índice na outra tabela.
- **Só a coluna no lead, sem `distributions`:** perde a auditoria (pesos e créditos no momento da decisão, `external_id`).

## Consequências e trade-offs
- As consultas quentes ficam sub-milissegundo com 100k leads. Os números de `EXPLAIN` estão no README.
- **Custo:** duas fontes da mesma informação. A consistência depende de escrever as duas na mesma transação, o que fica concentrado em `recordDistribution` e é coberto por teste. Uma mudança futura (por exemplo, redistribuir um lead) precisa atualizar as duas, e o teste de consistência pega o esquecimento.
