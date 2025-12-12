import crypto from 'node:crypto';
import { sessionService } from '../services/session.service.js';
import { config } from '../config/env.js';
import { csrfService } from '../services/csrf.service.js';
import { extractSessionToken } from '../utils/session-token.js';
import { extractClientContext, hasSameClientContext } from '../utils/client-context.js';


// Define qual política de segurança aplicar baseada na rota
function getPolicy(path, method) {
  const publicRoutes = ['/health'];
  if (publicRoutes.includes(path) || path.startsWith('/api/v1/public/')) {
    return { type: 'passthrough' };
  }

  const basicAuthRoutes = [
    config.url.loginUrl,
    config.url.loginCodeUrl
  ];

  if (basicAuthRoutes.some(route => path.startsWith(route))) {
    return { type: 'basic_auth' };
  }

  if (path.startsWith('/api/v1/auth/sso/validate')) {
    return { type: 'passthrough' };
  }

  return { type: 'user_session' };
}

export async function proxyPreHandler(req, reply) {
  // 1. Rastreabilidade Básica
  req.headers['x-request-id'] ||= crypto.randomUUID();
  req.headers['x-bff'] = 'true';

  // ===========================================================================
  // 2. INJEÇÃO DE DADOS DO CLIENTE (AUDITORIA)
  // ===========================================================================
  // Garante que o User-Agent (Navegador + Versão + SO) seja repassado.
  // Se por algum motivo vier sem (ex: script), definimos um fallback.
  if (!req.headers['user-agent']) {
    req.headers['user-agent'] = 'Unknown-Client/1.0';
  }
  // ===========================================================================

  const currentPath = req.raw.url.split('?')[0];
  const policy = getPolicy(currentPath, req.method);

  if (policy.type === 'passthrough') return;

  if (policy.type === 'basic_auth') {
    if (!req.headers.authorization) {
      req.headers.authorization = `Basic ${config.security.basicAuthHeader}`;
    }
    return;
  }

  if (policy.type === 'user_session') {
    const method = req.method?.toUpperCase?.() || '';
    const requiresCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (requiresCsrf && !csrfService.enforce(req, reply)) {
      return;
    }

    const sessionId = extractSessionToken(req);

    if (!sessionId) {
      csrfService.clear(reply);
      return reply.code(401).send({ message: 'Sessão não encontrada ou expirada.' });
    }

    const session = await sessionService.getSession(sessionId);

    // Se não achou no Redis ou se a sessão ainda está no passo de MFA ("Pendente")
    if (!session || session.isPendingMfa) {
      csrfService.clear(reply);
      return reply.code(401).send({ message: 'Sessão inválida. Faça login novamente.' });
    }

    const storedContext = session.clientContext;
    const requestContext = extractClientContext(req);
    if (!storedContext || !hasSameClientContext(storedContext, requestContext)) {
      req.log.warn({ sessionId, storedContext, requestContext }, '[Session Guard] Bloqueio por fingerprint.');
      await sessionService.removeSession(sessionId);
      csrfService.clear(reply);
      return reply.code(401).send({ message: 'Sessão bloqueada por alteração de dispositivo/IP.' });
    }

    // Sucesso: Injeta o token real do usuário
    req.headers.authorization = `Bearer ${session.token}`;
    return;
  }

}
