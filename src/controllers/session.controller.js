import { sessionService } from '../services/session.service.js';
import { csrfService } from '../services/csrf.service.js';
import { extractClientContext, hasSameClientContext } from '../utils/client-context.js';
import { requireSessionToken } from '../utils/session-token.js';
import { config } from '../config/env.js';

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
   * POST /bff/refresh
   * Usa refresh token httpOnly para emitir nova sessão.
   */
  async refresh(req, reply) {
    const refreshToken =
      req.cookies?.[config.session.refreshCookieName] ||
      req.body?.refresh_token;

    if (!refreshToken) {
      return reply.code(401).send({ message: 'Refresh token ausente.' });
    }

    const refreshData = await sessionService.getSessionIdByRefresh(refreshToken);
    if (!refreshData?.sessionId) {
      await sessionService.removeRefreshToken(refreshToken);
      reply.clearCookie(config.session.refreshCookieName, {
        path: '/',
        domain: config.session.domain
      });
      csrfService.clear(reply);
      return reply.code(401).send({ message: 'Refresh inválido ou expirado.' });
    }

    const previousSession = await sessionService.getSession(refreshData.sessionId);
    if (!previousSession || previousSession.isPendingMfa) {
      await sessionService.removeRefreshToken(refreshToken);
      reply.clearCookie(config.session.refreshCookieName, {
        path: '/',
        domain: config.session.domain
      });
      csrfService.clear(reply);
      return reply.code(401).send({ message: 'Sessão expirada.' });
    }

    const requestContext = extractClientContext(req);
    const storedContext = previousSession.clientContext;
    if (!storedContext || !hasSameClientContext(storedContext, requestContext)) {
      req.log.warn({
        sessionId: refreshData.sessionId,
        storedContext,
        requestContext
      }, '[Session Refresh] Contexto divergente.');
      await sessionService.removeRefreshToken(refreshToken);
      await sessionService.removeSession(refreshData.sessionId);
      csrfService.clear(reply);
      reply.clearCookie(config.session.refreshCookieName, {
        path: '/',
        domain: config.session.domain
      });
      return reply.code(401).send({ message: 'Sessão bloqueada. Faça login novamente.' });
    }

    const { meta, ...payload } = previousSession;
    await sessionService.removeSession(refreshData.sessionId);

    const accessTtl = meta?.ttlSeconds || config.session.ttlSeconds;
    const { sessionId, ttl } = await sessionService.createSession(
      { ...payload, clientContext: requestContext },
      accessTtl
    );

    const refreshTtl = config.session.refreshTtlSeconds;
    const { refreshId } = await sessionService.createRefreshToken(sessionId, refreshTtl, {
      clientContext: requestContext
    });
    await sessionService.removeRefreshToken(refreshToken);
    reply.setCookie(config.session.refreshCookieName, refreshId, {
      httpOnly: true,
      secure: config.session.secure,
      sameSite: config.session.sameSite,
      domain: config.session.domain,
      path: '/',
      maxAge: refreshTtl
    });

    csrfService.ensureToken(req, reply, ttl);

    return reply.send({
      token: sessionId,
      refresh_token: refreshId,
      token_type: 'Bearer',
      expires_in: ttl,
      user: payload.user,
      scope: payload.scope,
      clientId: payload.clientId
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

    const refreshToken = req.cookies?.[config.session.refreshCookieName];
    if (refreshToken) {
      await sessionService.removeRefreshToken(refreshToken);
    }
    reply.clearCookie(config.session.refreshCookieName, {
      path: '/',
      domain: config.session.domain
    });
    csrfService.clear(reply);
    return reply.send({ authenticated: false });
  }
}

export const sessionController = new SessionController();
