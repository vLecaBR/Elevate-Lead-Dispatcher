# ADR-006: Paginação por cursor (keyset) sem total

- Status: aceita
- Data: 2026-10-16

## Contexto
A tabela de leads precisa de paginação (§19), com filtros combinados, e o volume pode passar de 10 milhões de linhas (§11).

## Decisão
- **Ordem fixa:** `created_at DESC, id DESC`. O `id` desempata leads criados no mesmo instante.
- **Próxima página:** `WHERE (created_at, id) < ($c, $i) … LIMIT n+1`. A linha extra indica se existe próxima página; não há `COUNT(*)`.
- **Cursor opaco:** base64url de `[created_at, id]`. O `created_at` vai no texto do Postgres, **com microssegundos**: um `Date` do JS truncaria para milissegundos e a fronteira da página pularia ou repetiria linhas. Isso foi pego por teste com leads que só diferem nos microssegundos.
- **Índices compostos** terminam em `(created_at DESC NULLS FIRST, id DESC NULLS FIRST)`, um por filtro quente. O `EXPLAIN` com 100k leads mostra Index Scan sem etapa de Sort, com o cursor aplicado como `Index Cond`.
- **No front**, a navegação é "Anterior / Próxima", com uma pilha de cursores no cliente.

## Alternativas consideradas
- **`OFFSET`:** o custo cresce com o número da página (o banco lê e descarta as linhas anteriores), e o resultado muda quando chegam leads novos.
- **`COUNT(*)` para mostrar o total:** a 10M é um scan por página. Se o negócio exigir, a evolução é uma estimativa ou um contador por agregados.

## Consequências e trade-offs
- O custo por página é constante, e a página fica estável mesmo com inserções acontecendo.
- **Não dá para pular direto para a "página 37"** nem mostrar o total exato. A UI foi desenhada sem isso.
- **A ordenação é fixa:** ordenar por outra coluna exigiria outro cursor e outro índice.
