import { sessionService } from '../services/session.service.js';
import { csrfService } from '../services/csrf.service.js';
import { extractClientContext, hasSameClientContext } from '../utils/client-context.js';
import { requireSessionToken } from '../utils/session-token.js';

class SessionController {
  
  /**
   * GET /bff/session
   * Verifica se o cookie é válido e retorna quem está logado.
   */
  async getSessionStatus(req, reply) {
    const sessionId = requireSessionToken(req, reply);

    if (!sessionId) {
      return;
    }

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      // Cookie existe mas não tá no Redis (expirou ou Redis caiu)
      csrfService.clear(reply);
      return reply.code(401).send({ authenticated: false });
    }

    const clientContext = extractClientContext(req);
    const storedContext = session.clientContext;
    if (!storedContext || !hasSameClientContext(storedContext, clientContext)) {
      req.log.warn({
        sessionId,
        storedContext,
        requestContext: clientContext
      }, '[Session Guard] Fingerprint inválido para sessão.');
      await sessionService.removeSession(sessionId);
      csrfService.clear(reply);
      return reply.code(401).send({ authenticated: false, message: 'Sessão bloqueada. Faça login novamente.' });
    }

    // Se for sessão pendente (ainda no meio do login MFA), não consideramos autenticado full
    if (session.isPendingMfa) {
        return reply.code(403).send({ 
            authenticated: false, 
            message: 'MFA Pending',
            tempUser: session.tempUser 
        });
    }

    csrfService.ensureToken(req, reply);

    return reply.send({
      authenticated: true,
      user: session.user,
      scope: session.scope,
      clientId: session.clientId // Para client_credentials
    });
  }

  /**
   * POST /bff/logout
   */
  async logout(req, reply) {
    if (!csrfService.enforce(req, reply)) {
      return;
    }

    const sessionId = requireSessionToken(req, reply);

    if (!sessionId) return;

    await sessionService.removeSession(sessionId);
    csrfService.clear(reply);
    return reply.send({ authenticated: false });
  }
}

export const sessionController = new SessionController();
