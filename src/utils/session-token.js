import { config } from '../config/env.js';

const BEARER_PREFIX = /^Bearer\s+/i;

export const extractSessionToken = (req = {}) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !BEARER_PREFIX.test(header)) {
    const cookieToken = req.cookies?.[config.session.cookieName];
    return cookieToken || null;
  }
  return header.replace(BEARER_PREFIX, '').trim() || null;
};

export const clearSessionCookie = (reply) => {
  if (!reply?.clearCookie) return;
  reply.clearCookie(config.session.cookieName, {
    path: '/',
    domain: config.session.domain
  });
};

export const buildSessionCookieOptions = (ttlSeconds) => ({
  httpOnly: true,
  secure: config.session.secure,
  sameSite: config.session.sameSite,
  domain: config.session.domain,
  path: '/',
  maxAge: ttlSeconds
});

export const requireSessionToken = (req, reply) => {
  const token = extractSessionToken(req);
  if (!token) {
    clearSessionCookie(reply);
    reply.code(401).send({ message: 'Sessão ausente. Faça login novamente.' });
    return null;
  }
  return token;
};
