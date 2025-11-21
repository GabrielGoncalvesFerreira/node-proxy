import { httpClient } from './http.service.js';
import { sessionService } from './session.service.js';
import { config } from '../config/env.js';
import crypto from 'node:crypto';

class AuthService {
  // ===========================================================================
  // FLUXO 1: APP (USUÁRIO ERP) - Login com senha + MFA
  // ===========================================================================

  async initiateAppLogin(username, password, scope = 'default', extraHeaders = {}) {
    const params = new URLSearchParams({
      grant_type: 'password',
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
    };

    const { sessionId, ttl } = await sessionService.createSession(sessionPayload, 300);

    return { 
      sessionId, 
      message: 'MFA Required. Check your email.',
      ttl 
    };
  }

  async finalizeAppLogin(sessionId, code, email, extraHeaders = {}) {
    const session = await sessionService.getSession(sessionId);
    
    if (!session || !session.isPendingMfa) {
      throw new Error('Sessão inválida ou expirada para finalização de login.');
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

    const finalPayload = {
      token: accessToken,
      user: data.user,
      scope: data.scope,
      tenantId: data.user?.tenant_id, 
      isPendingMfa: false,
    };

    const ttl = data.expires_in || config.session.ttlSeconds;
    await sessionService.updateSession(sessionId, finalPayload, ttl);

    return { user: data.user, scope: data.scope };
  }

  // ===========================================================================
  // FLUXO 2: ADMIN - Login via Email + Código
  // ===========================================================================

  async initiateAdminLogin(email, extraHeaders = {}) {
    const params = new URLSearchParams({ email });
    await httpClient.post(config.api.endpoints.adminLogin, params, {
      headers: extraHeaders
    });
    return { message: 'Code sent to admin email.' };
  }

  async finalizeAdminLogin(email, code, extraHeaders = {}) {
    const params = new URLSearchParams({ email, code });
    const { data } = await httpClient.post(config.api.endpoints.adminCode, params, {
      headers: extraHeaders
    });

    const accessToken = data.access_token || data.token;

    if (!accessToken) {
      throw new Error('Backend não retornou access_token para admin login.');
    }

    const sessionPayload = {
      token: accessToken,
      user: data.user,
      scope: data.scope,
      isAdmin: true,
    };

    const ttl = data.expires_in || config.session.ttlSeconds;
    const { sessionId } = await sessionService.createSession(sessionPayload, ttl);

    return { sessionId, user: data.user, ttl };
  }

  // ===========================================================================
  // FLUXO 3: CLIENT CREDENTIALS (Integrações M2M)
  // ===========================================================================

  async requestClientToken({ clientId, clientSecret, scope = 'default', createSession = false }, extraHeaders = {}) {
    const finalClientId = clientId || config.security.clientId;
    const finalSecret = clientSecret || config.security.clientSecret;
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      scope,
    });

    const authHeader = Buffer.from(`${finalClientId}:${finalSecret}`).toString('base64');

    const { data } = await httpClient.post(config.api.endpoints.clientToken, params, {
      headers: { Authorization: `Basic ${authHeader}`, ...extraHeaders },
    });

    if (createSession) {
      const sessionPayload = {
        token: data.access_token,
        clientId: finalClientId,
        scope: data.scope,
        isClient: true
      };
      
      const ttl = data.expires_in || 3600;
      const { sessionId } = await sessionService.createSession(sessionPayload, ttl);
      
      return { sessionId, ttl, scope: data.scope, token_type: data.token_type };
    }

    return data;
  }

  // ===========================================================================
  // FLUXO 4: GESTÃO DE TICKETS SSO (Artifact Binding)
  // ===========================================================================

  /**
   * Gera o Ticket (Artifact) salvando IP e Token Original no Redis.
   */
  async createSSOTicket(userToken, userIp) {
    const ticket = crypto.randomUUID();
    const key = `ticket:${ticket}`;

    const payload = {
      token: userToken,
      ip: userIp
    };
    
    // Salva no Redis por 30 segundos
    await sessionService.createSessionRaw(key, JSON.stringify(payload), 30);

    return { ticket };
  }

  /**
   * Valida o Ticket, checa IP, valida no Laravel e QUEIMA o ticket.
   */
  async validateAndBurnTicket(ticket, requesterIp) {
    const key = `ticket:${ticket}`;
    const rawData = await sessionService.getSessionRaw(key);

    if (!rawData) {
      throw new Error('Ticket inválido ou expirado.');
    }

    const sessionData = JSON.parse(rawData);

    // 1. Validação de IP (Anti-Hijacking)
    if (sessionData.ip !== requesterIp) {
      await sessionService.removeSessionRaw(key); // Queima por segurança
      throw new Error('Bloqueio de Segurança: IP de origem diferente do IP de destino.');
    }

    // 2. Queima o ticket (Anti-Replay)
    await sessionService.removeSessionRaw(key);

    // 3. Valida se o token original ainda é aceito pelo Laravel
    try {
      const { data: userData } = await httpClient.get('/api/user', {
        headers: { 
            Authorization: `Bearer ${sessionData.token}`,
            'Accept': 'application/json'
        }
      });
      
      return { 
        valid: true,
        user: userData,
        original_token: sessionData.token 
      };

    } catch (err) {
      throw new Error('Sessão SSO original inválida ou expirada.');
    }
  }

  async logout(sessionId) {
    return sessionService.removeSession(sessionId);
  }
}

export const authService = new AuthService();
