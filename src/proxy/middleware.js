import crypto from 'node:crypto';
import { sessionService } from '../services/session.service.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/env.js';

// Normaliza a URL para garantir que sempre comece com /api ao chegar no Laravel
export function normalizeApiPath(url) {
  // Separa path da query string (ex: ?id=1)
  const [rawPath, query] = url.split('?');
  let path = rawPath;

  // 1. Se não começa com /api, adiciona.
  // Ex: /v1/auth -> /api/v1/auth
  if (!path.startsWith('/api')) {
    path = path.startsWith('/') ? `/api${path}` : `/api/${path}`;
  }

  // 2. Segurança: Remove duplicação se houver (ex: /api/api/v1 -> /api/v1)
  path = path.replace(/^\/api\/api/, '/api');

  return query ? `${path}?${query}` : path;
}

// Define qual política de segurança aplicar baseada na rota
function getPolicy(path, method) {
  // 1. Rotas Públicas (Health check, etc)
  if (path === '/health' || path.startsWith('/api/v1/public/')) {
    return { type: 'passthrough' };
  }

  // === NOVO: Blindagem para Rotas de Autenticação ===
  // Se por algum motivo o request cair aqui (ex: erro de verbo ou rota não capturada),
  // não exigimos sessão para endpoints de login.
  const publicAuthRoutes = [
    '/api/v1/auth/login',
    '/api/v1/auth/login/code',
    '/api/admin/auth/login',
    '/api/admin/auth/verify',
    '/api/v1/auth/token',
    '/api/v1/auth/sso/validate'
  ];

  // Verifica se a URL começa com alguma das rotas de login (para cobrir query params)
  if (publicAuthRoutes.some(route => path.startsWith(route))) {
    // Se for POST, deveria ter sido pego pelo routes.js. 
    // Se caiu aqui, é GET ou outro verbo. Deixamos passar (passthrough) 
    // para o Laravel retornar o erro 405 (Method Not Allowed) correto, em vez de 401 (Sessão).
    return { type: 'passthrough' };
  }
  // ==================================================

  // 2. Rota de solicitação de token (Mantida, mas agora redundante com o bloco acima, pode remover se quiser)
  if (method === 'POST' && path === '/api/v1/auth/token') {
    return { type: 'inject_basic_auth' };
  }
  // 4. Padrão: Requer Sessão de Usuário (Cookie)
  return { type: 'user_session' };
}

export async function proxyPreHandler(req, reply) {
  // 1. Rastreabilidade Básica
  req.headers['x-request-id'] ||= crypto.randomUUID();
  req.headers['x-bff'] = 'true';

  // ===========================================================================
  // 2. INJEÇÃO DE DADOS DO CLIENTE (AUDITORIA)
  // ===========================================================================
  // O Fastify com 'trustProxy: true' já calculou o IP real (req.ip)
  // ignorando os proxies internos (Docker/Nginx).

  // Envia o IP real para o Laravel saber quem é o cliente original
  req.headers['x-forwarded-for'] = req.ip;
  req.headers['x-real-ip'] = req.ip;

  // Garante que o User-Agent (Navegador + Versão + SO) seja repassado.
  // Se por algum motivo vier sem (ex: script), definimos um fallback.
  if (!req.headers['user-agent']) {
    req.headers['user-agent'] = 'Unknown-Client/1.0';
  }
  // ===========================================================================

  const normalizedPath = normalizeApiPath(req.raw.url || req.url);
  const policy = getPolicy(normalizedPath, req.method);

  // Caso 1: Passar direto (Público)
  if (policy.type === 'passthrough') return;

  // Caso 2: Injetar Basic Auth (para /auth/token)
  if (policy.type === 'inject_basic_auth') {
    if (!req.headers.authorization) {
      req.headers.authorization = `Basic ${config.security.basicAuthHeader}`;
    }
    return;
  }

  // Caso 3: Sessão de Usuário (Cookie -> Redis -> Bearer Token)
  if (policy.type === 'user_session') {
    const sessionId = req.cookies[config.session.cookieName];

    if (!sessionId) {
      return reply.code(401).send({ message: 'Sessão não encontrada ou expirada.' });
    }

    const session = await sessionService.getSession(sessionId);

    // Se não achou no Redis ou se a sessão ainda está no passo de MFA ("Pendente")
    if (!session || session.isPendingMfa) {
      // Remove o cookie inválido para limpar o navegador do usuário
      reply.clearCookie(config.session.cookieName, { path: '/', domain: config.session.domain });
      return reply.code(401).send({ message: 'Sessão inválida. Faça login novamente.' });
    }

    // Sucesso: Injeta o token real do usuário
    req.headers.authorization = `Bearer ${session.token}`;
    return;
  }

  // Caso 4: Token de Sistema (Cacheado no Redis para performance)
  if (policy.type === 'system_token') {
    // Tenta pegar token de sistema já cacheado
    const systemCacheKey = `sys_token:${policy.tenantId}:${policy.scope}`;
    let token = await sessionService.getSession(systemCacheKey); // Reusando leitura do Redis

    if (!token) {
      // Se não tem, pede um novo para o Laravel
      const data = await authService.requestClientToken({
        scope: policy.scope,
        createSession: false
      });
      token = data.access_token;

      // Salva no Redis com TTL um pouco menor que a validade real para segurança
      await sessionService.createSession(token, (data.expires_in || 3600) - 60);
    }

    req.headers.authorization = `Bearer ${token}`;

    // Injeta tenant se necessário
    if (policy.tenantId) {
      req.headers['x-tenant-id'] = policy.tenantId;
    }
  }
}
