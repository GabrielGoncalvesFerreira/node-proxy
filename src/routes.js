export function registerRoutes(app, handlers) {
  const {
    handleClientCredentialsToken,
    handleAppCredentials,
    handleErpToken,
    handleAdminLogin,
    handleAdminVerify,
    handleSessionStatus,
    encerrarSessao
  } = handlers;

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/api/v1/auth/token', handleClientCredentialsToken);
  app.post('/api/v1/auth/login', handleAppCredentials);
  app.post('/api/v1/auth/login/code', handleErpToken);

  app.post('/api/admin/auth/login', handleAdminLogin);
  app.post('/api/admin/auth/verify', handleAdminVerify);

  app.get('/bff/session', handleSessionStatus);
  app.post('/bff/logout', encerrarSessao);
  app.post('/api/v1/auth/logout', encerrarSessao);
}
