# Elevate Lead Dispatcher

Recebe leads de páginas de vendas, valida, deduplica, distribui entre call centers na proporção configurada (50/30/20), acompanha o ciclo de vida por webhook assinado e oferece um painel com acesso por papel (ADMIN e OPERATOR).

**Stack:** TypeScript · Node.js 24 · Fastify · Zod · Drizzle ORM · PostgreSQL 17 · Next.js 16 (App Router) · TanStack Query · Tailwind · Vitest · Docker Compose.

**Documentos do projeto:** [PLAN.md](PLAN.md) (plano técnico) · [CLAUDE.md](CLAUDE.md) (regras dadas à IA) · [docs/decisions](docs/decisions) (ADRs) · [docs/ai/AI-LOG.md](docs/ai/AI-LOG.md) (diário de uso de IA).

---

## 1. Instalação e execução

Pré-requisitos: Docker Desktop (com `docker compose` v2). Node.js 24 só é necessário para rodar testes e scripts fora dos containers.

```bash
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
docker compose up --build
```

O compose sobe, nesta ordem:
1. `db` (Postgres 17, com o banco `elevate_test` criado por script de init);
2. `migrate` (aplica as migrations e o seed de demonstração, depois sai);
3. `api` (porta 3001, healthcheck em `/ready`);
4. `web` (porta 3000).

| O quê | Onde |
|---|---|
| Painel | http://localhost:3000 |
| API | http://localhost:3001 (`/health`, `/ready`) |

**Credenciais de desenvolvimento** (criadas pelo seed só quando `SEED_DEMO=true`; **nunca use em produção**):

| Usuário | Papel | Senha |
|---|---|---|
| `admin@elevate.local` | ADMIN | `elevate-dev-2026` |
| `operator.a@elevate.local` | OPERATOR do Call Center A | `elevate-dev-2026` |
| `operator.b@elevate.local` | OPERATOR do Call Center B | `elevate-dev-2026` |
| `operator.c@elevate.local` | OPERATOR do Call Center C | `elevate-dev-2026` |

Segredos de webhook de desenvolvimento: `dev-webhook-secret-cc-a` / `-cc-b` / `-cc-c`.

Se a porta 5432 do host estiver ocupada, mude `DB_PORT` no `.env` e a porta em `DATABASE_URL` e `TEST_DATABASE_URL`.

### Testes

Os testes usam um Postgres real (o banco `elevate_test` do compose), porque os testes de concorrência dependem de locks de verdade.

```bash
docker compose up -d db         # só o banco
npm ci
npm test                        # API (unitários, integração, concorrência) + web
npm run lint
npm run typecheck
```

O CI (GitHub Actions, `.github/workflows/ci.yml`) roda lint, typecheck, formatação, a suíte inteira contra um Postgres 17 e o build.

### Scripts de demonstração (funcionam em PowerShell e bash)

```bash
npm run load:leads -- 100                                   # 100 leads simultâneos, mostra o split por call center
npm run webhook:send -- --status contacted --duplicate      # mesmo evento duas vezes -> "duplicate"
npm run webhook:send -- --cc cc-b --out-of-order            # sale chega antes de contacted -> fica sale
npm run db:seed-bulk -- 100000                              # 100k leads sintéticos (EXPLAIN)
npm run db:explain                                          # EXPLAIN (ANALYZE, BUFFERS) das consultas principais
```

O intake tem rate limit de 60 req/min por IP. Para a demo de carga, suba o limite antes do `docker compose up`: `RATE_LIMIT_LEADS_PER_MIN=100000` no `.env`. O script avisa se receber 429.

---

## 2. Arquitetura

