import { sessionService } from '../services/session.service.js';
import { config } from '../config/env.js';

class SessionController {
  
  /**
   * GET /bff/session
   * Verifica se o cookie é válido e retorna quem está logado.
   */
  async getSessionStatus(req, reply) {
    const sessionId = req.cookies[config.session.cookieName];

    if (!sessionId) {
      return reply.code(401).send({ authenticated: false });
    }

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      // Cookie existe mas não tá no Redis (expirou ou Redis caiu)
      this._clearCookie(reply);
      return reply.code(401).send({ authenticated: false });
    }

    // Se for sessão pendente (ainda no meio do login MFA), não consideramos autenticado full
    if (session.isPendingMfa) {
        return reply.code(403).send({ 
            authenticated: false, 
            message: 'MFA Pending',
            tempUser: session.tempUser 
        });
    }

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
    const sessionId = req.cookies[config.session.cookieName];

    if (sessionId) {
      await sessionService.removeSession(sessionId);
    }

    this._clearCookie(reply);
    return reply.send({ authenticated: false });
  }

  _clearCookie(reply) {
    reply.clearCookie(config.session.cookieName, {
      path: '/',
      domain: config.session.domain
    });
  }
}

export const sessionController = new SessionController();