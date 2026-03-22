import { describe, it, expect, vi, afterEach } from 'vitest';
import { _buildRedirectUri, getOAuthRedirectUri } from '../../src/lib/oauth';

/**
 * Tests for the pure URL-building logic that powers getOAuthRedirectUri().
 *
 * getOAuthRedirectUri() delegates to _buildRedirectUri(BASE_URL, href) so
 * these tests fully cover the fix: resolving the Vite base path against the
 * full page href (not just the origin) so sub-path deployments like GitHub
 * Pages produce the correct redirect URI.
 */
describe('_buildRedirectUri', () => {
  it('returns the sub-path root URL for a GitHub Pages deployment', () => {
    // BASE_URL = './' (vite base: './'), href = full GitHub Pages URL
    const uri = _buildRedirectUri('./', 'https://maximumtrainer.github.io/SilverSprint/');
    expect(uri).toBe('https://maximumtrainer.github.io/SilverSprint/');
  });

  it('strips query parameters present during an OAuth callback', () => {
    // After Intervals.icu redirects back with ?code=…&state=…, the redirect
    // URI sent to the token endpoint must be the same clean path used during
    // the initial authorization request.
    const uri = _buildRedirectUri('./', 'https://maximumtrainer.github.io/SilverSprint/?code=abc123&state=xyz');
    expect(uri).toBe('https://maximumtrainer.github.io/SilverSprint/');
  });

  it('works correctly at the origin root (no sub-path)', () => {
    const uri = _buildRedirectUri('./', 'https://example.com/');
    expect(uri).toBe('https://example.com/');
  });

  it('returns a consistent URI for both initiation and callback calls', () => {
    const initiationUri = _buildRedirectUri('./', 'https://maximumtrainer.github.io/SilverSprint/');
    const callbackUri = _buildRedirectUri('./', 'https://maximumtrainer.github.io/SilverSprint/?code=abc&state=def');
    expect(initiationUri).toBe(callbackUri);
  });

  it('would produce the wrong URI if the origin were used instead of href (regression guard)', () => {
    // This documents exactly the bug that was fixed: resolving './' against
    // just the origin drops the '/SilverSprint/' sub-path.
    const wrongUri = _buildRedirectUri('./', 'https://maximumtrainer.github.io');
    expect(wrongUri).toBe('https://maximumtrainer.github.io/');
    expect(wrongUri).not.toBe('https://maximumtrainer.github.io/SilverSprint/');
  });
});

/**
 * Tests for the VITE_OAUTH_REDIRECT_URI explicit override in getOAuthRedirectUri().
 *
 * When VITE_OAUTH_REDIRECT_URI is set, getOAuthRedirectUri() must return it
 * verbatim so that the URI sent to intervals.icu exactly matches the URI
 * registered for client_id 264 — even on deployments (Vercel, local dev,
 * custom domains) where the dynamically-resolved URI would differ.
 */
describe('getOAuthRedirectUri with VITE_OAUTH_REDIRECT_URI override', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the explicit override when VITE_OAUTH_REDIRECT_URI is set', () => {
    vi.stubEnv('VITE_OAUTH_REDIRECT_URI', 'https://maximumtrainer.github.io/SilverSprint/');
    const uri = getOAuthRedirectUri();
    expect(uri).toBe('https://maximumtrainer.github.io/SilverSprint/');
  });

  it('returns override verbatim without trailing-slash normalisation', () => {
    vi.stubEnv('VITE_OAUTH_REDIRECT_URI', 'https://example.com/oauth/callback');
    const uri = getOAuthRedirectUri();
    expect(uri).toBe('https://example.com/oauth/callback');
  });

  it('prefers the override over the dynamically-built URI', () => {
    // Even if window.location.href would produce a different URI, the explicit
    // override must win — ensuring an exact match with the registered URI.
    vi.stubEnv('VITE_OAUTH_REDIRECT_URI', 'https://maximumtrainer.github.io/SilverSprint/');
    const uri = getOAuthRedirectUri();
    expect(uri).not.toBe('http://localhost/'); // dynamic would give localhost in tests
    expect(uri).toBe('https://maximumtrainer.github.io/SilverSprint/');
  });
});