```
                      ┌──────────────────────────────┐
 Landing pages ─────► │ POST /api/leads   (público)  │
                      │                              │        ┌──────────────┐
 Call centers ──────► │ POST /api/webhooks/callcenter│ ─────► │ PostgreSQL   │
  (HMAC)              │            (HMAC)            │        │ (única fonte │
                      │      Fastify API (:3001)     │ ◄───── │  de estado)  │
 Navegador ─► Next.js │ /api/auth /leads /dashboard  │        └──────────────┘
  (cookie)   (:3000)  │ /catalog /admin              │
     rewrite /api/* ─►└──────────────────────────────┘
```

**Sem Redis, fila nem worker.** A distribuição precisa ser atômica com o insert do lead; uma transação no Postgres entrega isso sem sistema distribuído e sem um serviço a mais para operar e testar. O custo (um ponto de serialização) e a evolução estão nas seções 5 e 7.

### Fluxo de um lead, do recebimento ao webhook

1. A landing page envia `POST /api/leads`.
2. A API valida com Zod e normaliza: e-mail em minúsculas, telefone em E.164 (`libphonenumber-js`), slugs em minúsculas. Resolve o produto e o funil (o funil precisa pertencer ao produto, e os dois precisam estar ativos).
3. **Uma transação:**
   1. Encontra ou cria o afiliado (um código desconhecido não faz perder o lead).
   2. `INSERT lead … ON CONFLICT (dedupe_key) DO NOTHING`. Se o lead já existe, responde `200 {duplicate: true}` e termina, sem nova distribuição.
   3. Grava o evento `new` no histórico.
   4. **Dispatcher:** trava os call centers elegíveis (`FOR NO KEY UPDATE`, por `id`), escolhe por Smooth Weighted Round Robin, atualiza os créditos, grava em `distributions` e espelha em `leads.call_center_id`.
   5. `COMMIT` e resposta `201 {success, lead_id, duplicate: false}`. Sem call center elegível, o lead fica **pendente** e a resposta continua 201.
4. O call center chama `POST /api/webhooks/callcenter`, assinado com HMAC. A API:
   1. confere a assinatura sobre o corpo cru e a janela de timestamp;
   2. trava o lead;
   3. confere que o lead foi distribuído para esse call center;
   4. grava o evento (com dedupe);
   5. recalcula `leads.status` a partir de todo o histórico.
5. ADMIN e OPERATOR acompanham no painel. O OPERATOR também troca o status manualmente, o que gera um evento `operator` com autor.

### Módulos

```
apps/api/src
├── app.ts · server.ts           buildApp() é uma factory sem efeitos colaterais; server.ts só faz o listen
├── config/env.ts                variáveis validadas com Zod no startup
├── db/                          schema Drizzle, migrations SQL revisadas, seed, seed-bulk
├── plugins/                     auth (sessão + default-deny + Origin), error handler
├── shared/                      erros, uuidv7, senha (Argon2id), serializer de log
└── modules/
    ├── leads/        intake (schema, normalize, dedupe, service), lista, detalhe, escopo
    ├── dispatcher/   algorithm.ts (puro), service, repository, rotas admin
    ├── status/       state-machine.ts e reducer.ts (puros), service
    ├── webhooks/     signature.ts (puro), schema, service, rota com corpo cru
    ├── auth/ catalog/ dashboard/ health/
apps/web/src                     Next.js: login, painel, leads, detalhe, dispatcher
scripts/                         load-leads, send-webhook, explain-queries (Node puro)
```

**Camadas:** a regra fica em service e domínio puro, o SQL fica só no repository, e a rota só trata HTTP. O domínio puro (algoritmo, máquina de estados, reducer, assinatura, normalizadores) é testado sem banco.

---

## 3. Decisões técnicas

Cada decisão importante tem um ADR curto em [docs/decisions](docs/decisions).

### Stack
- **Fastify:** leve, com `inject()` para testes de integração e concorrência sem subir porta, e parser de corpo cru por rota (necessário para o HMAC).
- **Drizzle:** SQL próximo do metal (`FOR NO KEY UPDATE`, `SKIP LOCKED`, `ON CONFLICT`, índices parciais e `DESC`) e migrations em SQL versionado, revisadas à mão.
- **Next.js com rewrite `/api/*`:** o navegador só fala com a própria origem, então não há CORS e o cookie de sessão pertence ao front.

