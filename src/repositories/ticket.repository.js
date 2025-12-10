import pool from '../infra/pg-client.js';

export async function createTicketPG(ticket, token, ip, email, ttlSeconds) {
  const expiresAt = new Date(Date.now() + (ttlSeconds || 30) * 1000);
  await pool.query(
    `INSERT INTO sso_tickets(ticket, token, ip, email, expires_at) VALUES($1,$2,$3,$4,$5)`,
    [ticket, token, ip, email, expiresAt]
  );
}

export async function getTicketForUpdate(ticket) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT token, ip, email, expires_at, used FROM sso_tickets WHERE ticket=$1 FOR UPDATE`,
      [ticket]
    );
    return { client, row: res.rows[0] };
  } catch (err) {
    client.release();
    throw err;
  }
}

export async function markTicketUsed(client, ticket) {
  await client.query('UPDATE sso_tickets SET used = true WHERE ticket = $1', [ticket]);
  await client.query('COMMIT');
  client.release();
}

export async function insertAudit(event) {
  await pool.query(
    'INSERT INTO sso_ticket_audit(ticket, event_type, payload) VALUES($1,$2,$3)',
    [event.ticket || null, event.type, event.payload || {}]
  );
}
