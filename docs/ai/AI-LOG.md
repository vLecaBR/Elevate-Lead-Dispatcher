# AI-LOG

Diário do uso de IA neste projeto: o que a IA gerou, o que estava errado, o que eu rejeitei ou decidi e como validei.

Fiquei focado em entregar cada fase e não escrevi o diário no calor do momento, como eu pretendia. Consolidei as entradas no fim, a partir do histórico das sessões do Claude Code e dos commits. Tudo o que está aqui aconteceu de fato.

Ferramenta: Claude Code (Claude Opus) no app desktop, em plan mode a cada fase. Na Fase 9 usei também uma segunda sessão com contexto limpo, só para revisão.

---

## 2026-10-15 · Fase 0 · Planejamento
- **O que eu fiz:** escrevi o `PLAN.md` (escopo, modelo de dados, decisões, fases) e o `CLAUDE.md` (regras de stack, camadas, segurança, testes e git) antes de pedir qualquer código. Os dois foram para o primeiro commit.
- **Por quê:** eu não queria uma aplicação gerada de uma vez a partir do enunciado. A IA trabalharia dentro de limites que eu defini, uma fase por vez, sem commitar nem dar push sem a minha revisão.

## 2026-10-15 · Fase 1 · Scaffolding e Docker
- **Contexto que dei à IA:** o CLAUDE.md, as seções do plano da fase e o pedido de conferir o ambiente (git, node, docker, porta 5432) antes de alterar qualquer coisa.
- **O que eu decidi:**
  - driver `pg` (node-postgres), que o plano não fixava;
  - `tsx` para rodar a API em desenvolvimento.
- **Uma decisão que depois desfiz:** eu tinha deixado `CLAUDE.md` e `docs/` no `.gitignore` e respondi que era intencional. Na Fase 9 voltei atrás (veja lá).
- **O que estava errado:** a API caía quando o Postgres derrubava uma conexão ociosa, porque faltava tratar o evento de erro do pool.
- **Como validei:** parei o banco com a API no ar e vi a queda. O teste falha sem a correção e passa com ela.

## 2026-10-15 · Fase 2 · Banco, migrations e seed
- **O que eu decidi:**
  - instalar o argon2 já nesta fase, para o seed criar usuários com hash real em vez de um placeholder;
  - gerar o UUIDv7 com uma função própria em vez de adicionar dependência.
- **O que estava errado:** o drizzle-kit gerou os índices com `DESC NULLS LAST`. Como `ORDER BY ... DESC` no Postgres é `NULLS FIRST`, o planner fazia um Sort em vez de usar o índice.
- **Como validei:** `EXPLAIN` antes e depois. Com a migration ajustada à mão, virou Index Only Scan.

## 2026-10-15 · Fase 3 · Recebimento de leads
- **O que eu decidi:**
  - `source` obrigatório; o plano estava ambíguo e a coluna era nullable;
  - o escopo de call center no repository ficaria para a Fase 6, porque o intake é público e não tem sessão.
- **Como validei:** testes de integração para 201, 200 (reenvio), 422, 413 e 415, e leitura do diff antes dos commits.

## 2026-10-15/16 · Fase 4 · Dispatcher e concorrência
- **O que eu decidi:**
  - a rota de redistribuição de pendentes não seria exposta antes da autenticação: o service entrou agora, a rota só na Fase 6/7;
  - o ADR seria escrito, mas ficaria fora do commit enquanto `docs/` estava ignorado.
- **O que estava errado:**
  - `distributed_at` saía truncado em milissegundos no lead e diferente do valor em `distributions`;
  - com 1000 leads simultâneos, 61 requisições deram 500 por espera de conexão do pool. Passou a ser `503 service_busy` com `Retry-After`; na execução seguinte as 1000 deram 201.
- **Como validei:**
  - tirei o lock temporariamente e o teste de 100 leads simultâneos deu 52/… em vez de 50/30/20, ou seja, o teste pega a race de verdade;
  - medi a vazão com `npm run load:leads`.

## 2026-10-16 · Fase 5 · Webhook do call center
- **O que estava errado:**
  - uma fixture de teste tinha eventos com data anterior à criação do lead;
  - o primeiro teste de concorrência do webhook só detectava a race em 1 de 3 execuções sem o lock. Pedi mais contenção (mais requisições e várias rodadas) até ele falhar em 6 de 6.
- **Como validei:** testes de duplicado, fora de ordem, assinatura inválida e concorrência, e o reducer testado com todas as 720 ordens de um histórico de 6 eventos.

## 2026-10-16 · Fase 6 · Autenticação e autorização
- **O que eu decidi:**
  - instalar os plugins oficiais do Fastify para cookie, rate limit e helmet;
  - antecipar o detalhe do lead e a troca de status para esta fase, para que a matriz de autorização (403 em rota admin, 404 em lead de outro call center) fosse testada contra rotas reais.
- **O que estava errado:** o rate limit não tinha efeito, porque as rotas eram registradas antes de o plugin carregar. O teste esperava 429 na 6ª tentativa e recebia 401.
- **Como validei:** teste da matriz de autorização, e um teste que descobre todas as rotas da aplicação e falha se aparecer rota pública nova.

## 2026-10-16 · Fase 7 · Listagem, filtros e métricas
- **Como validei:**
  - seed sintético de 100 mil leads e `EXPLAIN (ANALYZE, BUFFERS)` de cada consulta principal (números no README);
  - teste que pagina com timestamps iguais até o microssegundo, porque com milissegundos a paginação pulava linhas.

## 2026-10-16 · Fase 8 · Frontend
- **O que eu pedi:** um front bonito e acessível, sem "cara de IA".
- **O que eu decidi:** entre as direções que a IA propôs, escolhi a "Editorial operacional": papel e tinta, filetes em vez de cards, um único acento e fontes IBM Plex.
- **O que apareceu:**
  - o rewrite do Next não repassa o IP real e deixa passar um `X-Forwarded-For` enviado pelo navegador;
  - eu decidi manter o rewrite e ajustar o limite de login, documentando a limitação, em vez de confiar num header falsificável.
- **Como validei:** naveguei no painel como ADMIN e como OPERATOR, só pelo teclado, no tema escuro e na largura de celular.

## 2026-10-16/17 · Fase 9 · Revisão, documentação e entrega
- **O que eu decidi:**
  - ao reler o §25 do enunciado, desfiz a decisão da Fase 1 e passei a versionar `CLAUDE.md`, os ADRs e este log;
  - o webhook passou a aceitar `timestamp`, como no exemplo do enunciado. Antes era `event_ts`, e um call center que seguisse o exemplo levaria 422.
- **Revisão independente:** pedi uma revisão por uma sessão nova, sem o contexto da implementação. Resultado: 5 achados médios e 9 baixos, nenhum crítico.
  - Corrigidos, cada um com teste que falhava antes:
    - open redirect no `?next=` do login;
    - parâmetros SQL com dados pessoais indo para o log;
    - `FOR UPDATE` no dispatcher bloqueando a checagem de FK dos webhooks, trocado por `FOR NO KEY UPDATE`;
    - `statement_timeout` virando 500;
    - troca manual respondendo 200 com outro status.
  - O restante foi documentado como limitação no README.
- **Como validei:** lint, typecheck e testes no PowerShell e no Git Bash; `docker compose up` a partir de uma cópia limpa do repositório, com o payload exato do enunciado; CI no GitHub Actions.