### Idempotência e duplicidade (§8) — [ADR-003](docs/decisions/ADR-003-intake-idempotency.md)
- **Uma coluna, `leads.dedupe_key`, com `UNIQUE`.**
  - Com o header `Idempotency-Key`, ela vale `idem:` + sha256(chave).
  - Sem o header, ela vale `fp:` + sha256(produto, funil, e-mail, telefone), ou seja, a mesma pessoa no mesmo funil.
- **Quem decide a corrida é a constraint:** `INSERT … ON CONFLICT DO NOTHING`. Teste: 100 requisições idênticas e simultâneas criam 1 lead e 1 distribuição.
- **Reuso de chave:** a mesma `Idempotency-Key` com corpo diferente (comparado pelo hash do input normalizado) dá `422 idempotency_key_reuse`.

### Dispatcher e concorrência (§12, §13) — [ADR-001](docs/decisions/ADR-001-dispatcher-locking-swrr.md)
- **Smooth Weighted Round Robin** (o do nginx), numa função pura.
  - Cada call center guarda um crédito inteiro.
  - A cada lead, todos ganham o próprio peso. O de maior crédito vence e devolve o total.
  - A cada 10 leads (com 50/30/20) a divisão é **exata** e os créditos voltam a zero.
  - A sequência é intercalada: `A,B,C,A,A,B,A,C,B,A`.
  - Um sorteio aleatório só converge no longo prazo e deixaria os testes instáveis.
- **Sem condição de corrida:**
  - O dispatcher roda **na mesma transação** do insert do lead.
  - Ele trava os call centers com `SELECT … ORDER BY id FOR NO KEY UPDATE`: o segundo dispatcher espera o commit do primeiro e relê os créditos já gravados.
  - A ordem fixa de aquisição evita deadlock.
  - `UNIQUE (distributions.lead_id)` é a segunda barreira.
- **O lock é pego depois do insert do lead.** A seção crítica fica mínima, e duplicatas nunca tocam no lock.
- **Teste:** 100 leads simultâneos (pool de 20 conexões) dão 100 × 201 e **exatamente 50/30/20**, com os créditos de volta a zero. Removendo o lock, o mesmo teste falha (deu 52/…).
- **Saturação:** `lock_timeout` (3 s) ou `statement_timeout` (5 s) estourado, ou pool de conexões esgotado, viram `503` com `Retry-After`. A transação é desfeita, e o reenvio é seguro porque o intake é idempotente.
- **Pesos:** `PATCH /api/admin/call-centers/:id` altera peso ou ativo e **zera os créditos** na mesma transação, para não haver rajada de compensação. Peso 0 ou inativo tira o call center da rotação.
- **Pendentes** (sem call center elegível) são distribuídos depois por `redispatch-pending`, em lotes com `FOR UPDATE SKIP LOCKED`. Duas execuções simultâneas dividem o trabalho sem distribuir nada duas vezes, e há teste disso.
- **Envio ao call center:** não há integração externa. A distribuição registrada no banco é o "envio", e o call center recebe e devolve via webhook (como o §12 permite).

### Webhook: segurança, duplicidade e ordem (§14 a §17) — [ADR-004](docs/decisions/ADR-004-webhook-hmac.md), [ADR-002](docs/decisions/ADR-002-event-log-reducer.md)
- **Payload:** o mesmo do enunciado (`lead_id`, `external_id`, `status`, `timestamp`), com `event_id` e `note` opcionais. Chaves desconhecidas dão 422, porque é um contrato máquina a máquina.
- **Segurança (HMAC-SHA256, um segredo por call center):** veja a seção 4.
- **Duplicado:**
  - `event_key` = sha256(call center, `external_id`, status, timestamp em UTC, `event_id`).
  - `UNIQUE (lead_id, event_key)` com `ON CONFLICT DO NOTHING`. Um reenvio responde `200 {result: "duplicate"}` e não grava nada.
  - Teste: 30 entregas idênticas e simultâneas gravam 1 evento.
