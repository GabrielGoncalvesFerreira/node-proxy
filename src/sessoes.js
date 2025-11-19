import crypto from 'node:crypto';
import redis from './redis.js';

const PREFIXO_SESSAO = 'sessao:';

function chaveSessao(id) {
  return `${PREFIXO_SESSAO}${id}`;
}

export async function criarSessao({ token, user, scope, tenantId, expiresIn }) {
  if (!token) {
    throw new Error('Token de sessão inválido');
  }

  const sessionId = crypto.randomUUID();
  const payload = {
    token,
    user: user || null,
    scope: scope || null,
    tenantId: tenantId || null
  };

  const ttl = Number(expiresIn) > 0 ? Number(expiresIn) : 3600;

  await redis.set(chaveSessao(sessionId), JSON.stringify(payload), { EX: ttl });

  return { sessionId, ttl };
}

export async function obterSessao(sessionId) {
  if (!sessionId) return null;
  const bruto = await redis.get(chaveSessao(sessionId));
  return bruto ? JSON.parse(bruto) : null;
}

export async function removerSessao(sessionId) {
  if (!sessionId) return;
  await redis.del(chaveSessao(sessionId));
}
