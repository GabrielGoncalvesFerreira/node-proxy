import { authService } from '../services/auth.service.js';
import { parseAxiosError } from '../utils/error-handler.js';
import { extractAuditHeaders } from '../utils/audit-headers.js';
import { csrfService } from '../services/csrf.service.js';
import { extractClientContext } from '../utils/client-context.js';
import { requireSessionToken } from '../utils/session-token.js';

class AuthController {
  
  // --- LOGIN APP ---
  async loginAppStep1(req, reply) {
    const { username, login, password, scope } = req.body || {};
    const userFinal = username || login;

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
      return reply.send({
        ...payload,
        session_token: sessionToken,
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