- **Fora de ordem:**
  - **O log de eventos é a verdade; `leads.status` é uma projeção.**
  - A cada evento, todo o histórico do lead é reaplicado em ordem de `timestamp` (desempate por um rank fixo por status), partindo de `new`. Transições inválidas da máquina de estados são ignoradas, mas ficam gravadas.
  - Assim, `contacted` chegando depois de `sale` não rebaixa o status, e um `refund` que chega antes do `sale` passa a valer quando o `sale` chega.
  - O resultado é o mesmo para **qualquer ordem de chegada**: o teste unitário verifica as 720 permutações de um histórico de 6 eventos.
  - **Concorrência:** a transação do webhook começa com `SELECT … FROM leads WHERE id = $1 FOR UPDATE`. Webhooks do mesmo lead entram em fila; o teste com históricos de 12 eventos embaralhados enviados de uma vez falha sem esse lock e passa com ele.
- **Resposta:** `200 {result}`, com `applied` (o status mudou), `ignored` (o evento foi gravado mas não muda o status atual) ou `duplicate`.
- **`new` não é aceito no webhook** (422): é o estado inicial do sistema, e nenhuma transição leva a ele.

**Máquina de estados** (`modules/status/state-machine.ts`):

| De \ Para | contacted | no_answer | callback | qualified | sale | refund | invalid |
|---|---|---|---|---|---|---|---|
| new | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| contacted | – | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| no_answer | ✓ | – | ✓ | ✓ | ✓ | – | ✓ |
| callback | ✓ | ✓ | – | ✓ | ✓ | – | ✓ |
| qualified | – | – | ✓ | – | ✓ | – | ✓ |
| sale | – | – | – | – | – | ✓ | – |
| refund, invalid | finais | | | | | | |

**Troca manual pelo operador:** usa o mesmo log e o mesmo reducer, mas é validada contra o status **atual** antes de gravar. Uma transição inválida dá `409` com feedback imediato, e a tela só oferece o `allowed_next` que a API devolve.

### Banco de dados (§9)
- **Tabelas:** `products`, `funnels` (`UNIQUE (product_id, slug)`), `affiliates`, `call_centers`, `leads`, `distributions` (auditoria com snapshot de pesos e créditos), `lead_status_events` (append-only), `users`, `sessions`.
- **Restrições:**
  - `CHECK` garante que um OPERATOR **sempre** tem call center e um ADMIN **nunca** tem;
  - `CHECK (weight >= 0)`.
- **Tipos e ids:**
  - timestamps em `timestamptz`;
  - `leads.id` é UUIDv7 gerado na aplicação (ordenado no tempo: melhor localidade no índice);
  - `call_centers.id` é inteiro sequencial, porque o lock e o desempate do dispatcher usam `ORDER BY id`.
- **`leads.call_center_id` espelha `distributions`** para permitir índices compostos no filtro mais usado ([ADR-007](docs/decisions/ADR-007-denormalized-call-center.md)).
- **Migrations:** geradas pelo drizzle-kit e revisadas à mão (`apps/api/src/db/migrations`), aplicadas pelo serviço `migrate` do compose e pelo setup dos testes.

### Índices (§10)

Cada índice tem, na migration, um comentário com a consulta que atende. Medido com cerca de 103 mil leads (`npm run db:seed-bulk` seguido de `npm run db:explain`):

