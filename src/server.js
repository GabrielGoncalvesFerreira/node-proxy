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

const allowedOrigins = config.cors.allowedOrigins || [];
const isOriginAllowed = (origin) => allowedOrigins.some((allowed) => allowed === origin);

const trustedIps = Array.isArray(config.proxy.trustProxy) 
  ? config.proxy.trustProxy 
  : (config.proxy.trustProxy ? config.proxy.trustProxy.split(',').map(i => i.trim()) : []);

// Otimização de conexões HTTP
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000
}));

const app = Fastify({ 
  logger: true,
  trustProxy: trustedIps,
});

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

  const connectionIp = req.raw.socket.remoteAddress?.replace('::ffff:', '');

  // Usa a variável 'trustedIps' que garantimos ser um Array lá em cima
  if (trustedIps.length > 0 && !trustedIps.includes(connectionIp)) {
    req.log.warn(`[FIREWALL] Bloqueado: ${connectionIp}`);
    return reply.code(403).send({ message: 'Bloqueado pelo proxy (IP não autorizado).', error: 'Forbidden' });
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


await app.register(formbody);
await app.register(cookie);



// 2. Rotas BFF (Registradas como /api/v1/auth/...)
await app.register(registerRoutes, { prefix: '/auth' });

// 3. Proxy Reverso (Catch-all para o Laravel)
await app.register(proxy, {
  upstream: config.api.baseUrl,
  prefix: '/auth',
  httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
  preHandler: async (req, reply) => {
  // 1. Executa middleware de lógica de negócio (se existir no arquivo)
  if (proxyPreHandler) await proxyPreHandler(req, reply);

  // 2. CORREÇÃO CRÍTICA: Re-serializa o body para o Proxy aceitar
  if (
    req.body &&
    typeof req.body === 'object' &&
    !Buffer.isBuffer(req.body) &&
    typeof req.body.pipe !== 'function'
  ) {
    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      req.body = JSON.stringify(req.body);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      req.body = new URLSearchParams(req.body).toString();
    }
    
    // Deleta o content-length antigo para evitar erros de tamanho
    delete req.headers['content-length'];
  }
},
  
  replyOptions: {
    onResponse: (req, reply, res) => {
      if (reply.statusCode >= 400) {
        req.log.warn(`[Proxy Status] ${reply.statusCode} para ${req.url}`);
      }

      if (res?.headers) {
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) {
            reply.header(key, value);
          }
        }
      }

      reply.code(res?.statusCode || reply.statusCode);
      if (res?.stream) {
        reply.send(res.stream);
        return;
      }

      if (res && typeof res.pipe === 'function') {
        reply.send(res);
        return;
      }

      reply.send(null);
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
