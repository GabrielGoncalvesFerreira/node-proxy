const AUDITABLE_HEADERS = [
  'X-Client-Version',
  'X-Real-IP',
  'X-Client-IP',
  'X-BFF-IP',
  'X-Forwarded-For',
  'User-Agent'
];

const toLower = (value = '') => value.toLowerCase();

export function extractAuditHeaders(req) {
  const headers = {};
  for (const headerName of AUDITABLE_HEADERS) {
    const lower = toLower(headerName);
    const value =
      req.headers[lower] ||
      req.headers[headerName] ||
      req.headers[headerName.toLowerCase()];
    if (value) {
      headers[headerName] = value;
    }
  }
  return headers;
}
