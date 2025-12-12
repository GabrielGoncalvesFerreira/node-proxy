import { httpClient } from './http.service.js';
import { sessionService } from './session.service.js';
import { config } from '../config/env.js';
import crypto from 'node:crypto';
import * as ticketRepo from '../repositories/ticket.repository.js';
import { buildClientContext, hasSameClientContext } from '../utils/client-context.js';

const TICKET_TTL_SECONDS = 30;
const DEFAULT_TICKET_ERROR = 'Ticket inválido ou expirado.';

class AuthService {
  // ===========================================================================
  // FLUXO 1: APP (USUÁRIO ERP) - Login com senha + MFA
  // ===========================================================================

  async initiateAppLogin(username, password, scope = 'default', extraHeaders = {}, clientContext = {}) {
    const params = new URLSearchParams({
      grant_type: 'password',
      email: username,
      username,
      password,
      scope,
    });

    const { data } = await httpClient.post(config.api.endpoints.appLogin, params, {
      headers: { Authorization: `Basic ${config.security.basicAuthHeader}`, ...extraHeaders },
    });

    if (!data.challenge_id) {
      throw new Error('Backend não retornou challenge_id. Verifique se o usuário exige MFA.');
    }

    const sessionPayload = {
      challengeId: data.challenge_id,
      tempUser: username,
      isPendingMfa: true,
      scope: data.scope || scope,
      clientHeaders: extraHeaders,
      clientContext: buildClientContext(clientContext)
    };

    const { sessionId, ttl } = await sessionService.createSession(sessionPayload, 300);

    return { 
      sessionToken: sessionId, 
      message: 'MFA Required. Check your email.',
      ttl 
    };
  }

  async finalizeAppLogin(sessionId, code, email, extraHeaders = {}, clientContext = {}) {
    const session = await sessionService.getSession(sessionId);
    
    if (!session || !session.isPendingMfa) {
      throw new Error('Sessão inválida ou expirada para finalização de login.');
    }

    const currentContext = buildClientContext(clientContext);
    if (session.clientContext) {
      if (!hasSameClientContext(session.clientContext, currentContext)) {
        throw new Error('Sessão bloqueada: alteração detectada no dispositivo/IP.');
      }
    } else {
      session.clientContext = currentContext;
    }

    const params = new URLSearchParams({
      challenge_id: session.challengeId,
      code: code,
      email: email || session.tempUser,
    });

    const { data } = await httpClient.post(config.api.endpoints.appCode, params, {
      headers: { Authorization: `Basic ${config.security.basicAuthHeader}`, ...extraHeaders },
    });

    const accessToken = data.access_token || data.token;

    if (!accessToken) {
      throw new Error('Backend não retornou access_token no login final.');
    }

    const clientHeaders = Object.keys(extraHeaders || {}).length
      ? extraHeaders
      : session.clientHeaders || {};

    const finalPayload = {
      token: accessToken,
      user: data.user,
      scope: data.scope,
      tenantId: data.user?.tenant_id, 
      isPendingMfa: false,
      clientHeaders,
      clientContext: session.clientContext
    };

    const ttl = data.expires_in || config.session.ttlSeconds;
    await sessionService.updateSession(sessionId, finalPayload, ttl);
    await sessionService.storeTokenMetadata(accessToken, clientHeaders, ttl);

    return { user: data.user, scope: data.scope, ttl };
  }

