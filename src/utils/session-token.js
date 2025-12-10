const BEARER_PREFIX = /^Bearer\s+/i;

export const extractSessionToken = (req = {}) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !BEARER_PREFIX.test(header)) {
    return null;
  }
  return header.replace(BEARER_PREFIX, '').trim() || null;
};

export const requireSessionToken = (req, reply) => {
  const token = extractSessionToken(req);
  if (!token) {
    reply.code(401).send({ message: 'Sessão ausente. Informe Authorization: Bearer <token>.' });
    return null;
  }
  return token;
};
