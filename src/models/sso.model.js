// Helper simples para mapear rows do banco para objeto SSO
export function mapTicketRow(row) {
  if (!row) return null;
  return {
    ticket: row.ticket,
    token: row.token,
    email: row.email,
    ip: row.ip,
    used: row.used === true,
    createdAt: row.created_at || row.createdAt,
    expiresAt: row.expires_at || row.expiresAt
  };
}
