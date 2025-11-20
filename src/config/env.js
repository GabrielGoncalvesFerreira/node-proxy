import dotenv from 'dotenv';
// Carrega variáveis do .env se estiver local
dotenv.config();

// Remove barra no final da URL para evitar duplicações (ex: //api)
const sanitizeUrl = (url) => (url ? url.replace(/\/$/, '') : '');

const API_BASE = sanitizeUrl(process.env.API_BASE);

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
  api: {
    baseUrl: API_BASE,
    endpoints: {
      // Fluxo App (Usuário ERP)
      appLogin: `${API_BASE}/api/v1/auth/login`,       // Passo 1: User + Pass
      appCode: `${API_BASE}/api/v1/auth/login/code`,   // Passo 2: Challenge ID + Code (MFA)
      
      // Fluxo Admin
      adminLogin: `${API_BASE}/api/admin/auth/login`,  // Passo 1: Email
      adminCode: `${API_BASE}/api/admin/auth/verify`,  // Passo 2: Email + Code

      // Fluxos de Token
      clientToken: `${API_BASE}/api/v1/auth/token`,    // Client Credentials
      erpToken: `${API_BASE}/api/v1/auth/token/erp`,   // Legado/Direto
    },
    timeout: 8000,
  },
  security: {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    // Helper para gerar o header Basic Auth automaticamente
    get basicAuthHeader() {
      const credentials = `${this.clientId}:${this.clientSecret}`;
      return Buffer.from(credentials, 'utf8').toString('base64');
    },
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'cv_session',
    domain: process.env.SESSION_COOKIE_DOMAIN,
    secure: process.env.SESSION_COOKIE_SECURE !== 'false', // Padrão true
    sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax',
    ttlSeconds: Number(process.env.SESSION_TTL_SECONDS) || 86400, // 24h
  },
};