| Proxy Node | Versão 1.1.0 |
| --- | --- |
| Documentação técnica | Data: 05/02/2025 |
| Revisão: 2 | |

---

## 1. Introdução

O `proxy-node` é o BFF (Backend for Frontend) responsável por orquestrar autenticação, sessões com cookies HTTP-only e roteamento seguro de chamadas para a API Laravel do Painel Esperança. A aplicação encapsula segredos (`client_id`, `client_secret`), aplica políticas por rota (Basic Auth, sessões de usuário ou pass-through) e oferece endpoints próprios para login SSO/ERP e manutenção de sessão.

### 1.1. Finalidade

Esta documentação serve como guia de manutenção e onboarding técnico. Ela descreve o propósito do BFF, dependências, fluxos de autenticação, configurações sensíveis e pontos de integração necessários para operar o SSO e o painel administrativo.

### 1.2. Escopo

Coberto:
- Estrutura do projeto `proxy-node`, seus serviços e middlewares.
- Fluxos de autenticação (SSO, ERP user) e políticas do proxy.
- Dependências técnicas e requisitos de implantação.

Fora do escopo:
- Funcionalidades do painel frontend (`painel-web`).
- Implementações internas da API Laravel.
- Governança de infraestrutura (Kubernetes, monitoramento externo).

### 1.3. Referências

- `AUTH.md` – exemplos de chamadas de autenticação/SO.
- `doc/migracao-cookie.md` – estratégia de cookies HTTP-only.
- `doc/functions.md` – catálogo de serviços e utilitários.
- RFC 7231 (referência para headers e conteúdo HTTP).

### 1.4. Dependências

- Node.js >= 20, npm >= 10.
- Redis (armazenamento de sessões e cache de tokens).
- Certificados CA para comunicação com SSO (opcional via `SSO_CA_PATH`).

```bash
cd proxy-node
npm install
```

### 1.5. Visão Geral

O documento apresenta a arquitetura do proxy, metas e restrições de projeto, visão lógica/processual, requisitos de implantação e um FAQ. As seções foram organizadas para facilitar o diagnóstico rápido e o repasse de conhecimento.

---

## 2. Representação Arquitetural

### 2.1. Estrutura Geral

- **Front-end:** painel React (`painel-web`), consome o BFF via Axios.
- **Back-end:** Fastify 5 com plugins `cors`, `cookie`, `formbody` e `@fastify/http-proxy`.
- **Módulos principais:**
  - `src/server.js` – bootstrap, registro dos plugins e configuração do proxy.
  - `src/routes.js` – rotas internas (`/auth/api/...`) pertencentes ao BFF.
  - `src/controllers/*` – controladores para login SSO, sessão, ticket, etc.
  - `src/services/*` – regras de negócio: autenticação, sessão Redis, CSRF.
  - `src/proxy/middleware.js` – políticas por rota e injeção de headers/IP.

### 2.2. Padrões de Design e Práticas de Desenvolvimento

- Código em módulos ES, lint e formatação alinhados ao padrão do repositório.
- Camada de serviço separada da camada HTTP.
- Uso de `undici` com dispatcher global para garantir keep-alive e TLS consistente.
- Logs estruturados via `fastify.log`.

### 2.3. Integração de Sistemas

- **API Laravel:** destino principal de todas as rotas proxied.
- **SSO interno:** endpoints `/api/v1/auth/sso/*` via `authService`.
- **Redis:** sessões de usuário (`cv_session`), refresh tokens e cache de tokens ERP.

### 2.4. Manutenibilidade e Escalabilidade

- Políticas configuradas em `proxyPreHandler` permitem adicionar rotas sem duplicar lógica.
- Sessões e tokens ficam no Redis, facilitando escalonar múltiplos pods do BFF.
- Configurações sensíveis isoladas em `src/config/env.js`, lidas via `process.env`.

### 2.5. Regras de Negócio

- Session ID deve ser um UUID v4; IP e User-Agent precisam casar com o salvamento original.
- Endpoint `/auth/api/admin/auth/login` usa CSRF + SSO e não passa pelo proxy com Basic.
- Toda rota mutável requer header `X-CSRF-Token` combinando com cookie `cv_csrf`.

---

## 3. Metas e Restrições da Arquitetura

### 3.1. Usabilidade

| Requisito | Descrição |
| --- | --- |
| Mensagens | Logs Fastify (`info/warn/error`) e respostas JSON padronizadas (`message`). |
| Interação | API HTTP (JSON/Form), sem UI própria. |
| Manual | Esta wiki + `AUTH.md`. |
| Acesso | HTTP(s) via gateway corporativo; rotas internas prefixadas com `/auth`. |

### 3.2. Confiabilidade

