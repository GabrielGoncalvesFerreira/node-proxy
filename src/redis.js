import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL não configurada');
}

const redis = createClient({ url: redisUrl });

redis.on('error', (err) => {
  console.error('Erro no Redis:', err); // eslint-disable-line no-console
});

await redis.connect();

export default redis;
