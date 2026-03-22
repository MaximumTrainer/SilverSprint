/**
 * Server-side OAuth token exchange proxy.
 *
 * Exchanges an Intervals.icu authorization code for an access token using the
 * confidential client secret stored as a server-side environment variable
 * (OAUTH_CLIENT_SECRET). This keeps the secret out of the browser bundle.
 *
 * Endpoint: POST /api/oauth/token
 * Body (JSON or form-encoded): { code, redirect_uri, code_verifier? }
 *
 * CORS: allowed origin is controlled by OAUTH_ALLOWED_ORIGIN env var
 * (e.g. "https://maximumtrainer.github.io" for the GitHub Pages deployment).
 */

const INTERVALS_TOKEN_URL = 'https://intervals.icu/api/oauth/token';
const OAUTH_CLIENT_ID = '264';

interface ServerlessRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface ServerlessResponse {
  status(code: number): ServerlessResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
  end(): void;
}

function setCorsHeaders(req: ServerlessRequest, res: ServerlessResponse): void {
  const allowedOrigin = (process.env.OAUTH_ALLOWED_ORIGIN ?? '').trim();
  const requestOrigin = (
    Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  ) ?? '';

  // Allow the configured origin, or any origin if OAUTH_ALLOWED_ORIGIN is '*'.
  if (allowedOrigin === '*' || (allowedOrigin && requestOrigin === allowedOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin || allowedOrigin);
  } else if (!allowedOrigin) {
    // No restriction configured — allow any origin (e.g. local dev).
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  setCorsHeaders(req, res);

  // Handle CORS preflight.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const clientSecret = (process.env.OAUTH_CLIENT_SECRET ?? '').trim();
  if (!clientSecret) {
    res.status(500).json({ error: 'OAuth client secret is not configured on the server.' });
    return;
  }

  // Accept both JSON and form-encoded bodies.
  let code: string | undefined;
  let redirectUri: string | undefined;
  let codeVerifier: string | undefined;

  const body = req.body as Record<string, string> | null;
  if (body && typeof body === 'object') {
    code = body.code;
    redirectUri = body.redirect_uri;
    codeVerifier = body.code_verifier;
  }

  if (!code || !redirectUri) {
    res.status(400).json({ error: 'Missing required fields: code, redirect_uri' });
    return;
  }

  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: OAUTH_CLIENT_ID,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }

  const upstreamRes = await fetch(INTERVALS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const responseBody = await upstreamRes.text();
  res.status(upstreamRes.status).json(
    upstreamRes.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(responseBody)
      : { raw: responseBody }
  );
}
