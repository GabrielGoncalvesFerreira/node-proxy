import { authService } from '../services/auth.service.js';
import { parseAxiosError } from '../utils/error-handler.js';
import { extractAuditHeaders } from '../utils/audit-headers.js';
import { csrfService } from '../services/csrf.service.js';
import { extractClientContext } from '../utils/client-context.js';
import { requireSessionToken, buildSessionCookieOptions } from '../utils/session-token.js';
import { sessionService } from '../services/session.service.js';
import { config } from '../config/env.js';

class AuthController {
  
  // --- LOGIN APP ---
  async loginAppStep1(req, reply) {
    const { email, username, login, password, scope } = req.body || {};
    const userFinal = username || login || email;

    if (!userFinal || !password) {
      return reply.code(400).send({ message: 'Campos obrigatórios: username e password.' });
    }

    try {
      const auditHeaders = extractAuditHeaders(req);
      const clientContext = extractClientContext(req);
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.initiateAppLogin(
        userFinal,
        password,
        scope,
        auditHeaders,
        clientContext
      );
      csrfService.issueToken(reply, result.ttl);
      return reply.send({
        message: result.message,
        expires_in: result.ttl,
        session_token: result.sessionToken
      });
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }

  async loginAppStep2(req, reply) {
    const { code, email } = req.body || {};

    if (!code) return reply.code(400).send({ message: 'Código é obrigatório.' });

    if (!csrfService.enforce(req, reply)) {
      return;
    }

    const sessionToken = requireSessionToken(req, reply);
    if (!sessionToken) return;

    try {
      const auditHeaders = extractAuditHeaders(req);
      const clientContext = extractClientContext(req);
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.finalizeAppLogin(
        sessionToken,
        code,
        email,
        auditHeaders,
        clientContext
      );
      const { ttl, ...payload } = result;
      csrfService.issueToken(reply, ttl);
      reply.setCookie(config.session.cookieName, sessionToken, buildSessionCookieOptions(ttl));

      const refreshTtl = config.session.refreshTtlSeconds;
      const { refreshId } = await sessionService.createRefreshToken(sessionToken, refreshTtl, {
        clientContext
      });
      reply.setCookie(config.session.refreshCookieName, refreshId, {
        httpOnly: true,
        secure: config.session.secure,
        sameSite: config.session.sameSite,
        domain: config.session.domain,
        path: '/',
        maxAge: refreshTtl
      });

      return reply.send({
        ...payload,
        session_token: sessionToken,
        refresh_token: refreshId,
        token_type: 'Bearer',
        expires_in: ttl
      });
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }
}

export const authController = new AuthController();
