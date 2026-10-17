# CLAUDE.md — Elevate Lead Dispatcher

Teste técnico de Desenvolvedor Full Stack Sênior (Grupo Elevate). O projeto será apresentado e alterado ao vivo pelo autor, então todo código precisa ser simples de ler e de explicar.

**Leia `PLAN.md` antes de qualquer tarefa.** Ele define escopo, arquitetura, modelo de dados e decisões. Se este arquivo, o `PLAN.md` e o pedido do usuário divergirem, pare e pergunte antes de seguir.

## Repositório e ambiente

- Remoto: `https://github.com/vLecaBR/Elevate-Lead-Dispatcher` (`origin`, já configurado).
- Pasta local (você já está nela): `C:\Code\Elevate-Lead-Dispatcher`. É um clone na branch `main`.
- **O repositório já existe. Nunca rode `git init`.** Antes de começar, confira com `git status`, `git remote -v` e `git branch --show-current`.
- Sistema do autor: **Windows**. O shell pode ser PowerShell, cmd ou Git Bash; verifique qual está em uso antes de rodar comandos.
  - Scripts do `package.json` e scripts em geral precisam funcionar no Windows e no Linux: nada de `export VAR=x`, `rm -rf`, `cp`, `&&` assumindo bash. Use scripts Node (`node scripts/x.mjs`) e `node --env-file=.env` para variáveis de ambiente. Se precisar de uma dependência para isso (ex.: `cross-env`), pergunte antes.
  - Use `path.join`/`path.resolve` no código. Em arquivos de configuração (compose, tsconfig, Dockerfile), use `/`.
  - **Finais de linha: LF.** O `.gitattributes` do repositório força `eol=lf`. Não crie arquivo com CRLF, principalmente `.sh`, `Dockerfile` e SQL de migration.
  - Docker roda via Docker Desktop (WSL2), com `docker compose` (v2). Nunca faça bind mount de `node_modules` do Windows para dentro do container; as imagens instalam dependências no build (`npm ci`).
  - A porta 5432 do host pode estar ocupada por um Postgres local: o compose mapeia `${DB_PORT:-5432}:5432`.
- Documentação que acompanha o código (README, ADRs) em português; veja "Padrões de código".

## Stack (fixa)

TypeScript (`strict`) · Node.js LTS · Fastify · Zod · Drizzle ORM + drizzle-kit · PostgreSQL 17 · Next.js (App Router) + Tailwind + TanStack Query · Vitest · Docker Compose.

- Não adicionar Redis, fila, worker nem qualquer serviço novo.
- Não adicionar dependência que não esteja no plano sem perguntar antes (diga o que resolve e a alternativa sem ela).
- Antes de usar uma API de biblioteca da qual não tem certeza, consulte a documentação atual ou o código instalado em `node_modules`. Não invente assinaturas.

## Comandos

(Criados na Fase 1. Se mudarem, atualize esta seção no mesmo commit. Devem funcionar em PowerShell e em bash.)

```
docker compose up --build        # sobe db, migrate, api, web
npm run dev:api | dev:web        # desenvolvimento local
npm test                         # toda a suíte (precisa do Postgres de teste)
npm run test:api                 # só a API
npm run lint && npm run typecheck
npm run db:generate              # gera migration a partir do schema
npm run db:migrate
npm run db:seed                  # exige SEED_DEMO=true
npm run db:seed-bulk -- 100000   # leads sintéticos para EXPLAIN (exige SEED_DEMO=true)
npm run db:explain               # EXPLAIN (ANALYZE, BUFFERS) das consultas principais
npm run load:leads -- 100        # N leads simultâneos contra a API (demo do dispatcher)
npm run webhook:send -- --status contacted [--duplicate | --out-of-order]
npm run format:check             # Prettier
```

## Estrutura e camadas

Veja `PLAN.md` §3.3. Regras:

- **Domínio puro** (`algorithm.ts`, `state-machine.ts`, `reducer.ts`, `signature.ts`, normalizadores): sem I/O, sem importar banco ou Fastify. Testado sem banco.
- **Service** orquestra transações e regras. **Repository** é o único lugar com SQL. **Route** só trata HTTP.
- Nenhum SQL em rota. Nenhuma regra de negócio em repository.
- `buildApp()` é uma factory sem efeitos colaterais; `server.ts` só faz o listen.

## Banco de dados

- Mudança de estrutura **só por migration versionada**. Revise o SQL gerado; edite à mão para índices parciais e CHECKs.
- Todo índice criado tem um comentário SQL com a consulta que ele atende (`PLAN.md` §5). Não criar índice sem consulta alvo.
- SQL parametrizado sempre. Proibido concatenar ou interpolar valores em strings SQL. Filtros e ordenação por whitelist/enum.
- Transações: READ COMMITTED com locks explícitos (`FOR UPDATE`), conforme `PLAN.md` §8 e §9. Ordem de aquisição de locks: sempre `call_centers` por `id`; lead antes do evento.
- Nada de `SELECT *` em código de produção; liste as colunas.
- Timestamps em `timestamptz`; UUIDv7 gerado na aplicação para `leads.id`.

