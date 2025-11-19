// Cache de token com Redis + memória (LRU).
// Objetivo: evitar pedir um novo token a cada requisição.
// Chaveia por tenant + audiência + escopos.

import axios from 'axios';
import { LRUCache } from 'lru-cache';
import redis from './redis.js';

const cacheMemoria = new LRUCache({ max: 1000 }); // até 1000 chaves em memória

// Monta a chave única do token no cache
function chaveToken({ tenantId, audiencia, escopos }) {
  return `token:${tenantId}:${audiencia}:${escopos.slice().sort().join(',')}`;
}

// Obtém (ou renova) token de aplicação via client_credentials
export async function obterTokenCliente({ tenantId, audiencia, escopos }) {
  const chave = chaveToken({ tenantId, audiencia, escopos });
  const agora = Date.now();

  // 1) Tenta memória
  const m = cacheMemoria.get(chave);
  if (m && m.expiracao - agora > 30000) return m.token;

  // 2) Tenta Redis
  const bruto = await redis.get(chave);
  if (bruto) {
    const parsed = JSON.parse(bruto);
    if (parsed.expiracao - agora > 30000) {
      cacheMemoria.set(chave, parsed);
      return parsed.token;
    }
  }

  // 3) Lock simples para evitar tempestade de renovação
  const chaveLock = `${chave}:lock`;
  const travado = await redis.set(chaveLock, '1', { NX: true, PX: 8000 });
  if (!travado) {
    // Outro processo está renovando; aguarda um pouco e tenta ler do Redis de novo
    await new Promise(r => setTimeout(r, 300));
    const deNovo = await redis.get(chave);
    if (deNovo) return JSON.parse(deNovo).token;
  }

  // 4) Solicita novo token ao Authorization Server (Laravel)
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.OAUTH_CLIENT_ID,
    client_secret: process.env.OAUTH_CLIENT_SECRET,
    scope: escopos.join(' ')
  });

  const { data } = await axios.post(process.env.OAUTH_TOKEN_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000
  });

  // Calcula expiração (em ms)
  const expiracao = agora + data.expires_in * 1000;
  const valor = { token: data.access_token, expiracao };

  // Grava nos caches
  await redis.set(chave, JSON.stringify(valor), { PX: data.expires_in * 1000 });
  cacheMemoria.set(chave, valor);
  await redis.del(chaveLock);

  return data.access_token;
}

export async function invalidarTokenCliente({ tenantId, audiencia, escopos }) {
  const chave = chaveToken({ tenantId, audiencia, escopos });
  cacheMemoria.delete(chave);
  await redis.del(chave);
}
