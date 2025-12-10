import { createClient } from 'redis';
import { config } from '../config/env.js';

if (!config.redis.url) {
  throw new Error('FATAL: REDIS_URL não configurada.');
}

const redisClient = createClient({
  url: config.redis.url,
  socket: {
    // Tempo máximo para tentar conectar (ms)
    connectTimeout: 5000,
    // Estratégia simples de reconexão exponencial (recebe número de tentativas)
    reconnectStrategy: (retries) => {
      // backoff exponencial limitado a 2s
      return Math.min(50 * retries, 2000);
    }
  }
});

redisClient.on('error', (err) => {
  console.error('[Redis] Erro de conexão:', err);
});

redisClient.on('connect', () => {
  console.log('[Redis] Conectado com sucesso.');
});

// Tentativa de conexão inicial não bloqueante: se falhar, o client
// seguirá tentando reconectar conforme a `reconnectStrategy` acima.
redisClient.connect().catch((err) => {
  console.error('[Redis] Falha inicial ao conectar (não fatal), o client tentará reconectar:', err?.message || err);
});

export default redisClient;