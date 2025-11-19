import axios from 'axios';
import { criarSessao, obterSessao, removerSessao } from '../sessoes.js';

const PARAM_CLIENT_FIELDS = new Set(['client_id', 'client_secret', 'clientId', 'clientSecret']);

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return req.body;
}

function wantsBffSession(req, body) {
  const headerFlag = String(req.headers['x-bff-session'] ?? '').toLowerCase();
  const bodyFlag = String(body.bff_session ?? '').toLowerCase();
  return headerFlag === 'true' || headerFlag === '1' || bodyFlag === 'true' || bodyFlag === '1';
}

function resolverPayloadErro(err, mensagemPadrao) {
  const resposta = err.response?.data;

  if (resposta) {
    if (typeof resposta === 'object' && resposta !== null) {
      const mensagem = resposta.mensagem ?? resposta.message;
      return mensagem ? { ...resposta, mensagem } : resposta;
    }

    if (typeof resposta === 'string') {
      return { message: resposta };
    }
  }

  const mensagemFallback = err.message ?? mensagemPadrao;
  return { message: mensagemFallback };
}

function extractClientCredentials(req, body) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    try {
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      const [clientId] = decoded.split(':');
      return { method: 'header', clientId: clientId || null, authHeader };
    } catch {
      return { error: 'Authorization Basic inválido' };
    }
  }

  const clientId = body.client_id || body.clientId;
  const clientSecret = body.client_secret || body.clientSecret;
  if (!clientId || !clientSecret) {
    return { error: 'client_id/client_secret ausentes' };
  }

  return {
    method: 'body',
    clientId,
    clientSecret
  };
}

function buildClientCredentialsForm(body, includeClientFields) {
  const form = new URLSearchParams();

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (key === 'bff_session') continue;
    if (!includeClientFields && PARAM_CLIENT_FIELDS.has(key)) continue;

    form.append(key, value);
  }

  if (!form.has('grant_type')) {
    form.set('grant_type', 'client_credentials');
  }

  if (includeClientFields) {
    const clientId = body.client_id || body.clientId;
    const clientSecret = body.client_secret || body.clientSecret;
    if (clientId && !form.has('client_id')) {
      form.set('client_id', clientId);
    }
    if (clientSecret && !form.has('client_secret')) {
      form.set('client_secret', clientSecret);
    }
  }

  return form;
}

