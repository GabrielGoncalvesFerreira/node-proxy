import { createClient } from 'redis';
import { config } from '../config/env.js';

if (!config.redis.url) {
  throw new Error('FATAL: REDIS_URL não configurada.');
}

const redisClient = createClient({
  url: config.redis.url,
});

redisClient.on('error', (err) => {
  console.error('[Redis] Erro de conexão:', err);
});

redisClient.on('connect', () => {
  console.log('[Redis] Conectado com sucesso.');
});

// Conexão inicial (Top-level await é suportado no Node 20+ com modules)
await redisClient.connect();

export default redisClient;