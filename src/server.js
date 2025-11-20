import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import proxy from '@fastify/http-proxy';
import { setGlobalDispatcher, Agent } from 'undici';

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
  trustProxy: true 
});

// ==================================================================
// 1. HOOK GLOBAL: REWRITE DE URL + INJEÇÃO DE HEADERS (AUDITORIA)
// ==================================================================
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
  req.headers['x-request-id'] ||= crypto.randomUUID();
  req.headers['x-bff'] = 'true';
  
  // Garante IP real
  req.headers['x-forwarded-for'] = req.ip;
  req.headers['x-real-ip'] = req.ip;

  // Garante User-Agent
  if (!req.headers['user-agent']) {
    req.headers['user-agent'] = 'Unknown-Client/1.0';
  }
});

// 1. Plugins
await app.register(formbody);
await app.register(cookie);

await app.register(cors, {
  origin: true, 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
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