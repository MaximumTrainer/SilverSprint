import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RETURN_ROUTE_KEY,
  rememberReturnRoute,
  resolveRoute,
  routeUrl,
  takeReturnRoute,
} from '../../src/lib/routing';
import { paceCurveNotice } from '../../src/application/pace-curve-sync';

/**
 * Tests for the pace curve screen's two decisions.
 *
 * There is no DOM test runner in this repo (see `vitest.config.ts`), so what is
 * exercised here is the logic the screen renders *from*, not the markup:
 *
 *  - which screen an athlete lands on after signing in (AC-17), which is the
 *    composition of `rememberReturnRoute` before the OAuth redirect and
 *    `routeUrl(takeReturnRoute(), …)` in `OAuthCallbackPage`;
 *  - what the screen says about a load (AC-19), which is `paceCurveNotice`.
 *
 * Both are pure, and both are places where getting it wrong is silent: a deep
 * link that quietly lands on the dashboard, or an empty chart that means
 * "throttled" but reads "you have not sprinted".
 */

const PAGES = 'https://maximumtrainer.github.io/SilverSprint';
const ROOT = 'https://silversprint.example.com';

function installSessionStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  } as Storage);
  return map;
}

describe('PaceCurveScreen — a deep link while signed out (AC-17)', () => {
  beforeEach(() => { installSessionStorage(); });

  /**
   * What the app does end to end: resolve the requested screen, remember it
   * across the OAuth redirect, then work out where the callback page sends the
   * athlete once the token exchange succeeds.
   */
  function landingAfterLogin(deepLink: string, callbackHref: string): string {
    const requested = resolveRoute(deepLink);
    rememberReturnRoute(requested);          // App.handleOAuthLogin
    return routeUrl(takeReturnRoute(), callbackHref); // OAuthCallbackPage
  }

  it('lands on the pace curve, not the dashboard, on a sub-path deployment', () => {
    const landing = landingAfterLogin(`${PAGES}/pace-curve`, `${PAGES}/callback?code=abc&state=xyz`);
    expect(landing).toBe(`${PAGES}/pace-curve`);
    expect(resolveRoute(landing)).toBe('pace-curve');
  });

  it('lands on the pace curve on a root deployment', () => {
    const landing = landingAfterLogin(`${ROOT}/pace-curve`, `${ROOT}/callback?code=abc&state=xyz`);
    expect(landing).toBe(`${ROOT}/pace-curve`);
  });

  it('lands on the dashboard when that is where sign-in started', () => {
    const landing = landingAfterLogin(`${PAGES}/`, `${PAGES}/callback?code=abc`);
    expect(landing).toBe(`${PAGES}/`);
    expect(resolveRoute(landing)).toBe('dashboard');
  });

  it('drops the authorization code from the URL it lands on', () => {
    // Leaving `?code=` on the address bar would put a spent credential in the
    // athlete's history and in any link they copy from it.
    const landing = landingAfterLogin(`${PAGES}/pace-curve`, `${PAGES}/callback?code=secret&state=xyz`);
    expect(landing).not.toContain('code=');
    expect(landing).not.toContain('secret');
  });

  it('does not send a second sign-in back to the pace curve', () => {
    landingAfterLogin(`${PAGES}/pace-curve`, `${PAGES}/callback?code=abc`);
    // The remembered route is consumed, so signing in again from the dashboard
    // stays on the dashboard.
    expect(routeUrl(takeReturnRoute(), `${PAGES}/callback?code=def`)).toBe(`${PAGES}/`);
  });

  it('ignores an off-site destination written into the slot', () => {
    sessionStorage.setItem(RETURN_ROUTE_KEY, 'https://evil.example.com/steal');
    expect(routeUrl(takeReturnRoute(), `${PAGES}/callback?code=abc`)).toBe(`${PAGES}/`);
  });

  it('lands on the dashboard when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined);
    const landing = landingAfterLogin(`${PAGES}/pace-curve`, `${PAGES}/callback?code=abc`);
    expect(landing).toBe(`${PAGES}/`);
  });
});

describe('PaceCurveScreen — what it says about a load (AC-19)', () => {
  /**
   * The screen shows the notice for the transport states and lets the panel
   * speak for a completed load, so `measuredPoints: 1` is what it passes: it is
   * not the screen's job to decide whether a *complete* curve is empty.
   */
  function screenNotice(input: Parameters<typeof paceCurveNotice>[0]) {
    return paceCurveNotice({ ...input, measuredPoints: 1 });
  }

  it('shows a loading state distinct from the empty state (FR-10)', () => {
    const loading = screenNotice({ status: 'loading' });
    const empty = paceCurveNotice({
      status: 'ready',
      coverage: { eligible: 40, requested: 40, fetched: 40 },
      measuredPoints: 0,
    });

    expect(loading.kind).toBe('loading');
    expect(empty.kind).toBe('empty');
    expect(loading.message).not.toBe(empty.message);
    // A slow fetch must never read as "no sprint efforts found".
    expect(loading.message.toLowerCase()).not.toContain('no sprint');
  });

  it('names rate limiting as the cause and offers a retry, with coverage intact', () => {
    const notice = screenNotice({
      status: 'ready',
      rateLimited: true,
      coverage: { eligible: 118, requested: 40, fetched: 12 },
    });

    expect(notice.kind).toBe('rate-limited');
    expect(notice.message).toContain('rate-limited');
    expect(notice.message).toContain('12 of 40');
    expect(notice.retryable).toBe(true);
  });

  it('states a failed load rather than showing a silently short curve (FR-13)', () => {
    const notice = screenNotice({ status: 'error', errorMessage: 'Failed to fetch' });
    expect(notice.kind).toBe('error');
    expect(notice.message).toContain('Failed to fetch');
    expect(notice.retryable).toBe(true);
  });

  it('says nothing over a complete load, leaving the panel to speak', () => {
    const notice = screenNotice({
      status: 'ready',
      coverage: { eligible: 17, requested: 17, fetched: 17 },
    });
    expect(notice.kind).toBe('none');
    expect(notice.message).toBe('');
  });

  it('is silent in demo mode, where there is no coverage to report', () => {
    // The mock streams are all present by construction, so the screen must not
    // invent a warning about them.
    expect(screenNotice({ status: 'ready' }).kind).toBe('none');
  });
});
