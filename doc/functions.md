# Documentação de Funções

## Serviços

| Função | Local | Parâmetros | Retorno | Responsabilidade |
| --- | --- | --- | --- | --- |
| `authService.initiateAppLogin` | `src/services/auth.service.js` | `username`, `password`, `scope`, `extraHeaders`, `clientContext` | `{ sessionToken, message, ttl }` | Inicia login ERP (password + MFA), cria sessão temporária e retorna token temporário para o cliente. |
| `authService.finalizeAppLogin` | `src/services/auth.service.js` | `sessionId`, `code`, `email`, `extraHeaders`, `clientContext` | `{ user, scope, ttl }` | Valida código MFA, finaliza login ERP, persiste token ERP na sessão e armazena fingerprint/IP. |
| `authService.createSSOTicket` | `src/services/auth.service.js` | `userToken`, `userIp`, `sessionEmail` | `{ ticket }` | Persiste ticket SSO (artifact) no Postgres, auditando criação e TTL. |
| `authService.validateAndBurnTicket` | `src/services/auth.service.js` | `ticket`, `requesterIp`, `extraHeaders` | `{ valid, user, original_token, original_email }` | Faz lock na linha do Postgres, valida ticket vs IP, marca como usado e retorna dados do usuário/token. |
| `sessionService.createSession` | `src/services/session.service.js` | `payload`, `ttlSeconds` | `{ sessionId, ttl }` | Gera UUID, serializa payload e salva sessão no Redis com TTL. |
| `sessionService.getSession` | `src/services/session.service.js` | `sessionId` | `SessionPayload \| null` | Recupera e desserializa sessão no Redis. |
| `sessionService.updateSession` | `src/services/session.service.js` | `sessionId`, `newPayload`, `ttlSeconds` | `Promise<void>` | Atualiza dados (ex.: finalização MFA) e reseta TTL no Redis. |
| `sessionService.removeSession` | `src/services/session.service.js` | `sessionId` | `Promise<void>` | Remove sessão e encerra o login do usuário. |
| `sessionService.storeTokenMetadata` | `src/services/session.service.js` | `token`, `headers`, `ttlSeconds` | `Promise<void>` | Salva headers associados ao token ERP para futuras chamadas SSO. |
| `csrfService.issueToken` | `src/services/csrf.service.js` | `reply`, `ttlSeconds` | `token (string)` | Gera token CSRF, grava cookie não HTTP-only e retorna o valor para o frontend. |
| `csrfService.ensureToken` | `src/services/csrf.service.js` | `req`, `reply`, `ttlSeconds` | `void` | Garante que o cookie CSRF exista, emitindo um novo se necessário. |
| `csrfService.enforce` | `src/services/csrf.service.js` | `req`, `reply` | `boolean` | Compara cookie vs header `X-CSRF-Token` e bloqueia requisições se o token estiver ausente ou inválido. |

## Controladores

| Função | Local | Parâmetros | Retorno | Responsabilidade |
| --- | --- | --- | --- | --- |
| `authController.loginSsoCallback` | `src/controllers/auth.controller.js` | `req`, `reply` | `Promise<FastifyReply>` | Recebe `ticket` SSO, troca por token ERP, cria sessão, refresh cookie e emite token CSRF. |
| `sessionController.getSessionStatus` | `src/controllers/session.controller.js` | `req`, `reply` | JSON `{ authenticated, user, scope }` | Autentica o bearer da sessão, valida fingerprint/IP, garante CSRF e retorna dados do usuário. |
| `sessionController.logout` | `src/controllers/session.controller.js` | `req`, `reply` | `{ authenticated: false }` | Valida CSRF, remove sessão e limpa cookies de refresh/CSRF. |
| `ssoController.generateTicket` | `src/controllers/sso.controller.js` | `req`, `reply` | `{ ticket, email }` | Valida sessão com fingerprint + CSRF e cria ticket SSO reutilizando o token ERP armazenado. |
| `ssoController.validateTicket` | `src/controllers/sso.controller.js` | `req`, `reply` | `{ valid, user, original_token }` | Endpoint servidor-servidor que queima tickets e retorna dados validados para o consumidor interno. |

## Proxy e Middleware

| Função | Local | Parâmetros | Retorno | Responsabilidade |
| --- | --- | --- | --- | --- |
| `proxyPreHandler` | `src/proxy/middleware.js` | `req`, `reply` | `void \| FastifyReply` | Determina política da rota, injeta IP/headers, valida sessão/CSRF e troca o bearer pelo token ERP antes de encaminhar ao Laravel. |
| `getPolicy` | `src/proxy/middleware.js` | `path`, `method` | `{ type: 'passthrough' \| 'basic_auth' \| 'user_session' }` | Decide como o proxy deve tratar a rota (sem auth, basic interno ou sessão de usuário). |
| `extractSessionIdFromHeader` | `src/proxy/middleware.js` | `headers` | `string \| null` | Valida o formato UUID do bearer e evita aceitar tokens em formato incorreto. |
| `registerRoutes` | `src/routes.js` | `app` | `Promise<void>` | Registra rotas internas (`/auth/health`, `/auth/api/...`) antes do proxy. |

## Utilidades Internas

| Função | Local | Parâmetros | Retorno | Responsabilidade |
| --- | --- | --- | --- | --- |
| `buildClientContext` | `src/utils/client-context.js` | `context` | `ClientContext` | Normaliza fingerprint (IP, user-agent, versão cliente) para armazenar na sessão. |
| `hasSameClientContext` | `src/utils/client-context.js` | `stored`, `current` | `boolean` | Compara fingerprint salvo vs requisição atual para prevenir hijacking. |
| `requireSessionToken` | `src/utils/session-token.js` | `req`, `reply` | `sessionId \| null` | Extrai bearer `Authorization`, valida UUID e responde 401 caso ausente. |
| `extractAuditHeaders` | `src/utils/audit-headers.js` | `req` | `Record<string,string>` | Whitelist de headers (ip, request-id, versão) propagados ao backend para rastreamento. |
