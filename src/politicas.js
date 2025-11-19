// Define as políticas por rota.
// - passthrough: repassa sem Authorization
// - token_basic_proxy: injeta Authorization Basic interno para /auth/token
// - sessao_usuario: injeta JWT salvo em cookie/Redis (login ERP)
// - oauth_client_credentials: injeta Bearer token de aplicação (client_credentials)

const AUDIENCIA_PADRAO = 'laravel-api';
const ESCOPOS_SISTEMA = ['erp.read', 'erp.write'];

export function escolherPolitica(url, metodo) {
  const path = url.split('?')[0];

  // Saúde do proxy e rotas públicas
  if (path === '/health' || path.startsWith('/v1/public/')) {
    return { tipo: 'passthrough' };
  }

  if (metodo === 'POST' && path === '/api/v1/auth/token') {
    return { tipo: 'token_basic_proxy' };
  }

  // Exemplo: rotas de integração interna com token de aplicação
  if (path.startsWith('/v1/system/')) {
    return {
      tipo: 'oauth_client_credentials',
      audiencia: AUDIENCIA_PADRAO,
      escopos: ESCOPOS_SISTEMA,
      resolverTenant: (req) => req.headers['x-tenant-id'] || 'default'
    };
  }

  // Demais rotas exigem sessão ERP (JWT do usuário)
  return { tipo: 'sessao_usuario' };
}
