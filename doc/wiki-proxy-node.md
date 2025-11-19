| Proxy Node | Versão 1.0.0 |
| --- | --- |
| Documentação técnica | Data: 03/02/2025 |
| Revisão: 1 | |

---

## 1. Introdução

O `proxy-node` é um BFF leve escrito com Fastify que centraliza autenticação, cache de tokens `client_credentials` e rotea chamadas para a API Laravel do Controle de Validade. Ele elimina a exposição de `client_id`/`client_secret` nos consumidores e aplica políticas por rota para anexar cabeçalhos de correlação, CORS e tokens apropriados.

### 1.1. Finalidade

Servir como camada intermediária entre aplicações clientes (web, mobile ou integrações) e o backend Laravel, padronizando autenticação e otimizando latência via keep-alive e cache (memória + Redis).

### 1.2. Escopo

- Proxy HTTP/HTTPS com Fastify + `@fastify/http-proxy`.
- Emissão e cache de tokens `client_credentials`.
- Injeção automática de headers (`x-request-id`, `x-bff`, `Authorization`).
- Documentação de uso (`AUTH.md`) e políticas (`src/politicas.js`).

Fora do escopo: alterações no backend Laravel, refresh tokens e monitoramento de infraestrutura (delegado ao cluster Docker).

### 1.3. Referências

- Arquivo `AUTH.md` (fluxos de autenticação).
- Código-fonte em `src/`.
- Documentação de base do projeto Controle Validade (`controle-validade-app/doc`).

---

## 2. Representação Arquitetural

### 2.1. Estrutura Geral

- `src/servidor.js`: bootstrap do Fastify, registro de plugins (CORS, cookie, formbody), endpoints locais de autenticação (`/api/v1/auth/token`, `/api/v1/auth/token/erp`), proxy e hooks.
- `src/politicas.js`: roteamento de políticas (`passthrough`, `token_basic_proxy`, `sessao_usuario`, `oauth_client_credentials`).
- `src/cache-de-token.js`: cache multi-tier (LRU + Redis) para tokens `client_credentials`, com invalidação no `onResponse`.
- `src/sessoes.js`: CRUD de sessões ERP (JWT por usuário) no Redis.
- `AUTH.md`: guia de consumo dos endpoints de autenticação e sessão.

### 2.2. Padrões e Práticas

- Módulos ES (`"type": "module"` no `package.json`).
- `undici` como HTTP client global (melhor suporte HTTP/1.1 keep-alive).
- Funções puras para políticas, facilitando testes.
- CORS restrito a `localhost/127.0.0.1` (ajustável por ambiente).
- Node.js v20 (alinhado ao container Docker).

### 2.3. Integrações

- API Laravel (base configurada via `API_BASE`).
- Servidor OAuth (mesma API, endpoint `OAUTH_TOKEN_URL`).
- Redis (cache distribuído, `REDIS_URL`).

---

## 3. Metas e Restrições

| Objetivo | Descrição |
| --- | --- |
| Segurança | Segredos permanecem no proxy; clientes recebem apenas tokens emitidos. |
| Desempenho | Tokens reutilizados via cache; keep-alive reduz criação de conexões a cada chamada. |
| Observabilidade | `x-request-id` aplicado antes de encaminhar qualquer requisição. |
| Simplicidade | Políticas declarativas por rota, sem necessidade de alterar o proxy para cada novo módulo. |

Restrições: depende de Redis; se indisponível, apenas cache em memória estará ativo. TLS é fornecido pela camada externa (reverse proxy/Ingress).

---

## 4. Visão Lógica

Fluxo básico:

1. Cliente faz requisição para o proxy (`/api/v1/...`).
2. `servidor.js` aplica headers (`x-request-id`, `x-bff`) e consulta `escolherPolitica`.
3. Política resultante:
   - `sessao_usuario`: padrão para rotas autenticadas; lê `cv_session`, busca o JWT ERP **ou** client_credentials no Redis (`sessoes.js`) e injeta `Authorization: Bearer ...`.
   - `oauth_client_credentials`: usado apenas para rotas específicas (ex.: `/v1/system/**`), obtendo tokens do cache `obterTokenCliente`.
   - `passthrough`: repassa a requisição sem alterações adicionais.
4. `@fastify/http-proxy` encaminha para `API_BASE`.

Fluxos especiais (antes do proxy):

