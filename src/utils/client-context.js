const FALLBACK_USER_AGENT = 'Unknown-Client/1.0';

const normalizeIp = (ip = '') => {
  if (!ip) return '';
  const [firstPart] = ip.split(',');
  const trimmed = firstPart?.trim?.() || '';
  if (!trimmed) return '';
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed.startsWith('::ffff:') ? trimmed.substring(7) : trimmed;
};

export const buildClientContext = ({ ip, userAgent } = {}) => {
  const normalizedIp = normalizeIp(ip);
  const ua = (userAgent || '').substring(0, 300) || FALLBACK_USER_AGENT;
  return {
    ip: normalizedIp,
    userAgent: ua
  };
};

export const extractClientContext = (req = {}) => {
  const headers = req.headers || {};
  const rawIp = headers['x-client-ip']
    || headers['x-real-ip']
    || req.ip
    || req.socket?.remoteAddress
    || '';
  const userAgent = headers['user-agent'] || FALLBACK_USER_AGENT;
  return buildClientContext({ ip: rawIp, userAgent });
};

export const hasSameClientContext = (stored = {}, current = {}) => {
  if (!stored || (!stored.ip && !stored.userAgent)) {
    return true;
  }

  const normalizedCurrent = buildClientContext(current);

  if (stored.ip && normalizedCurrent.ip && stored.ip !== normalizedCurrent.ip) {
    return false;
  }

  if (
    stored.userAgent
    && normalizedCurrent.userAgent
    && stored.userAgent !== normalizedCurrent.userAgent
  ) {
    return false;
  }

  return true;
};
