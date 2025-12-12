import crypto from 'node:crypto';
import redisClient from '../infra/redis-client.js';
import { config } from '../config/env.js';

const REFRESH_PREFIX = 'refresh:';
const REFRESH_BY_SESSION_PREFIX = 'refresh_by_session:';

const getRefreshKey = (id) => `${REFRESH_PREFIX}${id}`;
const getRefreshBySessionKey = (sessionId) => `${REFRESH_BY_SESSION_PREFIX}${sessionId}`;

class SessionService {
  /**
   * Cria uma nova sessão com TTL configurável.
   */
  async createSession(payload, ttlSeconds) {
    const sessionId = crypto.randomUUID();
    const key = this._getKey(sessionId);
    const ttl = ttlSeconds || config.session.ttlSeconds;
    const now = Date.now();
    const toStore = {
      ...payload,
      meta: {
        ...(payload?.meta || {}),
        createdAt: now,
        updatedAt: now,
        ttlSeconds: ttl,
        expiresAt: now + ttl * 1000
      }
    };

    await redisClient.set(key, JSON.stringify(toStore), { EX: ttl });
    return { sessionId, ttl, expiresAt: toStore.meta.expiresAt };
  }

  /**
   * Recupera uma sessão; remove se expirada.
   */
  async getSession(sessionId) {
    if (!sessionId) return null;
    const key = this._getKey(sessionId);
    const data = await redisClient.get(key);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      const expiresAt = parsed?.meta?.expiresAt;
      if (expiresAt && Date.now() > expiresAt) {
        await this.removeSession(sessionId);
        return null;
      }
      return parsed;
    } catch {
      await this.removeSession(sessionId);
      return null;
    }
  }

  /**
   * Atualiza a sessão mantendo o mesmo ID.
   */
  async updateSession(sessionId, newPayload, ttlSeconds) {
    if (!sessionId) return;
    const key = this._getKey(sessionId);
    const ttl = ttlSeconds || config.session.ttlSeconds;
    const now = Date.now();
    const toStore = {
      ...newPayload,
      meta: {
        ...(newPayload?.meta || {}),
        updatedAt: now,
        ttlSeconds: ttl,
        expiresAt: now + ttl * 1000
      }
    };

    await redisClient.set(key, JSON.stringify(toStore), { EX: ttl });
  }

  /**
   * Remove sessão e refresh vinculado.
   */
  async removeSession(sessionId) {
    if (!sessionId) return;
    const key = this._getKey(sessionId);
    await redisClient.del(key);
    await this.removeRefreshBySession(sessionId);
  }

  /**
   * Refresh tokens helpers
   */
  async createRefreshToken(sessionId, ttlSeconds, meta = {}) {
    if (!sessionId) {
      throw new Error('sessionId obrigatório para refresh token');
    }
    const refreshId = crypto.randomUUID();
    const key = getRefreshKey(refreshId);
    const ttl = ttlSeconds || config.session.refreshTtlSeconds;
    const toStore = { sessionId, ...meta };
    await redisClient.set(key, JSON.stringify(toStore), { EX: ttl });
    await redisClient.set(getRefreshBySessionKey(sessionId), refreshId, { EX: ttl });
    return { refreshId, ttl };
  }

  async getSessionIdByRefresh(refreshId) {
    if (!refreshId) return null;
    const data = await redisClient.get(getRefreshKey(refreshId));
    return data ? JSON.parse(data) : null;
  }

  async removeRefreshToken(refreshId) {
    if (!refreshId) return;
    await redisClient.del(getRefreshKey(refreshId));
  }

  async getRefreshBySession(sessionId) {
    if (!sessionId) return null;
    return redisClient.get(getRefreshBySessionKey(sessionId));
  }

  async removeRefreshBySession(sessionId) {
    if (!sessionId) return;
    const refreshId = await redisClient.get(getRefreshBySessionKey(sessionId));
    await redisClient.del(getRefreshBySessionKey(sessionId));
    if (refreshId) {
      await this.removeRefreshToken(refreshId);
    }
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

  _getKey(id) {
    return `sessao:${id}`;
  }

  _getTokenMetadataKey(token) {
    return `tokenmeta:${token}`;
  }
}

export const sessionService = new SessionService();