- `POST /api/v1/auth/token/erp`: sempre cria sessão por usuário ERP (cookie HTTP-only).
- `POST /api/v1/auth/token`: devolve `access_token` normalmente; se o cliente enviar `x-bff-session: true` ou `bff_session=true`, o BFF cria a sessão atrelada ao `client_id` e omite o token na resposta.

Fluxo de cache (`obterTokenCliente`):

1. Concatena `tenantId`, `audiencia` e `escopos` como chave.
2. Consulta `LRUCache` (memória) e depois Redis.
3. Caso ambos falhem ou estejam próximos de expirar (30 s), solicita novo token em `OAUTH_TOKEN_URL`.
4. Salva no Redis (PX `expires_in`) e na LRU, liberando lock distribuído.
5. Se o backend responder `401`, o `onResponse` remove a entrada em cache forçando renovação no próximo chamado.

---

## 5. Dependências

| Pacote | Versão | Uso |
| --- | --- | --- |
| `fastify` | ^5.0.0 | Servidor HTTP principal. |
| `@fastify/http-proxy` | ^10.0.0 | Proxy reverso para API Laravel. |
| `@fastify/cors` | ^10.0.0 | Controle de origem dos clientes. |
| `@fastify/cookie` | ^9.3.0 | Gestão de cookies HTTP-only para sessões ERP. |
| `@fastify/formbody` | ^8.1.0 | Parser de `application/x-www-form-urlencoded` nos endpoints de login. |
| `axios` | ^1.7.0 | Solicita tokens ao Authorization Server. |
| `redis` | ^4.6.13 | Cache distribuído. |
| `lru-cache` | ^10.2.0 | Cache em memória. |
| `undici` | ^6.19.8 | Dispatcher global com keep-alive. |

Node >= 20 e npm >= 10 recomendados.

---

## 6. Configuração e Execução

### 6.1. Variáveis de Ambiente

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta do proxy (default 5180). |
| `API_BASE` | URL base da API Laravel (ex.: `http://backend:4000`). |
| `OAUTH_TOKEN_URL` | Endpoint OAuth (normalmente `${API_BASE}/api/v1/auth/token`). |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | Credenciais do aplicativo. |
| `REDIS_URL` | Conexão Redis (ex.: `redis://redis:6379`). |
| `SESSION_COOKIE_NAME` | Nome do cookie HTTP-only (default `cv_session`). |
| `SESSION_COOKIE_DOMAIN` | Domínio opcional para o cookie. |
| `SESSION_COOKIE_SECURE` | Define se o cookie será `Secure` (`true` por padrão). |
| `SESSION_COOKIE_SAMESITE` | `lax` (default), `strict` ou `none`. |
| `SESSION_TTL_SECONDS` | TTL mínimo das sessões quando o backend não retornar `expires_in`. |

### 6.2. Comandos

```bash
cd proxy-node
npm install
npm start
```

Para desenvolvimento, use `npm run dev` (se configurado) ou `node --watch src/servidor.js`.

---

## 7. Operação e Monitoramento

- Logs Fastify (`app = Fastify({ logger: true })`) gravam cada requisição proxied.
- `x-request-id` permite rastrear chamadas ponta a ponta entre clientes, proxy e Laravel.
- Redis é crítico para cache de tokens **e** sessões ERP/client_credentials; monitore conexões, tempo de resposta e memória disponível.
- Hooks `onResponse` limpam sessões/caches em `401`, evitando que tokens inválidos persistam. Exponha métricas dessas ocorrências no Grafana.
- Sugerido expor `/health` para probes do orchestrator (já implementado).

---

## 8. Próximas Evoluções

1. Suporte a refresh tokens/PKCE quando o backend disponibilizar.
2. Ajustar CORS para domínios corporativos (variável de ambiente).
3. Telemetria (OpenTelemetry/Log aggregation).
4. Implementar circuit breaker/retry nas chamadas ao upstream para cenários de instabilidade.

---

## 9. Apêndices

- `AUTH.md`: detalha chamadas e exemplos Httpie (incluindo o novo cookie HTTP-only).
- `doc/migracao-cookie.md`: passo a passo para remover o uso de `localStorage` nos clients.
- `docker/docker-compose.yml` (quando existir) pode ser utilizado para subir Redis + proxy localmente.
- Para diagramas Visio/draw.io, reutilizar este conteúdo textual como base; anexar os artefatos finais em `doc/`.