| Requisito | Descrição |
| --- | --- |
| Disponibilidade | 99% (dependente do cluster Docker/Kubernetes). |
| Desempenho | Proxy adiciona <10 ms de latência média. |
| Integridade | Sessões travadas a IP/UA; CSRF em toda mutação. |
| Segurança | Segredos permanecem no BFF; tokens ERP nunca expostos. |
| Escalabilidade | Stateless (com Redis) – suporta horizontal scaling. |

### 3.3. Desenvolvimento

| Requisito | Descrição |
| --- | --- |
| Linguagem | Node.js 20 (ESM). |
| Banco | Redis 6+ (cache/sessões). |
| Frameworks | Fastify 5, Undici, Axios. |
| IDE | Livre (VS Code recomendado). |

---

## 4. Visão Lógica

- `app.addHook('onRequest')`: normaliza headers, UA e IP.
- `registerRoutes` expõe rotas próprias (`/auth/api/...`) com controles CSRF/sessão.
- `@fastify/http-proxy` intercepta tudo que não foi tratado localmente e reescreve `/auth/*` -> `/`.
- `proxyPreHandler` decide política (`passthrough`, `basic_auth`, `user_session`), injeta headers e verifica CSRF.
- `replyOptions.onResponse` monitora códigos de erro e dispara callbacks (ex.: validação ERP após `/api/v1/auth/token`).

---

## 5. Visão do Processo

### 5.1. Processos Operacionais

- **Fluxo de Login SSO:** cliente chama `/auth/api/admin/auth`, valida ticket, cria sessão + refresh cookie + CSRF. Após isso, todas as chamadas proxied usam `Authorization: Bearer <sessionId>`.
- **Fluxo de Sessão:** endpoints `/auth/api/bff/session|refresh|logout` manipulam sessões no Redis e garantem fingerprint/IP.
- **Proxy:** rotas não locais respeitam as políticas definidas em `proxy/middleware.js`.

| Entidade/Tabela | Data Source | Banco | Observações |
| --- | --- | --- | --- |
| Sessão (`cv_session:<uuid>`) | Prod/Homol | Redis | Guarda token ERP, IP, UA, TTL. |
| Refresh Token (`cv_refresh:<uuid>`) | Prod/Homol | Redis | Referencia sessão ativa + metadados. |

### 5.2. Manutenção e Monitoramento

- Logs acessíveis via stdout/aggregator (ELK/CloudWatch).
- Falhas em Redis/token ERP produzem `warn/error` no log.
- Health-check disponível em `GET /auth/health`.

---

## 6. Implantação

### 6.1. Máquina

| Requisito | Descrição |
| --- | --- |
| SO | Linux (containers). |
| Memória | 512 MB+ (processo Node) + Redis dedicado. |
| CPU | 1 vCPU+. |
| Disco | 200 MB para dependências + logs em stdout. |

### 6.2. Pré-requisitos

| Requisito | Descrição |
| --- | --- |
| Node.js | >=20, disponível no container. |
| Redis | Instância acessível via rede privada. |
| Variáveis de ambiente | Configuradas conforme `src/config/env.js`. |

### 6.3. Instalação

```bash
cd proxy-node
npm ci
npm run build   # se existir etapa de build
npm start
```

### 6.4. Configurações

`.env` (exemplo):

```
PORT=5180
API_BASE=https://api-esperanca.internal
SSO_API_URL=https://sso.internal
REDIS_URL=redis://redis:6379
SESSION_COOKIE_DOMAIN=.comlesperanca.com.br
```

`config/env.js` já converte as variáveis para objetos consumidos pelos serviços.

---

## 7. Tamanho e Desempenho

| Requisito | Descrição |
| --- | --- |
| Tempo de resposta | ~5–10 ms adicionais ao backend. |
| Capacidade | 2k req/min por instância (limitado por upstream). |
| Transferência | Governada pelo gateway; proxy apenas repassa streams. |

---

## 8. Qualidade

- Código modularizado em controllers/services.
- Proteções de segurança (CSRF, fingerprint de sessão, IP/UA) já documentadas.
- Testes manuais via Httpie/Insomnia (ver `AUTH.md`).

---

## 9. Perguntas Frequentes

1. **Por que preciso enviar `X-CSRF-Token` se já tenho o cookie?**  
   Para bloquear CSRF via double-submit cookie; apenas o frontend legítimo consegue copiar o valor para o header.

2. **Como desbloquear uma sessão travada por fingerprint?**  
   Remova o registro Redis (`cv_session:<id>`) e peça ao usuário para logar novamente.

3. **Onde configuro CORS?**  
   Variável `CORS_ORIGINS` (lista separada por vírgula) lida em `src/server.js`.

4. **O proxy altera paths?**  
   Sim, todos os caminhos entram com `/auth` e são reescritos para `/` antes de chegar ao Laravel; mantenha o prefixo nos clients ou configure o gateway externo para reescrever.
