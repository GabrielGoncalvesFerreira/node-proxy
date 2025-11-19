# Autenticação e Emissão de Tokens

Este documento resume os fluxos expostos pela API Laravel e como o `proxy-node` atua como BFF para manter os `client_id`/`client_secret` fora dos consumidores. Todos os endpoints continuam sob `API_BASE`, mas agora devem ser chamados através do proxy.

## Visão geral

| Endpoint | Grant | O que o proxy faz |
| --- | --- | --- |
| `POST /api/v1/auth/token` | `client_credentials` | injeta `Authorization: Basic <app>` se ausente, devolve o token normalmente ou, se solicitado, cria uma sessão/cookie atrelada ao `client_id`. |
| `POST /api/v1/auth/token/erp` | `password` | autentica no ERP usando Basic interno, salva o `access_token` no Redis e retorna apenas `Set-Cookie: cv_session=<id>` + metadados do usuário. |
| `GET /bff/session` | — | Usa o cookie HTTP-only para retornar dados do usuário logado. |
| `POST /bff/logout` / `POST /api/v1/auth/logout` | — | Remove a sessão no Redis e limpa o cookie. |

> As demais rotas passam pelo proxy com injeção transparente do `Bearer` obtido através da sessão (ou via client_credentials quando configurado em `src/politicas.js`). Qualquer resposta `401` do backend faz o BFF invalidar a sessão e o cache de tokens.

## 1. OAuth2 Client Credentials — `/api/v1/auth/token`

Uso típico (Httpie):

```bash
http POST :5180/api/v1/auth/token \
  grant_type=client_credentials \
  scope=default
```

Se o cliente não enviar `Authorization: Basic`, o proxy preenche com `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET`. É possível enviar um header próprio (o proxy respeitará o valor do cliente).

### Resposta padrão

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "default"
}
```

Erros comuns: `400 invalid_request`, `401 invalid_client`, `400 unsupported_grant_type`.

### Cookie opcional para BFFs

Quando quiser que o BFF gerencie o token (sem expor `access_token`), envie o header `x-bff-session: true` ou acrescente `bff_session=true` no corpo `application/x-www-form-urlencoded`.

```bash
http POST :5180/api/v1/auth/token \
  grant_type=client_credentials \
  scope=default \
  bff_session==true
```

Resposta:

```
Set-Cookie: cv_session=<uuid>; HttpOnly; Secure; SameSite=Lax; Path=/
```

```json
{
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "default"
}
```

O BFF salva o `access_token` no Redis associando ao `client_id` (derivado do Basic ou dos campos `client_id/client_secret`). As rotas protegidas passam a usar essa sessão, e `GET /bff/session` retorna `{ scope, user: { client_id } }`.

## 2. OAuth2 Password (ERP) — `/api/v1/auth/token/erp`

O cliente envia as credenciais do usuário ERP; o proxy injeta o Basic do aplicativo.

```bash
http --form POST :5180/api/v1/auth/token/erp \
  grant_type=password \
  login=USRERP01 \
  password=SENHA123 \
  scope=default
```

> Também é aceito o campo `username`. O proxy sempre envia `Authorization: Basic <client_id:client_secret>` por conta própria; o cliente não recebe mais o `access_token`.

### Resposta

```
Set-Cookie: cv_session=<uuid>; HttpOnly; Secure; SameSite=Lax; Path=/
```

```json
{
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "default",
  "user": {
    "id": "001234",
    "nome": "JOÃO ERP"
  }
}
```

Use `GET /bff/session` para verificar quem está autenticado e obter os mesmos dados sem expor o JWT.

Erros: `401 invalid_client`, `401 invalid_grant` (credenciais ERP), `400 invalid_request`. Em caso de erro, nenhum cookie é emitido.

## 3. Sessão e logout

- `GET /bff/session`: retorna `{ autenticado: true, user, scope }` quando a sessão (cookie) é válida. Sem cookie ou sessão expirada → `401`.
- `POST /bff/logout` (ou `POST /api/v1/auth/logout`): encerra a sessão, apaga o registro no Redis e limpa o cookie.
- Todas as rotas protegidas dependem desse cookie. Se o backend responder `401`, o proxy automaticamente remove a sessão e o cliente precisa fazer login novamente.

## Boas práticas

- Renove tokens antes de `expires_in` ou implemente refresh quando disponível.
- Armazene tokens de forma segura (cookies HTTP-only ou storage protegido).
- Todas as chamadas devem usar HTTPS quando o proxy estiver exposto publicamente.
- Ajuste escopos conforme regras de autorização específicas.
- Em SPAs, habilite `withCredentials: true` no Axios/fetch para que o cookie seja enviado automaticamente.

## Referências cruzadas

- Lógica de roteamento: `src/politicas.js`
- Injeção de credenciais: `src/servidor.js`
- Cache de `client_credentials` para chamadas internas: `src/cache-de-token.js`
- Sessões ERP: `src/sessoes.js`