| Índice | Consulta | Plano medido |
|---|---|---|
| `leads (created_at DESC, id DESC)` | lista do ADMIN, período, "hoje" | Index Scan, sem Sort, 0,36 ms |
| `leads (call_center_id, created_at DESC, id DESC)` | lista do OPERATOR, filtro por call center | Index Scan, 0,33 ms |
| `leads (status, created_at DESC, id DESC)` | filtro por status | Index Scan, 0,26 ms |
| `leads (product_id, funnel_id, created_at DESC, id DESC)` | filtro por produto / funil | Index Scan, 0,29 ms |
| `leads (source, created_at DESC, id DESC)` | filtro por origem | Index Scan, 0,23 ms |
| `leads (id) WHERE call_center_id IS NULL` (parcial) | fila de pendentes | Index Only Scan, 0,11 ms |
| mesmo `(created_at DESC, id DESC)` | próxima página por cursor | `ROW(created_at, id) < …` como Index Cond, 0,31 ms |
| `lead_status_events (lead_id, event_ts)` + `UNIQUE (lead_id, event_key)` | reducer e dedupe do webhook | — |
| `distributions (call_center_id, distributed_at DESC)` | resumo do dispatcher | — |
| `UNIQUE leads(dedupe_key)`, `users(email)`, `funnels(product_id, slug)`, PK de `sessions` | idempotência, login, intake, auth | — |

Detalhe que fez diferença: o drizzle-kit gera `DESC NULLS LAST`, mas o `ORDER BY x DESC` do Postgres é `NULLS FIRST`. Com a ordem de nulls diferente, o planner acrescentava um Sort, então os índices declaram `NULLS FIRST`. Não indexei nome, e-mail nem telefone, porque nenhuma tela busca por eles na v1.

As métricas e o resumo do dispatcher são agregados sobre a tabela inteira: cerca de 43 ms e 31 ms com 100k (Seq Scan em paralelo). A evolução está na seção 5.

### Painel, métricas, filtros e paginação (§18, §19)
- **Total:** todos os leads recebidos (duplicatas nunca são gravadas duas vezes).
- **Hoje:** criados desde a meia-noite em `America/Sao_Paulo`, e não em UTC.
- **Distribuídos / pendentes:** com ou sem call center.
- **Vendas:** leads cujo status **atual** é `sale`. Um reembolso deixa de contar.
- **Conversão:** vendas ÷ total de leads (0 quando não há leads).
- **Filtros por whitelist** na URL (período, produto, funil, origem, call center, status). Um parâmetro desconhecido dá 422.
- **Paginação keyset** em `(created_at, id)`, sem `OFFSET` e sem `COUNT(*)` ([ADR-006](docs/decisions/ADR-006-keyset-pagination.md)). O cursor carrega o timestamp com **microssegundos**; com milissegundos, um teste perdia 5 de 7 linhas na fronteira da página.

### Autenticação e autorização (§20, §21) — [ADR-005](docs/decisions/ADR-005-session-not-jwt.md)
- **Sessão no servidor:**
  - cookie `sid` com `httpOnly`, `SameSite=Strict` e `Secure`;
  - no banco fica só o sha256 do token;
  - logout e desativação valem na hora.
- **Fechado por padrão:**
  - toda rota exige sessão, exceto a allowlist (intake, webhook, login, `/health`, `/ready`);
  - um teste descobre as rotas registradas na aplicação e falha se surgir rota pública nova ou rota protegida que não responda 401.
- **ADMIN:** vê tudo, as métricas e o dispatcher, e configura pesos.
- **OPERATOR:** o escopo vem **da sessão**, e todas as funções de leitura e escrita de lead do repository recebem esse escopo como parâmetro obrigatório.
  - Lead de outro call center dá **404**, sem revelar que existe.
  - Rota admin dá **403**.
  - Parâmetros de URL não ampliam o escopo.
  - Tudo isso é testado por requisição direta à API, não só pela interface.

---

## 4. Segurança (§22)

