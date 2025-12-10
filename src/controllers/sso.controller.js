import { authService } from '../services/auth.service.js';
import { sessionService } from '../services/session.service.js';
import { extractAuditHeaders } from '../utils/audit-headers.js';
import { csrfService } from '../services/csrf.service.js';
import { extractClientContext, hasSameClientContext } from '../utils/client-context.js';
import { extractSessionToken } from '../utils/session-token.js';

class SSOController {
  // Gera ticket SSO para o usuário logado (ou baseado no Authorization header)
  async generateTicket(req, reply) {
    if (!csrfService.enforce(req, reply)) {
      return;
    }

    const auditHeaders = extractAuditHeaders(req);
    let sessionEmail;
    let userToken;
    const clientContext = extractClientContext(req);
    const sessionId = extractSessionToken(req);

    if (sessionId) {
      const session = await sessionService.getSession(sessionId);
      const storedContext = session?.clientContext;
      if (!session || !storedContext || !hasSameClientContext(storedContext, clientContext)) {
        req.log.warn({ sessionId }, '[SSO] Fingerprint divergente ou ausente ao gerar ticket.');
        await sessionService.removeSession(sessionId);
        csrfService.clear(reply);
        return reply.code(401).send({ message: 'Sessão bloqueada. Faça login novamente.' });
      }
      userToken = session.token;
      sessionEmail = session.user?.email;
    }

    if (!sessionEmail && userToken) {
      try {
        const userInfo = await authService.getUserInfoFromToken(userToken, auditHeaders);
        sessionEmail = userInfo?.email;
      } catch (e) {
        // segue sem email
      }
    }

    if (!userToken) return reply.code(401).send({ message: 'Sessão inválida para gerar ticket.' });

    const userIp = req.ip;
    try {
      const result = await authService.createSSOTicket(userToken, userIp, sessionEmail);
      return reply.send({ ...result, email: sessionEmail });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ message: 'Erro ao gerar ticket SSO.' });
    }
  }

  // Valida ticket SSO (servidor-servidor): recebe { ticket, client_ip }
  async validateTicket(req, reply) {
    const { ticket, client_ip } = req.body || {};
    if (!ticket || !client_ip) return reply.code(400).send({ message: 'Ticket e IP do cliente são obrigatórios.' });

    try {
      const auditHeaders = extractAuditHeaders(req);
      const result = await authService.validateAndBurnTicket(ticket, client_ip, auditHeaders);
      return reply.send(result);
    } catch (err) {
      req.log.warn('[SSO Security] Falha na validação: ' + (err?.message || err));
      return reply.code(401).send({ message: 'Ticket inválido, expirado ou IP rejeitado.' });
    }
  }
}

export const ssoController = new SSOController();
