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

/** sessionStorage key for the OAuth CSRF state token. */
const OAUTH_STATE_KEY = 'ss_oauth_state';

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

  // Generate a cryptographically-random state token for CSRF protection.
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64UrlEncode(stateBytes);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
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
 * access token.  Retrieves the PKCE verifier and validates the `state` from
 * sessionStorage to guard against CSRF/login injection attacks.
 *
 * @param code - The authorization code from the `?code=` query parameter.
 * @param returnedState - The `?state=` value from the redirect URL; must match
 *   the value stored in sessionStorage by {@link initiateOAuthFlow}.
 * @param redirectUri - Must exactly match the redirect URI used in the initial request.
 * @returns Resolved `AuthCredentials` ready to be stored and used for API calls.
 * @throws If state validation fails, token exchange fails, or athlete ID is missing.
 */
export async function handleOAuthCallback(code: string, returnedState: string | null, redirectUri: string): Promise<AuthCredentials> {
  const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);

  // Always clear the stored verifier and state immediately, whether we succeed
  // or fail, so they cannot be replayed by a subsequent request.
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!codeVerifier) {
    throw new Error('PKCE code verifier not found in session. The OAuth flow may have been interrupted.');
  }

  if (!expectedState || returnedState !== expectedState) {
    throw new Error('OAuth state mismatch — possible CSRF attack. Please try signing in again.');
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

  return { athleteId, accessToken: data.access_token, authType: 'bearer' };
}

/**
 * Build the OAuth redirect URI from the app's Vite base path and the current
 * page URL.
 *
 * Resolving a relative `base` (e.g. `./`) against the full `href` (rather than
 * just the origin) correctly handles sub-path deployments like GitHub Pages.
 * Any query-string parameters in `href` (e.g. `?code=…` during an OAuth
 * callback) are stripped automatically by the relative URL resolution so the
 * returned URI is always the same clean path.
 *
 * @internal Exported for unit testing only — prefer {@link getOAuthRedirectUri}
 *   in application code.
 */
export function _buildRedirectUri(base: string, href: string): string {
  return new URL(base, href).toString();
}

/**
 * Return the redirect URI for the current deployment, including the app base
 * path so it works both at the origin root and from sub-paths like GitHub Pages
 * (e.g. https://maximumtrainer.github.io/SilverSprint/).
 */
export function getOAuthRedirectUri(): string {
  return _buildRedirectUri(import.meta.env.BASE_URL ?? '/', window.location.href);
}
