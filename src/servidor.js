import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { setGlobalDispatcher, Agent } from 'undici';
import crypto from 'node:crypto';

import { escolherPolitica } from './politicas.js';
import { obterTokenCliente, invalidarTokenCliente } from './cache-de-token.js';
import { removerSessao } from './sessoes.js';
import { createAuthHandlers } from './handlers/autenticacao.js';
import { registerRoutes } from './routes.js';

const {
  PORT = '5180',
  API_BASE,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  SESSION_COOKIE_NAME = 'cv_session',
  SESSION_COOKIE_DOMAIN,
  SESSION_COOKIE_SECURE = 'true',
  SESSION_COOKIE_SAMESITE = 'lax',
  SESSION_TTL_SECONDS
} = process.env;

if (!API_BASE) {
  throw new Error('API_BASE não configurada');
}

if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
  throw new Error('Credenciais OAuth (OAUTH_CLIENT_ID/SECRET) não configuradas');
}

const basicAppAuth = Buffer
  .from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`, 'utf8')
  .toString('base64');

const sessionCookieSecure = SESSION_COOKIE_SECURE !== 'false';
const sameSiteLower = SESSION_COOKIE_SAMESITE.toLowerCase();
const allowedSameSite = new Set(['lax', 'strict', 'none']);
const sessionCookieSameSite = allowedSameSite.has(sameSiteLower) ? sameSiteLower : 'lax';
const sessionTtlFallback = Number(SESSION_TTL_SECONDS) > 0 ? Number(SESSION_TTL_SECONDS) : 86400;

const erpTokenEndpoint = new URL('/api/v1/auth/token/erp', API_BASE).toString();
const clientCredentialsEndpoint = new URL('/api/v1/auth/token', API_BASE).toString();
const appEndpoint = new URL('/api/v1/auth/login', API_BASE).toString();
const adminEndpoint = new URL('/api/admin/auth/login', API_BASE).toString();
const adminEndpointCode = new URL('/api/admin/auth/verify', API_BASE).toString();

function ensureBasicAuthHeader(headers) {
  if (!headers.authorization) {
    headers.authorization = `Basic ${basicAppAuth}`;
  }
}

function sessionCookieOptions(ttlSeconds) {
  return {
    httpOnly: true,
    secure: sessionCookieSecure,
    sameSite: sessionCookieSameSite,
    path: '/',
    domain: SESSION_COOKIE_DOMAIN || undefined,
    maxAge: ttlSeconds || sessionTtlFallback
  };
}

function setSessionCookie(reply, sessionId, ttlSeconds) {
  reply.setCookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(ttlSeconds));
}

function clearSessionCookie(reply) {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    domain: SESSION_COOKIE_DOMAIN || undefined
  });
}

function normalizeApiPath(url) {
  const [rawPath, query = ''] = url.split('?');
  let path = rawPath;

  if (!path.startsWith('/api')) {
    path = path.startsWith('/') ? `/api${path}` : `/api/${path}`;
  }

  path = path.replace(/^\/api+(?=\/)/, '/api');
  const queryString = query ? `?${query}` : '';
  return `${path}${queryString}`;
}

const endpoints = {
  appEndpoint,
  clientCredentialsEndpoint,
  erpTokenEndpoint,
  adminEndpoint,
  adminEndpointCode
};

const authHandlers = createAuthHandlers({
  endpoints,
  basicAppAuth,
  sessionCookieName: SESSION_COOKIE_NAME,
  sessionTtlFallback,
  setSessionCookie,
  clearSessionCookie
});

const { recuperarSessaoAtiva } = authHandlers;

setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000
}));

const app = Fastify({ logger: true, trustProxy: true });

await app.register(formbody);
await app.register(cookie, { hook: 'onRequest' });
await app.register(cors, {
  origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
  credentials: true
});

registerRoutes(app, authHandlers);

await app.register(proxy, {
  upstream: API_BASE,
  routes: [],
  prefix: '/',
  rewritePrefix: '',
  httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT']
});

async function proxyPreHandler(req, reply) {
  // =====================
  // Passo 1 - Validar request e identificar rota interna
  // =====================
  req.headers['x-request-id'] ||= crypto.randomUUID();
  req.headers['x-bff'] = 'true';

  const normalizedPath = normalizeApiPath(req.raw.url || req.url || '/').split('?')[0];
  const politica = escolherPolitica(normalizedPath, req.method);
  if (politica.tipo === 'passthrough') return;

  if (politica.tipo === 'sessao_usuario') {
    const sessao = await recuperarSessaoAtiva(req, reply);
    if (!sessao) {
      return reply.code(401).send({ message: 'Sessão expirada ou ausente' });
    }
    req.headers.authorization = `Bearer ${sessao.dados.token}`;
    req.ctxSessao = { id: sessao.id };
    return;
  }

  if (politica.tipo === 'token_basic_proxy') {
    ensureBasicAuthHeader(req.headers);
    return;
  }

  if (politica.tipo === 'oauth_client_credentials') {
    const tenantId = politica.resolverTenant(req);
    if (!tenantId) {
      return reply.code(400).send({ message: 'Tenant ausente (header x-tenant-id)' });
    }

    const token = await obterTokenCliente({
      tenantId,
      audiencia: politica.audiencia,
      escopos: politica.escopos
    });

    req.headers.authorization = `Bearer ${token}`;
    req.ctxTokenCache = { tenantId, audiencia: politica.audiencia, escopos: politica.escopos };
  }
}

function proxyReply(req, reply) {
  // =====================
  // Passo 2 - Normalizar path antes de enviar ao Laravel
  // =====================
  const normalizedUrl = normalizeApiPath(req.raw.url || req.url || '/');
  return reply.from(normalizedUrl);
}

const proxyMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
app.route({ method: proxyMethods, url: '/api', preHandler: proxyPreHandler, handler: proxyReply });
app.route({ method: proxyMethods, url: '/api/*', preHandler: proxyPreHandler, handler: proxyReply });

app.addHook('onResponse', async (req, reply) => {
  if (reply.statusCode !== 401) return;

  if (req.ctxSessao?.id) {
    await removerSessao(req.ctxSessao.id);
    clearSessionCookie(reply);
  }

  if (req.ctxTokenCache) {
    await invalidarTokenCliente(req.ctxTokenCache);
  }
});

app.listen({ host: '0.0.0.0', port: Number(PORT) });
