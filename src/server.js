import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import proxy from '@fastify/http-proxy';
import { setGlobalDispatcher, Agent } from 'undici';
import crypto from 'node:crypto';

import { config } from './config/env.js';
import { registerRoutes } from './routes.js';
import { proxyPreHandler } from './proxy/middleware.js'; // Removido normalizeApiPath, não precisa mais aqui

// Otimização de conexões HTTP
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000
}));

const app = Fastify({ 
  logger: true,
  trustProxy: ['127.0.0.1', '::1', '172.29.0.1/24'],
});

// ==================================================================
// 1. HOOK GLOBAL: REWRITE DE URL + INJEÇÃO DE HEADERS (AUDITORIA)
// ==================================================================
const canonicalizeHeader = (name = '') =>
  name
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-');

const normalizeHeaderValue = (value) => {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
};

const getHeaderValue = (headers, name) => {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const canonical = canonicalizeHeader(name);
  return normalizeHeaderValue(headers[lower] ?? headers[canonical] ?? headers[name]);
};

const setHeaderValue = (headers, name, value) => {
  if (!name || value === undefined || value === null) return;
  const lower = name.toLowerCase();
  const canonical = canonicalizeHeader(name);
  headers[lower] = value;
  headers[canonical] = value;
};

app.addHook('onRequest', async (req, reply) => {
  // --- A. Normalização de URL ---
  // Corrige /v1 -> /api/v1 para roteamento interno
  let currentUrl = req.raw.url;
  // Remove query string para checar o path
  const [rawPath, query] = currentUrl.split('?');
  
  let newPath = rawPath;
  if (!newPath.startsWith('/api')) {
    newPath = newPath.startsWith('/') ? `/api${newPath}` : `/api/${newPath}`;
  }
  newPath = newPath.replace(/^\/api\/api/, '/api'); // Evita duplicidade

  const finalUrl = query ? `${newPath}?${query}` : newPath;

  if (currentUrl !== finalUrl) {
    req.raw.url = finalUrl; 
    // req.log.info(`https://ahrefs.com/writing-tools/paragraph-rewriter ${currentUrl} -> ${finalUrl}`);
  }

  // --- B. Injeção de Headers de Auditoria (Laravel precisa disso) ---
  setHeaderValue(req.headers, 'X-Request-Id', getHeaderValue(req.headers, 'X-Request-Id') || crypto.randomUUID());
  setHeaderValue(req.headers, 'X-BFF', 'true');

  const incomingXff = getHeaderValue(req.headers, 'X-Forwarded-For');
  const incomingRealIp = getHeaderValue(req.headers, 'X-Real-IP');
  const clientIp = incomingXff?.split(',').map(part => part.trim()).find(Boolean)
    || incomingRealIp
    || req.ip;

  const updatedChain = incomingXff ? `${incomingXff}, ${req.ip}` : req.ip;
  const bffIp = req.socket?.localAddress || req.ip;

  setHeaderValue(req.headers, 'X-Forwarded-For', updatedChain);
  setHeaderValue(req.headers, 'X-Real-IP', clientIp);
  setHeaderValue(req.headers, 'X-Client-IP', clientIp);
  setHeaderValue(req.headers, 'X-BFF-IP', bffIp);

  // Garante User-Agent
  if (!getHeaderValue(req.headers, 'User-Agent')) {
    setHeaderValue(req.headers, 'User-Agent', 'Unknown-Client/1.0');
  }

  // Se o frontend não enviou `X-Client-Version`, preenche com o User-Agent
  if (!getHeaderValue(req.headers, 'X-Client-Version')) {
    const ua = getHeaderValue(req.headers, 'User-Agent');
    if (ua) setHeaderValue(req.headers, 'X-Client-Version', ua);
  }
});

// 1. Plugins
await app.register(formbody);
await app.register(cookie);

const allowedOrigins = config.cors.allowedOrigins || [];
const isOriginAllowed = (origin) => allowedOrigins.some((allowed) => allowed === origin);

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) {
      // Requisições server-to-server (sem header Origin)
      return cb(null, true);
    }
    if (isOriginAllowed(origin)) {
      return cb(null, true);
    }
    const error = new Error('Origin não autorizada.');
    error.statusCode = 403;
    return cb(error);
  }, 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['X-CSRF-Token']
});

// 2. Rotas BFF (Registradas como /api/v1/auth/...)
await registerRoutes(app);

// 3. Proxy Reverso (Catch-all para o Laravel)
await app.register(proxy, {
  upstream: config.api.baseUrl,
  prefix: '/',
  httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
  preHandler: proxyPreHandler,
  
  replyOptions: {
    onResponse: (req, reply, res) => {
      if (reply.statusCode >= 400) {
        req.log.warn(`[Proxy Status] ${reply.statusCode} para ${req.url}`);
      }
      reply.send(res);
    }
  }
});

const start = async () => {
  try {
    await app.listen({ 
      host: '0.0.0.0',
      port: Number(config.app.port) 
    });
    console.log(`🚀 BFF rodando na porta ${config.app.port}`);
    console.log(`👉 Backend Alvo: ${config.api.baseUrl}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
