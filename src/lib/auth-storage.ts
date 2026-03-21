/**
 * auth-storage — encrypted credential persistence using the Web Crypto API.
 *
 * Credentials are encrypted with AES-GCM-256 (key derived via PBKDF2) and
 * stored in a browser cookie so they survive across browser sessions.
 *
 * Security note: the encryption key is derived from a fixed passphrase
 * embedded in source code, so this provides obfuscation against casual
 * inspection rather than protection against a determined attacker with access
 * to the source.  The cookie is SameSite=Strict to mitigate CSRF and is
 * marked Secure when served over HTTPS.
 */

export interface AuthCredentials {
  athleteId: string;
  /** OAuth Bearer token (when authType is 'bearer') or Intervals.icu API key (when authType is 'basic'). */
  accessToken: string;
  /** Authentication method to use for Intervals.icu API calls. Defaults to 'basic'. */
  authType: 'basic' | 'bearer';
}

/**
 * Build the appropriate HTTP `Authorization` header value for Intervals.icu API calls.
 * Uses Bearer for OAuth tokens, or the legacy `Basic API_KEY:<key>` scheme for API keys.
 */
export function buildAuthorizationHeader(credentials: AuthCredentials): string {
  if (credentials.authType === 'bearer') {
    return `Bearer ${credentials.accessToken}`;
  }
  return `Basic ${btoa(`API_KEY:${credentials.accessToken}`)}`;
}

const COOKIE_NAME = 'ss_auth';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** @internal Exported for tests only — do not rely on these values in application code. */
export const _TEST_PBKDF2_PASSPHRASE = 'SilverSprint-v1';
/** @internal Exported for tests only — do not rely on these values in application code. */
export const _TEST_PBKDF2_SALT = 'SilverSprintSalt-2024';

const PBKDF2_PASSPHRASE = _TEST_PBKDF2_PASSPHRASE;
const PBKDF2_SALT = _TEST_PBKDF2_SALT;
const PBKDF2_ITERATIONS = 100_000;
const AES_IV_BYTES = 12;

/** Derive a stable AES-GCM-256 key from the fixed app passphrase via PBKDF2. */
async function deriveKey(): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PBKDF2_PASSPHRASE),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt credentials and return a base64-encoded string containing
 * a random 12-byte IV prepended to the AES-GCM ciphertext.
 */
export async function encryptCredentials(credentials: AuthCredentials): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Build base64 in chunks to avoid stack overflow on large inputs.
  let binary = '';
  const CHUNK = 1024;
  for (let i = 0; i < combined.length; i += CHUNK) {
    binary += String.fromCharCode(...combined.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decrypt a base64-encoded string produced by {@link encryptCredentials}.
 * Returns `null` if decryption or parsing fails.
 */
export async function decryptCredentials(encrypted: string): Promise<AuthCredentials | null> {
  try {
    const key = await deriveKey();
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, AES_IV_BYTES);
    const ciphertext = combined.slice(AES_IV_BYTES);

    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'athleteId' in parsed &&
      'accessToken' in parsed &&
      typeof (parsed as { athleteId: unknown }).athleteId === 'string' &&
      typeof (parsed as { accessToken: unknown }).accessToken === 'string'
    ) {
      const raw = parsed as { athleteId: string; accessToken: string; authType?: unknown };
      const authType: 'basic' | 'bearer' = raw.authType === 'bearer' ? 'bearer' : 'basic';
      return { athleteId: raw.athleteId, accessToken: raw.accessToken, authType };
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the encrypted value to the persistent auth cookie. */
export function saveAuthCookie(encrypted: string): void {
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(encrypted)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Strict; Path=/${secure}`;
}

/** Read the raw encrypted value from the auth cookie, or `null` if absent. */
export function loadAuthCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Remove the auth cookie immediately. */
export function clearAuthCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; SameSite=Strict; Path=/`;
}

/** Encrypt credentials and persist them in the auth cookie. */
export async function persistLogin(credentials: AuthCredentials): Promise<void> {
  const encrypted = await encryptCredentials(credentials);
  saveAuthCookie(encrypted);
}

/**
 * Load and decrypt persisted credentials from the auth cookie.
 * Returns `null` if no valid cookie exists or decryption fails.
 */
export async function loadPersistedLogin(): Promise<AuthCredentials | null> {
  const raw = loadAuthCookie();
  if (!raw) return null;
  return decryptCredentials(raw);
}
