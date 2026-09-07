import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  APP_ROUTES,
  PACE_CURVE_SEGMENT,
  RETURN_ROUTE_KEY,
  appBaseUrl,
  rememberReturnRoute,
  resolveRoute,
  routeUrl,
  takeReturnRoute,
} from '../../src/lib/routing';

/**
 * Base-relative routing.
 *
 * The app is served from two roots that must both work without a router
 * dependency: the Vercel deployment at `/`, and the GitHub Pages deployment
 * under `/SilverSprint/` (built with `--base <repo>/`). A deep link to
 * `/pace-curve` has to resolve on both, including through the
 * `404.html` → `ss_redirect` → `history.replaceState` path, which restores the
 * original pathname before React mounts.
 */

const ROOT = 'https://silversprint.example.com';
const PAGES = 'https://maximumtrainer.github.io/SilverSprint';

describe('routing — resolveRoute (AC-16)', () => {
  it('resolves the dashboard at a root deployment', () => {
    expect(resolveRoute(`${ROOT}/`)).toBe('dashboard');
    expect(resolveRoute(`${ROOT}/index.html`)).toBe('dashboard');
  });

  it('resolves the dashboard at a sub-path deployment', () => {
    expect(resolveRoute(`${PAGES}/`)).toBe('dashboard');
    expect(resolveRoute(`${PAGES}/index.html`)).toBe('dashboard');
  });

  it('resolves a direct /pace-curve deep link on both deployments', () => {
    expect(resolveRoute(`${ROOT}/pace-curve`)).toBe('pace-curve');
    expect(resolveRoute(`${PAGES}/pace-curve`)).toBe('pace-curve');
  });

  it('tolerates a trailing slash and a query string on the deep link', () => {
    expect(resolveRoute(`${ROOT}/pace-curve/`)).toBe('pace-curve');
    expect(resolveRoute(`${PAGES}/pace-curve/?from=email`)).toBe('pace-curve');
    expect(resolveRoute(`${PAGES}/pace-curve#top`)).toBe('pace-curve');
  });

  it('still resolves the OAuth callback path it was factored out of', () => {
    expect(resolveRoute(`${ROOT}/callback?code=abc&state=xyz`)).toBe('callback');
    expect(resolveRoute(`${PAGES}/callback?code=abc&state=xyz`)).toBe('callback');
  });

  it('treats an unknown segment as the dashboard rather than throwing', () => {
    expect(resolveRoute(`${ROOT}/nope`)).toBe('dashboard');
    // The repo name itself is a segment on the Pages host and must not be
    // mistaken for a route.
    expect(resolveRoute(`${PAGES}`)).toBe('dashboard');
  });

  it('enumerates exactly the routes the app renders', () => {
    expect([...APP_ROUTES].sort()).toEqual(['callback', 'dashboard', 'pace-curve']);
  });
});

describe('routing — routeUrl', () => {
  it('builds the pace-curve URL under the deployment base, not the origin', () => {
    expect(routeUrl('pace-curve', `${PAGES}/`)).toBe(`${PAGES}/${PACE_CURVE_SEGMENT}`);
    expect(routeUrl('pace-curve', `${ROOT}/`)).toBe(`${ROOT}/${PACE_CURVE_SEGMENT}`);
  });

  it('returns to the deployment base from the pace-curve screen', () => {
    expect(routeUrl('dashboard', `${PAGES}/pace-curve`)).toBe(`${PAGES}/`);
    expect(routeUrl('dashboard', `${ROOT}/pace-curve`)).toBe(`${ROOT}/`);
  });

  it('round-trips: every route resolves back to itself from both bases', () => {
    for (const base of [`${ROOT}/`, `${PAGES}/`]) {
      for (const route of APP_ROUTES) {
        expect(resolveRoute(routeUrl(route, base))).toBe(route);
      }
    }
  });

  it('drops a query string when moving between screens', () => {
    // Otherwise an OAuth `?code=` would be carried onto the dashboard URL.
    expect(routeUrl('dashboard', `${PAGES}/callback?code=abc`)).toBe(`${PAGES}/`);
  });

  it('agrees with the relative-URL discipline oauth.ts already uses', () => {
    for (const href of [`${ROOT}/`, `${PAGES}/`, `${PAGES}/pace-curve`]) {
      expect(routeUrl('callback', href)).toBe(new URL('./callback', href).toString());
    }
  });
});

describe('routing — appBaseUrl', () => {
  it('is the deployment root, whatever screen is showing', () => {
    expect(appBaseUrl(`${PAGES}/pace-curve`)).toBe(`${PAGES}/`);
    expect(appBaseUrl(`${PAGES}/callback?code=abc`)).toBe(`${PAGES}/`);
    expect(appBaseUrl(`${ROOT}/pace-curve`)).toBe(`${ROOT}/`);
  });
});

describe('routing — the route to return to after signing in (AC-17)', () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      get length() { return map.size; },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
    } as Storage);
  });

  it('defaults to the dashboard when nothing was remembered', () => {
    expect(takeReturnRoute()).toBe('dashboard');
  });

  it('remembers the pace curve across the OAuth round trip', () => {
    rememberReturnRoute('pace-curve');
    expect(sessionStorage.getItem(RETURN_ROUTE_KEY)).toBe('pace-curve');
    expect(takeReturnRoute()).toBe('pace-curve');
  });

  it('consumes the remembered route so a later sign-in lands on the dashboard', () => {
    rememberReturnRoute('pace-curve');
    expect(takeReturnRoute()).toBe('pace-curve');
    expect(takeReturnRoute()).toBe('dashboard');
  });

  it('never returns to the callback screen itself', () => {
    rememberReturnRoute('callback');
    expect(takeReturnRoute()).toBe('dashboard');
  });

  it('ignores a value another script wrote into the slot', () => {
    sessionStorage.setItem(RETURN_ROUTE_KEY, 'https://evil.example.com/');
    expect(takeReturnRoute()).toBe('dashboard');
  });

  it('degrades silently when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => rememberReturnRoute('pace-curve')).not.toThrow();
    expect(takeReturnRoute()).toBe('dashboard');
  });
});