export function createAuthHandlers({
  endpoints,
  basicAppAuth,
  sessionCookieName,
  sessionTtlFallback,
  setSessionCookie,
  clearSessionCookie
}) {
  const {
    appEndpoint,
    clientCredentialsEndpoint,
    erpTokenEndpoint,
    adminEndpoint,
    adminEndpointCode
  } = endpoints;

  async function recuperarSessaoAtiva(req, reply) {
    const sessionId = req.cookies?.[sessionCookieName];
    if (!sessionId) return null;

    const dados = await obterSessao(sessionId);
    if (!dados) {
      clearSessionCookie(reply);
      return null;
    }

    return { id: sessionId, dados };
  }

  async function encerrarSessao(req, reply) {
    const sessao = await recuperarSessaoAtiva(req, reply);
    if (sessao?.id) {
      await removerSessao(sessao.id);
    }
    clearSessionCookie(reply);
    return reply.send({ autenticado: false });
  }

  async function handleAppCredentials(req, reply) {
    const body = parseBody(req);
    const login = body.login || body.username;
    const password = body.password;
    const scope = body.scope || 'default';
    const grantType = body.grant_type || 'password';

    if (!login || !password) {
      return reply.code(400).send({ message: 'Credenciais ERP ausentes (login/username e password)' });
    }

    const form = new URLSearchParams({
      grant_type: grantType,
      login,
      password,
      scope
    });

    try {
      const { data } = await axios.post(appEndpoint, form.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAppAuth}`
        },
        timeout: 8000
      });

      const { sessionId, ttl } = await criarSessao({
        challenge_id: data.challenge_id,
        user: data.login,
        scope: data.scope,
        tenantId: req.headers['x-tenant-id'],
        expiresIn: data.expires_in ?? sessionTtlFallback
      });

      setSessionCookie(reply, sessionId, ttl);

      return reply.send({
        expires_in: data.expires_in,
        scope: data.scope,
        user: data.user ?? null
      });
    } catch (err) {
      const status = err.response?.status ?? 500;
      const payload = resolverPayloadErro(err, 'Falha ao autenticar no ERP');
      return reply.code(status).send(payload);
    }
  }

  async function handleClientCredentialsToken(req, reply) {
    const body = parseBody(req);
    const sessionRequested = wantsBffSession(req, body);
    const credentials = extractClientCredentials(req, body);

    if (credentials.error) {
      return reply.code(400).send({ message: credentials.error });
    }

    const includeClientFields = credentials.method === 'body';
    const form = buildClientCredentialsForm(body, includeClientFields);

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (credentials.method === 'header') {
      headers.Authorization = credentials.authHeader;
    }

    try {
      const { data } = await axios.post(clientCredentialsEndpoint, form.toString(), {
        headers,
        timeout: 8000
      });

      if (sessionRequested) {
        const { sessionId, ttl } = await criarSessao({
          token: data.access_token,
          user: { client_id: credentials.clientId || null },
          scope: data.scope,
          tenantId: credentials.clientId || req.headers['x-tenant-id'],
          expiresIn: data.expires_in ?? sessionTtlFallback
        });

        setSessionCookie(reply, sessionId, ttl);

        return reply.send({
          token_type: data.token_type,
          expires_in: data.expires_in,
          scope: data.scope
        });
      }

      return reply.send(data);
    } catch (err) {
      const status = err.response?.status ?? 500;
      const payload = resolverPayloadErro(err, 'Falha ao obter token client_credentials');
      return reply.code(status).send(payload);
    }
  }

  async function handleErpToken(req, reply) {
    const body = parseBody(req);
    const login = body.login || body.username;
    const password = body.password;
    const scope = body.scope || 'default';
    const grantType = body.grant_type || 'password';

    if (!login || !password) {
      return reply.code(400).send({ message: 'Credenciais ERP ausentes (login/username e password)' });
    }

    const form = new URLSearchParams({
      grant_type: grantType,
      username: login,
      password,
      scope
    });

    try {
      const { data } = await axios.post(erpTokenEndpoint, form.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAppAuth}`
        },
        timeout: 8000
      });

      const { sessionId, ttl } = await criarSessao({
        token: data.access_token,
        user: data.user,
        scope: data.scope,
        tenantId: req.headers['x-tenant-id'],
        expiresIn: data.expires_in ?? sessionTtlFallback
      });

      setSessionCookie(reply, sessionId, ttl);

      return reply.send({
        token_type: data.token_type,
        expires_in: data.expires_in,
        scope: data.scope,
        user: data.user ?? null
      });
    } catch (err) {
      const status = err.response?.status ?? 500;
      const payload = resolverPayloadErro(err, 'Falha ao autenticar no ERP');
      return reply.code(status).send(payload);
    }
  }

  async function handleAdminLogin(req, reply) {
    const body = parseBody(req);
    const email = body.email;

    if (!email) {
      return reply.code(400).send({ message: 'Credenciais ausentes (Email).' });
    }

    const form = new URLSearchParams({ email });

    try {
      const { data } = await axios.post(adminEndpoint, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000
      });

      return reply.send(data);
    } catch (err) {
      const status = err.response?.status ?? 500;
      const payload = resolverPayloadErro(err, 'Falha ao autenticar');
      return reply.code(status).send(payload);
    }
  }

  async function handleAdminVerify(req, reply) {
    const body = parseBody(req);
    const email = body.email;
    const code = body.code;

    if (!email || !code) {
      return reply.code(400).send({ message: 'Credenciais ERP ausentes (login/username e password)' });
    }

    const form = new URLSearchParams({ email, code });

    try {
      const { data } = await axios.post(adminEndpointCode, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000
      });

      const { sessionId, ttl } = await criarSessao({
        token: data.access_token,
        user: data.user,
        scope: data.scope,
        tenantId: req.headers['x-tenant-id'],
        expiresIn: data.expires_in ?? sessionTtlFallback
      });

      setSessionCookie(reply, sessionId, ttl);

      return reply.send({
        token_type: data.token_type,
        expires_in: data.expires_in,
        scope: data.scope,
        user: data.user ?? null
      });
    } catch (err) {
      const status = err.response?.status ?? 500;
      const payload = resolverPayloadErro(err, 'Falha ao autenticar no ERP');
      return reply.code(status).send(payload);
    }
  }

  async function handleSessionStatus(req, reply) {
    const sessao = await recuperarSessaoAtiva(req, reply);
    if (!sessao) {
      return reply.code(401).send({ autenticado: false });
    }

    return {
      autenticado: true,
      scope: sessao.dados.scope,
      user: sessao.dados.user
    };
  }

  return {
    handleAppCredentials,
    handleClientCredentialsToken,
    handleErpToken,
    handleAdminLogin,
    handleAdminVerify,
    handleSessionStatus,
    encerrarSessao,
    recuperarSessaoAtiva
  };
}
