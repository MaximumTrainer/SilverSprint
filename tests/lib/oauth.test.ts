import { describe, it, expect } from 'vitest';
import { _buildRedirectUri } from '../../src/lib/oauth';

/**
 * Tests for the pure URL-building logic that powers getOAuthRedirectUri().
 *
 * getOAuthRedirectUri() now delegates to _buildRedirectUri('./callback', href)
 * so the returned redirect URI always points to the dedicated /callback path.
 * These tests verify both the original root-resolution behaviour (preserved for
 * other callers) and the new callback-path resolution used in production.
 */
describe('_buildRedirectUri', () => {
  // ── existing root-path tests (BASE_URL = './') ───────────────────────────

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

  // ── callback path tests (getOAuthRedirectUri uses './callback') ───────────

  it('appends /callback for a GitHub Pages sub-path deployment', () => {
    const uri = _buildRedirectUri('./callback', 'https://maximumtrainer.github.io/SilverSprint/');
    expect(uri).toBe('https://maximumtrainer.github.io/SilverSprint/callback');
  });

  it('appends /callback at the origin root', () => {
    const uri = _buildRedirectUri('./callback', 'https://example.com/');
    expect(uri).toBe('https://example.com/callback');
  });

  it('strips query params and still returns the clean /callback URI', () => {
    // When the browser is already on the callback path (e.g. after the GitHub
    // Pages 404.html redirect restores the path), getOAuthRedirectUri() must
    // still produce the same clean URI used during the initial auth request.
    const uri = _buildRedirectUri('./callback', 'https://maximumtrainer.github.io/SilverSprint/callback?code=abc&state=xyz');
    expect(uri).toBe('https://maximumtrainer.github.io/SilverSprint/callback');
  });

  it('returns a consistent /callback URI whether called from root or callback path', () => {
    const fromRoot = _buildRedirectUri('./callback', 'https://maximumtrainer.github.io/SilverSprint/');
    const fromCallback = _buildRedirectUri('./callback', 'https://maximumtrainer.github.io/SilverSprint/callback?code=x&state=y');
    expect(fromRoot).toBe(fromCallback);
  });
});
