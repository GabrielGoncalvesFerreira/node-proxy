import { authController } from './controllers/auth.controller.js';
import { sessionController } from './controllers/session.controller.js';

export async function registerRoutes(app) {
  // Health Check
  app.get('/health', async () => ({ status: 'ok', service: 'bff-proxy' }));

  // --- Rotas de Autenticação (BFF) ---

  // Fluxo App (Usuário ERP com MFA)
  app.post('/api/v1/auth/login', authController.loginAppStep1.bind(authController));
  app.post('/api/v1/auth/login/code', authController.loginAppStep2.bind(authController));

  // Fluxo Admin
  app.post('/api/admin/auth/login', authController.loginAdminStep1.bind(authController));
  app.post('/api/admin/auth/verify', authController.loginAdminStep2.bind(authController));

  // Fluxo Client Credentials (Opcional: gera cookie se header x-bff-session existir)
  app.post('/api/v1/auth/token', authController.getClientToken.bind(authController));

  // --- Gestão de Sessão ---

  app.get('/bff/session', sessionController.getSessionStatus.bind(sessionController));

  // Logout (aceita tanto na rota BFF quanto na rota legada mapeada)
  app.post('/bff/logout', sessionController.logout.bind(sessionController));
  app.post('/api/v1/auth/logout', sessionController.logout.bind(sessionController));

  // --- ROTAS EXCLUSIVAS DO SSO ---

  // 1. Gerar Ticket (Privado: Precisa de sessão SSO)
  app.post('/api/v1/auth/sso/ticket', authController.generateTicket.bind(authController));

  // 2. Validar Ticket (Público: BFF Cotação chama)
  app.post('/api/v1/auth/sso/validate', authController.validateTicket.bind(authController));
}