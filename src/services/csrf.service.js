import crypto from 'node:crypto';
import { config } from '../config/env.js';

const CSRF_HEADER = 'x-csrf-token';

const TIMING_SAFE_COMPARE = (a, b) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufferA, bufferB);
};

class CsrfService {
  constructor() {
    this.cookieName = config.security.csrfCookieName;
  }

  issueToken(reply, ttlSeconds) {
    const token = crypto.randomBytes(32).toString('hex');
    const maxAge = ttlSeconds || config.session.ttlSeconds;
    reply.setCookie(this.cookieName, token, {
      path: '/',
      secure: config.session.secure,
      sameSite: 'strict',
      httpOnly: false,
      domain: config.session.domain,
      maxAge
    });
    return token;
  }

  ensureToken(req, reply, ttlSeconds) {
    if (this.getTokenFromCookie(req)) {
      return;
    }
    this.issueToken(reply, ttlSeconds);
  }

  clear(reply) {
    reply.clearCookie(this.cookieName, {
      path: '/',
      domain: config.session.domain
    });
  }

  enforce(req, reply) {
    if (this.isValid(req)) {
      return true;
    }
    reply.code(403).send({ message: 'CSRF token inválido ou ausente.' });
    return false;
  }

  isValid(req) {
    const cookieToken = this.getTokenFromCookie(req);
    const headerToken = this.getTokenFromHeader(req);
    if (!cookieToken || !headerToken) return false;
    try {
      return TIMING_SAFE_COMPARE(cookieToken, headerToken);
    } catch {
      return false;
    }
  }

  getTokenFromHeader(req) {
    return req.headers?.[CSRF_HEADER] || req.headers?.[CSRF_HEADER.toUpperCase()];
  }

  getTokenFromCookie(req) {
    return req.cookies?.[this.cookieName];
  }
}

export const csrfService = new CsrfService();
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
