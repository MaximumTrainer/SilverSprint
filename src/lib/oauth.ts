/**
 * oauth — Intervals.icu OAuth 2.0 Authorization Code Flow with PKCE.
 *
 * Reference: https://forum.intervals.icu/t/intervals-icu-oauth-support/2759
 *
 * Flow:
 * 1. `initiateOAuthFlow()` — generate PKCE verifier/challenge, store verifier in
 *    sessionStorage, then redirect the browser to the Intervals.icu authorization URL.
 * 2. Intervals.icu redirects back to the app with `?code=<authorization_code>`.
 * 3. `handleOAuthCallback(code)` — exchange the code for an access_token and extract
 *    the athlete ID from the token response.
 */

import type { AuthCredentials } from './auth-storage';

const OAUTH_CLIENT_ID = '264';
const OAUTH_AUTHORIZE_URL = 'https://intervals.icu/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://intervals.icu/api/oauth/token';
const OAUTH_SCOPES = 'ACTIVITY:READ,WELLNESS:READ,SETTINGS:READ';

/** sessionStorage key for the PKCE code verifier. */
const PKCE_VERIFIER_KEY = 'ss_pkce_verifier';

/** Base64url-encode a Uint8Array (no padding, URL-safe characters). */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generate a cryptographically-random PKCE code verifier (43–128 characters). */
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Derive the PKCE code challenge (SHA-256 of the verifier, base64url-encoded). */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Begin the OAuth 2.0 Authorization Code + PKCE flow.
 * Stores the PKCE verifier in sessionStorage and redirects the browser to
 * the Intervals.icu authorization page.
 *
 * @param redirectUri - The URI Intervals.icu will redirect back to (must match
 *   the registered redirect URI for client_id 264).
 */
export async function initiateOAuthFlow(redirectUri: string): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  athlete?: { id: string };
}

/**
 * Exchange an authorization `code` (received via the OAuth redirect) for an
 * access token.  Retrieves the PKCE verifier from sessionStorage.
 *
 * @param code - The authorization code from the `?code=` query parameter.
 * @param redirectUri - Must exactly match the redirect URI used in the initial request.
 * @returns Resolved `AuthCredentials` ready to be stored and used for API calls.
 * @throws If the token exchange fails or the response is missing required fields.
 */
export async function handleOAuthCallback(code: string, redirectUri: string): Promise<AuthCredentials> {
  const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    throw new Error('PKCE code verifier not found in session. The OAuth flow may have been interrupted.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token exchange failed (HTTP ${response.status}): ${text}`);
  }

  const data: OAuthTokenResponse = await response.json();

  if (!data.access_token) {
    throw new Error('OAuth token response missing access_token');
  }

  // The athlete ID is provided by the token endpoint; fall back to fetching
  // the profile when the token response does not include it.
  let athleteId = data.athlete?.id ?? '';
  if (!athleteId) {
    const profileRes = await fetch('https://intervals.icu/api/v1/athlete/self', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (profileRes.ok) {
      const profile: { id?: string } = await profileRes.json();
      athleteId = profile.id ?? '';
    } else {
      const profileText = await profileRes.text().catch(() => '');
      throw new Error(`Failed to resolve athlete ID from profile (HTTP ${profileRes.status}): ${profileText}`);
    }
  }

  if (!athleteId) {
    throw new Error('Could not determine athlete ID from OAuth token response');
  }

  // Clean up the verifier now that the exchange is complete.
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  return { athleteId, accessToken: data.access_token, authType: 'bearer' };
}

/** Return the redirect URI for the current origin (root path). */
export function getOAuthRedirectUri(): string {
  return `${window.location.origin}/`;
}