| Risco | O que foi implementado |
|---|---|
| Autenticação | Argon2id (parâmetros OWASP). Resposta idêntica e tempo equivalente para e-mail inexistente, senha errada e conta inativa ou bloqueada. |
| Autorização | Default-deny com teste de allowlist; escopo de call center obrigatório no repository; 404 fora do escopo, 403 em admin. |
| Brute force | Lockout por conta (5 falhas → 15 min, com contador atômico) e rate limit por IP no login. |
| Rate limiting | `@fastify/rate-limit` por IP: global 300/min, intake 60/min, webhook 120/min, login 30/min (veja as limitações). |
| SQL injection | Todo SQL é parametrizado (Drizzle ou `sql` com binds, inclusive o `set_config` de timeouts). Filtros e ordenação por whitelist. Nenhum `sql.raw`. |
| XSS | React escapa por padrão; não há `dangerouslySetInnerHTML`. CSP restrita no web e headers de segurança na API (helmet). |
| CSRF | Cookie `SameSite=Strict`, mais um `Origin` fora de `ALLOWED_ORIGINS` em escritas com cookie (e no login) dando 403. Webhook e intake não usam cookie. |
| Webhook falso | HMAC-SHA256 sobre o corpo cru e o timestamp, `timingSafeEqual`, janela de 5 min, 401 genérico, escopo por call center. |
| Exposição de dados | Respostas com shape explícito (`password_hash` e `webhook_secret` nunca saem). Logs com redact de cookie, authorization, assinatura, e-mail e telefone, e um serializer de erro que remove os parâmetros SQL (PII) das mensagens de erro de banco. Stack trace nunca vai na resposta. |
| Validação de entrada | Zod em corpo, query, headers e env; limite de 16 KB no corpo; 415 para content-type que não seja JSON. |
| Redirect aberto | O `?next=` do login passa pelo parser de URL e só aceita caminhos do próprio site (o filtro por string anterior aceitava `/\evil.com`). |
| Segredos | Só por variável de ambiente; `.env` fora do git. |

---

## 5. Escalabilidade (§11)

Medido nesta máquina (Docker Desktop/WSL2, pool de 10 conexões): **cerca de 100 leads/s com 100 simultâneos e 130 a 150 leads/s com 500 a 1000**, sempre com o split exato.

| Volume | Comportamento e ações |
|---|---|
| **100 mil** | Um Postgres basta. Todas as listas são range scan por índice, abaixo de 1 ms (seção 3). |
| **1 milhão** | Keyset já evita `OFFSET`. Ações: PgBouncer; réplica de leitura para painel e listas; métricas por tabela de agregados diários em vez de `count(*)` ao vivo; revisar índices não usados (`pg_stat_user_indexes`); autovacuum ajustado; tabela de origens conhecidas para o filtro (sem skip scan no PG 17). |
| **10 milhões ou mais** | Particionar `leads` e `lead_status_events` por mês (partition pruning nas consultas por período, arquivamento barato). Armadilha: em tabela particionada, `UNIQUE` exige a chave de partição, então a deduplicação vai para uma tabela `lead_dedupe(dedupe_key pk, lead_id)` não particionada. UUIDv7 mantém a escrita nas partições quentes. |
| **Dispatcher** | O lock em `call_centers` é um ponto de serialização: ~100–150 leads/s aqui. Evolução, em ordem: distribuição em lote por transação; shard por produto (um conjunto de créditos por shard); contadores atômicos em Redis com reconciliação, aceitando o lead nascer pendente por milissegundos. |
| **Webhooks** | Transação curta e lock só do lead (leads diferentes em paralelo). Num pico de retries, a evolução é aceitar e processar via fila, mantendo o dedupe por `event_key`. |
| **Rate limit** | Store em memória (uma instância). Com várias instâncias, o mesmo plugin usa Redis. |

---

## 6. Limitações