## Regras de segurança (não negociáveis)

- Rotas `/api/*` são **default-deny**: exigem sessão, exceto a allowlist do `PLAN.md` §10. Rota nova nasce protegida.
- O escopo de call center do OPERATOR vem **da sessão**, nunca de parâmetro do cliente, e é argumento obrigatório das funções de leitura/escrita de leads no repository.
- Recurso fora de escopo responde `404`; rota admin sem papel responde `403`.
- Webhook: HMAC sobre o **corpo cru** + timestamp, comparação com `crypto.timingSafeEqual`.
- Nunca serializar linha do banco diretamente na resposta; use schemas de saída explícitos. Nunca retornar `password_hash` nem `webhook_secret`.
- Logs com Pino e `redact` para cookie, authorization, assinatura, e-mail e telefone. Nunca logar corpo de requisição completo.
- Segredos só por variável de ambiente. `.env` fora do git; `.env.example` sem valores reais.
- Frontend: proibido `dangerouslySetInnerHTML`. Campos vindos de formulário público (nome, campanha) são tratados como não confiáveis.

## Testes

- Banco real (`elevate_test`), nunca SQLite nem mock de banco para regras de concorrência.
- Domínio puro: escreva o teste **antes** da implementação.
- Testes de concorrência: pool pequeno para forçar contenção; assertivas sobre contagens e estado final, nunca sobre ordem de resposta.
- Todo bug corrigido ganha um teste que o reproduz.
- Não marque um teste como `skip` para fazer a suíte passar.

## Git

- Trabalhe direto na branch `main`, com histórico linear.
- Commits pequenos e frequentes, um por unidade lógica, no padrão Conventional Commits em inglês (`feat(leads): ...`, `test(dispatcher): ...`, `docs(adr): ...`). Mensagem explica o que mudou e por quê.
- **Nunca reescrever o histórico** (sem `rebase`, `commit --amend` após push, `reset --hard`, `push --force`). Se um `git push` for rejeitado, **pare e pergunte**; não force.
- Não commite sem o usuário ter revisado o diff, a menos que ele peça explicitamente. Faça `git push` somente quando o usuário aprovar a fase.
- Nunca commite `.env`, `node_modules`, `.next`, `dist` ou qualquer segredo. Antes de cada commit, olhe `git status` e `git diff --staged`.
- Mantenha no repositório: `CLAUDE.md`, `PLAN.md`, `docs/decisions/*`, `docs/ai/AI-LOG.md`.

## Como trabalhar

1. Ao receber uma fase, entre em plan mode e liste os arquivos que vai criar ou alterar e os testes que vai escrever. Espere aprovação.
2. Implemente em passos pequenos: teste → código → refatoração.
3. Ao terminar: rode `npm run lint`, `npm run typecheck` e `npm test`. Resuma em poucas linhas o que mudou, o que **não** foi feito e quaisquer dúvidas. Depois **pare** e aguarde revisão.
4. Registre decisões relevantes em `docs/decisions/ADR-NNN-titulo.md` (contexto, decisão, alternativas, trade-offs; máximo ~1 página).
5. Se algo no plano parecer errado ou arriscado, diga isso e proponha a alternativa em vez de seguir em silêncio ou desviar sem avisar.
6. Não implemente nada fora da fase atual. Funcionalidade nova fora do plano precisa de aprovação.

## Padrões de código

- Código, nomes, comentários técnicos e mensagens de commit em inglês. README e ADRs em português.
- Funções pequenas, nomes que descrevem intenção, sem abstrações especulativas.
- Comentário explica **por que**, não **o quê**. Em pontos críticos (lock, transação, HMAC, reducer) o comentário do porquê é obrigatório.
- Erros de domínio tipados (`AppError` com `code` e status HTTP); handler central converte para o formato único de erro (`PLAN.md` §6).
- Configuração por `env.ts` validado com Zod no startup; nada de `process.env` espalhado.
- Sem `any`. Sem `// @ts-ignore` sem justificativa.

## Não fazer

- Não gerar o projeto inteiro de uma vez. Uma fase por vez, com revisão entre elas.
- Não alterar `PLAN.md` ou este arquivo sem o usuário pedir.
- Não escrever entradas no `docs/ai/AI-LOG.md` por conta própria nem inventar fatos: o log é do autor. Você pode sugerir o texto, mas ele só registra o que realmente aconteceu e foi decidido por ele.
- Não criar funcionalidade superficial só para marcar um requisito do enunciado; prefira menor e sólido, com a pendência documentada.
