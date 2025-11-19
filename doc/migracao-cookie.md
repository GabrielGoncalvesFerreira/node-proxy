# Migração: localStorage → Cookie HTTP-only

Este guia explica como ajustar o front-end (web/Expo) para usar o novo fluxo de autenticação mediado pelo `proxy-node`, que agora salva o JWT ERP no Redis e expõe apenas um cookie `cv_session`. Nenhum token precisa (ou deve) ser persistido no `localStorage`.

## 1. Cenário anterior

- `POST /api/v1/auth/token/erp` devolvia `access_token` no corpo.
- O front salvava o token em `localStorage`/AsyncStorage.
- Cada requisição adicionava `Authorization: Bearer <token>` manualmente.

## 2. Como fica agora

- O login continua em `POST /api/v1/auth/token/erp`, mas a resposta contém apenas metadados + `Set-Cookie: cv_session=<uuid>` (HTTP-only).
- O proxy injeta o `Bearer` em todas as rotas protegidas usando o cookie; o front não enxerga o JWT.
- `GET /bff/session` retorna o usuário logado para montar o estado da aplicação.
- `POST /bff/logout` remove a sessão e limpa o cookie.

## 3. Passos de implementação

1. **Habilite cookies no cliente HTTP**
   ```ts
   import axios from 'axios';

   const api = axios.create({
     baseURL: process.env.EXPO_PUBLIC_BFF_URL,
     withCredentials: true
   });
   ```

2. **Atualize o login**
   - Chame `api.post('/api/v1/auth/token/erp', { login, password })`.
   - Use os campos `user`, `scope` e `expires_in` da resposta para montar o contexto local.
   - Não armazene `access_token` (ele não é retornado).

3. **Carregue o usuário na inicialização**
   ```ts
   async function bootstrapSession() {
     try {
       const { data } = await api.get('/bff/session');
       setUser(data.user);
     } catch {
       redirectToLogin();
     }
   }
   ```

4. **Logout**
   ```ts
   await api.post('/bff/logout');
   setUser(null);
   ```

5. **Interceptors/erros**
   - Em caso de `401`, limpe o estado local e redirecione para login. O BFF já terá invalidado a sessão/cookie.

## 4. Checklist de limpeza

- [ ] Remover qualquer gravação/leitura de `access_token` em `localStorage`/AsyncStorage.
- [ ] Excluir headers manuais `Authorization`.
- [ ] Ajustar interceptors para depender apenas do cookie.
- [ ] Validar CORS com `credentials: true` no ambiente alvo.
- [ ] Atualizar testes/e2e para incluir o novo fluxo (`await login()` → cookie).

## 5. Observações

- O cookie é `HttpOnly; Secure; SameSite=Lax` por padrão. Ajuste variáveis `SESSION_COOKIE_*` no proxy conforme necessidade.
- Em ambiente mobile nativo (Expo/React Native), `withCredentials: true` garante que o cookie seja enviado automaticamente; não é necessário (nem possível) acessá-lo via JavaScript.
- Refresh automático ainda depende do `expires_in` retornado pelo backend. Planeje um ping periódico a `/bff/session` para detectar expiração e exibir aviso ao usuário.

## 6. Tokens de aplicação (`client_credentials`)

Algumas integrações internas utilizavam `/api/v1/auth/token` para obter um `access_token` e guardar em serviços ou no front. Para padronizar com cookies:

- Envie o header `x-bff-session: true` (ou o campo `bff_session=true` no corpo `x-www-form-urlencoded`) ao chamar `/api/v1/auth/token`.
- O BFF retornará apenas metadados (`token_type`, `expires_in`, `scope`) e setará `cv_session` com o token associado ao `client_id`.
- Use `GET /bff/session` para confirmar qual `client_id` está autenticado e `POST /bff/logout` para encerrar a sessão.
- Se ainda precisar do `access_token` (ex.: outro backend), basta não enviar o flag `bff_session`; a resposta permanece igual à original.