Coisas que ficaram de fora ou foram aceitas conscientemente:
- **IP do cliente atrás do Next:** o rewrite do Next.js não envia o IP real e repassa um `X-Forwarded-For` enviado pelo cliente, então ele **não** é tratado como proxy confiável (isso permitiria burlar o rate limit). Consequência: as chamadas do navegador compartilham o IP do container web, e os limites por IP valem para todos os usuários do painel juntos (por isso o login tem 30/min, e o lockout por conta é a defesa contra força bruta). Em produção, um proxy de borda (nginx/ALB) que sobrescreve `X-Forwarded-For` entraria em `TRUST_PROXY`.
- **O intake é servidor a servidor:** não há CORS. Uma landing page que chame a API direto do navegador, de outro domínio, precisaria de CORS só nessa rota.
- **`Idempotency-Key` desliga o fingerprint:** a mesma pessoa enviada com chaves diferentes vira dois leads.
- **Deduplicação sem janela de tempo:** a mesma pessoa no mesmo funil meses depois volta como duplicata.
- **Relógio do call center:** a ordem usa o `timestamp` do call center (skew de até 5 min é aceito). Se um evento com hora futura impede uma troca manual, a API responde `409 status_superseded` e não grava nada.
- **Lockout:** pode ser usado para trancar a conta de outra pessoa. Sob uma rajada paralela muito grande, algumas tentativas além da 5ª podem ser verificadas antes de o bloqueio ser gravado.
- **`Origin`:** é checado quando o navegador o envia; uma requisição com cookie e sem `Origin` passa, e o `SameSite=Strict` é a barreira principal.
- **CSP do web:** usa `script-src 'unsafe-inline'`, exigido pelos scripts inline do Next. Melhoria: CSP com nonce.
- **Sessões e logout:** sessões expiradas não são apagadas (são ignoradas na leitura); logout com sessão já expirada responde 401.
- **Rotação de segredo do webhook** não implementada.
- **Testes de interface:** o front tem testes só das funções puras (filtros, redirect). O fluxo de tela foi verificado manualmente no navegador.
- **Rotas fora do escopo:** sem OpenAPI/Swagger; sem tela de cadastro de produtos, funis ou usuários (vêm do seed).

## 7. Melhorias futuras

- Rotação de segredo do webhook (aceitar o atual e o anterior).
- Redis para o rate limit com várias instâncias, e fila para picos de webhook.
- Agregados diários para as métricas; particionamento a partir de ~10M.
- CSP com nonce; auditoria de login (tentativas e IPs); limpeza periódica de sessões.
- OpenAPI gerado a partir dos schemas Zod; testes de componente no front.
- LGPD: política de retenção e anonimização de leads antigos; criptografia por coluna de e-mail e telefone.
- Tela de administração de produtos, funis e usuários.

---

## 8. Como usei IA

Usei o **Claude Code** (modelo Claude Opus, no app desktop) como par de programação do começo ao fim. Para a revisão final, abri uma **segunda sessão com contexto limpo**, que não tinha visto nada da implementação. Para conferir a interface, usei o navegador embutido do próprio app.

### Como conduzi

Antes de pedir qualquer código, escrevi o [PLAN.md](PLAN.md) e o [CLAUDE.md](CLAUDE.md) e os deixei no primeiro commit:
- o **PLAN.md** tem o escopo, o modelo de dados, as decisões e a divisão em fases;
- o **CLAUDE.md** tem as regras que eu queria ver respeitadas: stack fixa, camadas, segurança, testes, git e Windows.

A ideia era a IA trabalhar dentro de limites que eu defini, e não inventar o projeto a partir do enunciado.

Trabalhei uma fase por vez, sempre no mesmo ciclo:
1. a IA propunha um plano com os arquivos e os testes;
2. eu aprovava ou ajustava;
3. ela implementava (no domínio puro, o teste vinha antes do código);
4. rodava lint, typecheck e testes;
5. eu lia o diff;
6. só então fazia os commits;
7. o push esperava a minha aprovação da fase.

