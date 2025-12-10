import crypto from 'node:crypto';
import redisClient from '../infra/redis-client.js';
import { config } from '../config/env.js';

class SessionService {
  /**
   * Gera um ID de sessão e salva os dados no Redis.
   * @param {Object} payload - Dados do usuário/token para salvar.
   * @param {number} ttlSeconds - Tempo de vida em segundos.
   * @returns {Promise<{sessionId: string, ttl: number}>}
   */
  async createSession(payload, ttlSeconds) {
    const sessionId = crypto.randomUUID();
    const key = this._getKey(sessionId);
    const ttl = ttlSeconds || config.session.ttlSeconds;

    // Serializa para string antes de salvar no Redis
    await redisClient.set(key, JSON.stringify(payload), {
      EX: ttl,
    });

    return { sessionId, ttl };
  }

  /**
   * Recupera os dados da sessão pelo ID.
   */
  async getSession(sessionId) {
    if (!sessionId) return null;
    
    const key = this._getKey(sessionId);
    const data = await redisClient.get(key);
    
    return data ? JSON.parse(data) : null;
  }

  /**
   * Atualiza dados de uma sessão existente mantendo o ID (útil para MFA).
   */
  async updateSession(sessionId, newPayload, ttlSeconds) {
    const key = this._getKey(sessionId);
    const ttl = ttlSeconds || config.session.ttlSeconds;
    
    await redisClient.set(key, JSON.stringify(newPayload), {
      EX: ttl // Reseta o TTL ou mantém o original se calcularmos a diferença (aqui reseta)
    });
  }

  /**
   * Remove a sessão (Logout).
   */
  async removeSession(sessionId) {
    if (!sessionId) return;
    const key = this._getKey(sessionId);
    await redisClient.del(key);
  }

  async storeTokenMetadata(token, headers = {}, ttlSeconds) {
    if (!token || !headers) return;
    const ttl = ttlSeconds || config.session.ttlSeconds;
    await redisClient.set(this._getTokenMetadataKey(token), JSON.stringify(headers), {
      EX: ttl
    });
  }

  async getTokenMetadata(token) {
    if (!token) return null;
    const data = await redisClient.get(this._getTokenMetadataKey(token));
    return data ? JSON.parse(data) : null;
  }

  async removeTokenMetadata(token) {
    if (!token) return;
    await redisClient.del(this._getTokenMetadataKey(token));
  }

  // Helper privado para padronizar a chave no Redis
  _getKey(id) {
    return `sessao:${id}`; // Mantive o prefixo 'sessao:' do seu código original
  }

  _getTokenMetadataKey(token) {
    return `tokenmeta:${token}`;
  }
}

export const sessionService = new SessionService();
