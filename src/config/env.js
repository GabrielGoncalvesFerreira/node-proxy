import dotenv from 'dotenv';
// Carrega variáveis do .env se estiver local
dotenv.config();

// Remove barra no final da URL para evitar duplicações (ex: //api)
const sanitizeUrl = (url) => (url ? url.replace(/\/$/, '') : '');

const parseRequiredList = (value, envName) => {
  if (!value) {
    throw new Error(`Env obrigatória: ${envName}`);
  }
  return value
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
};

const API_BASE = sanitizeUrl(process.env.API_BASE);
const LOGIN_URL = sanitizeUrl(process.env.LOGIN_URL);
const LOGIN_CODE_URL = sanitizeUrl(process.env.LOGIN_CODE_URL);
const LOGOUT_URL = sanitizeUrl(process.env.LOGOUT_URL);

// Fail-fast: Se não tiver as configs básicas, nem sobe a aplicação
if (!API_BASE) {
  throw new Error('FATAL: A variável de ambiente API_BASE é obrigatória.');
}

if (!process.env.OAUTH_CLIENT_ID || !process.env.OAUTH_CLIENT_SECRET) {
  throw new Error('FATAL: Credenciais OAUTH_CLIENT_ID e OAUTH_CLIENT_SECRET são obrigatórias.');
}

export const config = {
  app: {
    port: process.env.PORT || 5180,
    isDev: process.env.NODE_ENV === 'development',
  },
   url: {
    loginUrl: LOGIN_URL,
    loginCodeUrl: LOGIN_CODE_URL,
    logoutUrl: LOGOUT_URL,
  },
  api: {
    baseUrl: API_BASE,
    endpoints: {
      // Fluxo App (Usuário ERP)
      appLogin: `${API_BASE}${LOGIN_URL}`,      
      appCode: `${API_BASE}${LOGIN_CODE_URL}`,   
    },
    timeout: 8000,
  },
  cors: {
    allowedOrigins: parseRequiredList(process.env.CORS_ALLOWED_ORIGINS),
  },
  proxy: {
    trustProxy: parseRequiredList(process.env.TRUST_PROXY),
  },
  security: {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    csrfCookieName: process.env.CSRF_COOKIE_NAME || 'cv_csrf',
    // Helper para gerar o header Basic Auth automaticamente
    get basicAuthHeader() {
      const credentials = `${this.clientId}:${this.clientSecret}`;
      return Buffer.from(credentials, 'utf8').toString('base64');
    },
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  databaseUrl: process.env.DATABASE_URL || null,
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'cv_session',
    domain: process.env.SESSION_COOKIE_DOMAIN,
    secure: process.env.SESSION_COOKIE_SECURE !== 'false', // Padrão true
    sameSite: process.env.SESSION_COOKIE_SAMESITE || 'strict',
    ttlSeconds: Number(process.env.SESSION_TTL_SECONDS) || 86400, // 24h
    refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'cv_refresh',
    refreshTtlSeconds: Number(process.env.REFRESH_TTL_SECONDS) || 604800, // 7 dias
  },
};