Em nenhum momento a IA commitou ou deu push sem eu ter revisado.

### O que eu decidi

Sempre que o plano não cobria um ponto, a IA parava e perguntava, e a decisão era minha. Algumas delas:
- driver `pg` e `tsx` só em desenvolvimento;
- UUIDv7 com uma função própria, em vez de mais uma dependência;
- `source` obrigatório no intake;
- quais plugins do Fastify entrariam: cookie, rate limit e helmet;
- não expor a rota de redistribuição antes de existir autenticação;
- antecipar o detalhe e a troca de status do lead para a fase de autenticação, para testar a matriz de autorização de verdade;
- a direção visual do front;
- aceitar que, atrás do proxy do Next, o limite de login é por instância e não por cliente, documentando isso em vez de confiar num `X-Forwarded-For` falsificável.

Também voltei atrás em uma decisão minha. No início eu deixei `CLAUDE.md` e `docs/` fora do git. Ao reler o §25 do enunciado, percebi que isso escondia justamente o que o avaliador precisa ver, e passei a versionar tudo.

### O que a IA errou (e como apareceu)

Os erros não foram poucos, e quase todos foram pegos por teste ou por eu tentar quebrar o sistema:
- **Queda da API.** Ela caía quando o Postgres derrubava uma conexão ociosa. Apareceu quando parei o banco com a API no ar. Faltava tratar o erro do pool.
- **500 sob carga.** Com 1000 leads simultâneos, 61 requisições deram 500 por espera de conexão. Passou a ser `503` com `Retry-After`.
- **`distributed_at` truncado** em milissegundos no lead e diferente do valor da distribuição. O teste de consistência pegou.
- **Índices `DESC NULLS LAST`.** Foi o que o drizzle-kit gerou, e o Postgres não usava esses índices para ordenar. Confirmei com `EXPLAIN` e ajustei a migration à mão.
- **Rate limit sem efeito.** O plugin não pegava as rotas, que eram registradas antes de ele carregar. O teste esperava 429 e recebia 401.
- **Testes fracos.**
  - Uma fixture de webhook tinha eventos com data anterior à criação do lead.
  - O primeiro teste de concorrência do webhook só detectava a race em 1 de 3 execuções. Pedi para reescrever até ele falhar sempre sem o lock.
- **Contrato do webhook.** Usávamos `event_ts`, mas o exemplo do enunciado manda `timestamp`. Corrigi para seguir o contrato.

A revisão independente da última fase encontrou 5 pontos médios e 9 baixos, nenhum crítico. Corrigi os médios, cada um com teste:
- um open redirect no `?next=` do login;
- dados pessoais indo para o log junto com os parâmetros SQL em erros de banco;
- o lock do dispatcher (`FOR UPDATE`) bloqueando a checagem de FK dos webhooks, trocado por `FOR NO KEY UPDATE`;
- o `statement_timeout` virando 500;
- a troca manual de status respondendo 200 com um status diferente do pedido.

O que sobrou da revisão está nas [limitações](#6-limitações).

### Como validei

Não aceitei nada só porque "parecia certo":
- **Testes com Postgres real.** Nada de mock nas regras de concorrência.
- **Testes de mutação manuais.** Tirei o lock do dispatcher e conferi que o teste de 100 leads falha (deu 52/… em vez de 50/30/20). Fiz o mesmo com o cursor e com os mapeamentos de erro.
- **`EXPLAIN (ANALYZE)`** com 100 mil leads.
- **`docker compose up`** a partir de uma cópia limpa do repositório.
- **Navegação real no painel** como ADMIN e como OPERATOR, inclusive só pelo teclado, no tema escuro e no celular.
- **Leitura de cada diff** antes do commit.

O registro fase a fase está em [docs/ai/AI-LOG.md](docs/ai/AI-LOG.md).
