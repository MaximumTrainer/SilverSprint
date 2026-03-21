import { describe, it, expect } from 'vitest';
import { _buildRedirectUri } from '../../src/lib/oauth';

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