  /**
   * Busca informações do usuário no backend usando o token Bearer.
   * Retorna `null` em caso de erro.
   */
  async getUserInfoFromToken(token, extraHeaders = {}) {
    if (!token) return null;
    try {
      const validation = await this._validateTokenWithBackend(token, extraHeaders);
      return validation?.user || validation || null;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // FLUXO 4: GESTÃO DE TICKETS SSO (Artifact Binding)
  // ===========================================================================

  /**
   * Gera o Ticket (Artifact) persistindo exclusivamente em Postgres.
   */
  async createSSOTicket(userToken, userIp, sessionEmail) {
    this._assertTicketRepo();

    const ticket = crypto.randomUUID();
    const payload = {
      token: userToken,
      ip: userIp,
      email: sessionEmail || null,
    };

    try {
      await ticketRepo.createTicketPG(ticket, payload.token, payload.ip, payload.email, TICKET_TTL_SECONDS);
      await ticketRepo.insertAudit({ ticket, type: 'created', payload });
      return { ticket };
    } catch (err) {
      console.error('[SSO] Falha ao gravar ticket em Postgres:', err?.message || err, err?.stack || 'no-stack');
      throw new Error('Erro ao persistir ticket SSO.');
    }
  }

  /**
   * Valida o Ticket, checa IP, valida no Laravel e QUEIMA o ticket (somente Postgres).
   */
  async validateAndBurnTicket(ticket, requesterIp, extraHeaders = {}) {
    this._assertTicketRepo();

    let client;
    const clientIp = this._normalizeIp(requesterIp);

    try {
      const result = await ticketRepo.getTicketForUpdate(ticket);
      client = result?.client;
      const row = result?.row;

      if (!row) {
        const currentClient = client; client = null;
        await this._rejectTicket({ client: currentClient, ticket, reason: 'not_found', clientIp });
      }

      const expiresAt = this._toDate(row.expires_at);
      if (row.used) {
        const currentClient = client; client = null;
        await this._rejectTicket({ client: currentClient, ticket, reason: 'already_used', clientIp });
      }
      if (!expiresAt || expiresAt <= new Date()) {
        const currentClient = client; client = null;
        await this._rejectTicket({ client: currentClient, ticket, reason: 'expired', clientIp });
      }

      const ticketIp = this._normalizeIp(row.ip);
      if (!this._isSameIp(ticketIp, clientIp)) {
        await ticketRepo.insertAudit({
          ticket,
          type: 'validate_failed',
          payload: { reason: 'ip_mismatch', ticketIp, requesterIp: clientIp }
        });
        await ticketRepo.markTicketUsed(client, ticket);
        client = null;
        throw new Error('Bloqueio de Segurança: IP de origem diferente do IP de destino.');
      }

      await ticketRepo.markTicketUsed(client, ticket);
      client = null;
      await ticketRepo.insertAudit({ ticket, type: 'validated', payload: { requesterIp: clientIp } });

      const tokenInfo = await this._validateTokenWithBackend(row.token, extraHeaders);
      const userData = tokenInfo?.user_email || tokenInfo || null;

      return {
        valid: true,
        user: userData,
        original_token: row.token,
        original_email: row.email
      };
    } catch (error) {
      if (client) {
        await this._rollbackAndRelease(client);
      }
      throw error;
    }
  }

  async logout(sessionId) {
    if (!sessionId) return;
    const session = await sessionService.getSession(sessionId);
    await sessionService.removeSession(sessionId);
    if (session?.token) {
      await sessionService.removeTokenMetadata(session.token);
    }
  }

  _assertTicketRepo() {
    const hasRepo = ticketRepo
      && typeof ticketRepo.createTicketPG === 'function'
      && typeof ticketRepo.getTicketForUpdate === 'function'
      && typeof ticketRepo.markTicketUsed === 'function';

    if (!hasRepo) {
      throw new Error('Repositório de tickets indisponível.');
    }
  }

  async _rejectTicket({ client, ticket, reason, clientIp, message = DEFAULT_TICKET_ERROR }) {
    await this._rollbackAndRelease(client);
    await ticketRepo.insertAudit({ ticket, type: 'validate_failed', payload: { reason, requesterIp: clientIp } });
    throw new Error(message);
  }

  async _rollbackAndRelease(client) {
    if (!client) return;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.warn('[SSO] Falha ao executar rollback do ticket:', rollbackErr?.message || rollbackErr);
    } finally {
      client.release();
    }
  }

  _normalizeIp(ip = '') {
    if (!ip) return '';
    const raw = ip.split(',')[0].trim();
    return raw.startsWith('::ffff:') ? raw.substring(7) : raw;
  }

  _isSameIp(expected, received) {
    return expected === received;
  }

  _toDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date?.getTime()) ? null : date;
  }

  async _validateTokenWithBackend(token, extraHeaders = {}) {
    if (!token) {
      throw new Error('Token ausente para validação.');
    }

    const storedHeaders = await sessionService.getTokenMetadata(token);
    const headersToSend = storedHeaders && Object.keys(storedHeaders).length
      ? storedHeaders
      : extraHeaders;

    const params = new URLSearchParams({ token });
    const { data } = await httpClient.post('/api/v1/auth/token/validate', params, {
      headers: {
        Authorization: `Basic ${config.security.basicAuthHeader}`,
        Accept: 'application/json',
        ...headersToSend
      }
    });

    if (!data) {
      throw new Error('Backend não retornou dados na validação de token.');
    }

    return data;
  }
}

export const authService = new AuthService();
