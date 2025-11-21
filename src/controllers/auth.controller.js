import { authService } from '../services/auth.service.js';
import { sessionService } from '../services/session.service.js';
import { config } from '../config/env.js';
import { parseAxiosError } from '../utils/error-handler.js';

const AUDITABLE_HEADERS = [
  'X-Client-Version',
  'X-Real-IP',
  'X-Client-IP',
  'X-BFF-IP',
  'X-Forwarded-For',
  'User-Agent'
];

const toLower = (value = '') => value.toLowerCase();

function extractAuditHeaders(req) {
  const headers = {};
  for (const headerName of AUDITABLE_HEADERS) {
    const lower = toLower(headerName);
    const value = req.headers[lower] || req.headers[headerName] || req.headers[headerName.toLowerCase()];
    if (value) {
      headers[headerName] = value;
    }
  }
  return headers;
}

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
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.initiateAppLogin(userFinal, password, scope, auditHeaders);
      this._setCookie(reply, result.sessionId, result.ttl);
      return reply.send({ message: result.message, expires_in: result.ttl });
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }

  async loginAppStep2(req, reply) {
    const sessionId = req.cookies[config.session.cookieName];
    const { code, email } = req.body || {};

    if (!sessionId) return reply.code(401).send({ message: 'Sessão expirada.' });
    if (!code) return reply.code(400).send({ message: 'Código é obrigatório.' });

    try {
      const auditHeaders = extractAuditHeaders(req);
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.finalizeAppLogin(sessionId, code, email, auditHeaders);
      this._setCookie(reply, sessionId, config.session.ttlSeconds);
      return reply.send(result);
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }

  // --- LOGIN ADMIN ---
  async loginAdminStep1(req, reply) {
    const { email } = req.body || {};
    if (!email) return reply.code(400).send({ message: 'Email é obrigatório.' });

    try {
      const auditHeaders = extractAuditHeaders(req);
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.initiateAdminLogin(email, auditHeaders);
      return reply.send(result);
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }

  async loginAdminStep2(req, reply) {
    const { email, code } = req.body || {};
    if (!email || !code) return reply.code(400).send({ message: 'Email e código obrigatórios.' });

    try {
      const auditHeaders = extractAuditHeaders(req);
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.finalizeAdminLogin(email, code, auditHeaders);
      this._setCookie(reply, result.sessionId, result.ttl);
      return reply.send({ user: result.user, scope: result.scope });
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }

  // --- CLIENT CREDENTIALS ---
  async getClientToken(req, reply) {
    const body = req.body || {};
    const wantsSession = req.headers['x-bff-session'] === 'true' || body.bff_session === 'true';

    try {
      const auditHeaders = extractAuditHeaders(req);
      req.log.info({ auditHeaders }, 'Headers enviados ao Laravel');
      const result = await authService.requestClientToken({
        clientId: body.client_id || body.clientId,
        clientSecret: body.client_secret || body.clientSecret,
        scope: body.scope,
        createSession: wantsSession
      }, auditHeaders);

      if (wantsSession) {
        this._setCookie(reply, result.sessionId, result.ttl);
        return reply.send({ token_type: result.token_type, scope: result.scope, expires_in: result.ttl });
      }
      return reply.send(result);
    } catch (error) {
      req.log.error(error);
      const { status, payload } = parseAxiosError(error);
      return reply.code(status).send(payload);
    }
  }

  // ===========================================================================
  // TICKETS SSO (NOVOS MÉTODOS QUE VOCÊ PRECISAVA)
  // ===========================================================================

  /**
   * Gera um ticket SSO. Chamado pelo Front-end do SSO (usuário logado).
   */
  async generateTicket(req, reply) {
    // O Middleware já validou que existe sessão, mas aqui pegamos o token real
    // Pode vir do header injetado pelo middleware ou pegamos da sessão atual
    let token = req.headers.authorization?.replace('Bearer ', '');

    // Fallback: Se não veio no header, tenta pegar da sessão no Redis usando o cookie
    if (!token) {
        const sessionId = req.cookies[config.session.cookieName];
        if (sessionId) {
            const session = await sessionService.getSession(sessionId);
            token = session?.token;
        }
    }

    if (!token) {
        return reply.code(401).send({ message: 'Sessão inválida para gerar ticket.' });
    }

    const userIp = req.ip; // IP real do usuário

    try {
      const result = await authService.createSSOTicket(token, userIp);
      return reply.send(result);
    } catch (error) {
      req.log.error(error);
      return reply.code(500).send({ message: 'Erro ao gerar ticket SSO.' });
    }
  }

  /**
   * Valida um ticket. Chamado pelo BFF da Cotação (Servidor-Servidor).
   */
  async validateTicket(req, reply) {
    const { ticket, client_ip } = req.body || {};

    if (!ticket || !client_ip) {
      return reply.code(400).send({ message: 'Ticket e IP do cliente são obrigatórios.' });
    }

    try {
      // Passa o ticket e o IP que a Cotação reportou
      const result = await authService.validateAndBurnTicket(ticket, client_ip);
      return reply.send(result);
    } catch (error) {
      req.log.warn(`[SSO Security] Falha na validação: ${error.message}`);
      return reply.code(401).send({ message: 'Ticket inválido, expirado ou IP rejeitado.' });
    }
  }

  // Helper Privado
  _setCookie(reply, sessionId, ttl) {
    reply.setCookie(config.session.cookieName, sessionId, {
      path: '/',
      httpOnly: true,
      secure: config.session.secure,
      sameSite: config.session.sameSite,
      domain: config.session.domain,
      maxAge: ttl
    });
  }
}

export const authController = new AuthController();
