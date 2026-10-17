# ADR-005: Sessão no servidor (cookie) em vez de JWT

- Status: aceita
- Data: 2026-10-16

## Contexto
O enunciado (§20 a §22) pede autenticação com os perfis ADMIN e OPERATOR, autorização no backend e proteção contra brute force, CSRF e exposição de dados. O front é Next.js na mesma origem que a API, via rewrite `/api/*`.

## Decisão
- **Login:**
  - Argon2id, com os parâmetros mínimos da OWASP.
  - Se o e-mail não existe, o código verifica contra um hash "fantasma", para igualar o tempo de resposta.
  - Erro de credencial, usuário inativo e conta bloqueada dão a mesma resposta.
- **Sessão:**
  - O token tem 32 bytes aleatórios e vai num cookie `sid` com `httpOnly`, `SameSite=Strict` e `Secure` (padrão ligado).
  - No banco fica só o sha256 do token (`sessions.token_hash`), com TTL de 8 h.
- **Em cada requisição** há uma busca por chave primária que confere a expiração e o `users.is_active`. Logout e desativação valem **na hora**.
- **CSRF:** `SameSite=Strict` é a barreira principal. Escritas com cookie (e o próprio login) que trazem um `Origin` fora de `ALLOWED_ORIGINS` dão 403.
- **Brute force:**
  - lockout por conta: 5 falhas bloqueiam por 15 min, com contador atômico;
  - rate limit por IP no login.

## Alternativas consideradas
- **JWT em `localStorage`:** pode ser lido por JavaScript, então uma falha de XSS rouba a sessão. E a revogação não é imediata.
- **JWT em cookie:** resolve o XSS, mas a revogação ainda exige blocklist (estado no servidor de qualquer jeito), e o token cresce.
- **Redis para as sessões:** é um serviço a mais. O Postgres já atende, e a busca é por PK.

## Consequências e trade-offs
- **Revogação imediata e nada sensível acessível ao JavaScript.**
- **Custo:** uma consulta por requisição autenticada, por PK. Barata, e cacheável se um dia for preciso.
- **Sessões expiradas não são apagadas** (são ignoradas na leitura). Melhoria: limpeza periódica.
- **O lockout pode ser usado para trancar a conta de alguém** (quem sabe o e-mail erra 5 vezes). É um trade-off conhecido; a alternativa seria CAPTCHA ou backoff progressivo.
- **Corrida no lockout:** sob uma rajada paralela muito grande (vários IPs), algumas tentativas além da 5ª podem ser verificadas antes de o bloqueio ser gravado. O rate limit por IP reduz o efeito.
