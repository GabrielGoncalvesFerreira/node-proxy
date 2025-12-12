import { authController } from './controllers/auth.controller.js';
import { sessionController } from './controllers/session.controller.js';
import { ssoController } from './controllers/sso.controller.js';
import { config } from './config/env.js';

export async function registerRoutes(app) {
  // Health Check
  app.get('/health', async () => ({ status: 'ok', service: 'bff-proxy' }));

  // --- Rotas de Autenticação (BFF) ---

  // Fluxo App (Usuário ERP com MFA)
  app.post(config.url.loginUrl, authController.loginAppStep1.bind(authController));
  app.post(config.url.loginCodeUrl, authController.loginAppStep2.bind(authController));

  // --- Gestão de Sessão ---
  app.get('/bff/session', sessionController.getSessionStatus.bind(sessionController));
  app.post('/bff/refresh', sessionController.refresh.bind(sessionController));

  // Logout (aceita tanto na rota BFF quanto na rota legada mapeada)
  app.post('/bff/logout', sessionController.logout.bind(sessionController));
  app.post(config.url.logoutUrl, sessionController.logout.bind(sessionController));

  // --- ROTAS EXCLUSIVAS DO SSO ---

  // 1. Gerar Ticket (Privado: Precisa de sessão SSO)
  app.post('/api/v1/auth/sso/ticket', ssoController.generateTicket.bind(ssoController));

  // 2. Validar Ticket (Público: BFF Cotação chama)
  app.post('/api/v1/auth/sso/validate', ssoController.validateTicket.bind(ssoController));
}
