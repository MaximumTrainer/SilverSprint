/**
 * routing — base-relative screen resolution, without a router dependency.
 *
 * Two screens do not justify a routing library, but they do need one place
 * that knows how a path maps to a screen. This is that place, factored out of
 * `App.tsx` (which resolved `./callback` inline) so the pace curve screen can
 * use the same discipline.
 *
 * The rule is: **always resolve relative to the current document**, never
 * against the origin. The app is served from two different roots — `/` on
 * Vercel and `/SilverSprint/` on GitHub Pages, built with `--base <repo>/` —
 * and an origin-relative path silently breaks the second. Resolving `./x`
 * against `window.location.href` handles both, and also strips any query
 * string (e.g. an OAuth `?code=`) for free.
 *
 * Deep links work because of infrastructure that already exists:
 * `vercel.json` rewrites everything to `index.html`, and on GitHub Pages
 * `public/404.html` stores the requested path in `sessionStorage.ss_redirect`
 * for the inline script in `index.html` to restore with `history.replaceState`
 * before React mounts. By the time {@link resolveRoute} runs, the URL is the
 * one the athlete asked for.
 */

/** Every screen the app renders at its own path. */
export const APP_ROUTES = ['dashboard', 'callback', 'pace-curve'] as const;

export type AppRoute = (typeof APP_ROUTES)[number];

/** Path segment for the OAuth callback. Registered with Intervals.icu. */
export const CALLBACK_SEGMENT = 'callback';
/** Path segment for the sprint pace curve screen. */
export const PACE_CURVE_SEGMENT = 'pace-curve';

/** The segment each route is served at. The dashboard is the base itself. */
const ROUTE_SEGMENTS: Record<AppRoute, string> = {
  dashboard: '',
  callback: CALLBACK_SEGMENT,
  'pace-curve': PACE_CURVE_SEGMENT,
};

/** sessionStorage key holding the screen to land on after signing in. */
export const RETURN_ROUTE_KEY = 'ss_return_route';

/**
 * The deployment root for the page at `href`, always with a trailing slash.
 *
 * `/SilverSprint/pace-curve` → `/SilverSprint/`, `/pace-curve` → `/`.
 */
export function appBaseUrl(href: string): string {
  return new URL('./', href).toString();
}

/**
 * Which screen the URL asks for.
 *
 * Anything unrecognised is the dashboard, so a stale link or a typo lands
 * somewhere useful rather than on a blank page.
 */
export function resolveRoute(href: string): AppRoute {
  const { pathname } = new URL(href);
  // A trailing slash is stripped so `/pace-curve/` resolves like `/pace-curve`.
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const segment = trimmed.slice(trimmed.lastIndexOf('/') + 1);

  for (const route of APP_ROUTES) {
    if (route !== 'dashboard' && ROUTE_SEGMENTS[route] === segment) return route;
  }
  return 'dashboard';
}

/** The absolute URL of a screen, relative to the deployment `href` sits in. */
export function routeUrl(route: AppRoute, href: string): string {
  return new URL(`./${ROUTE_SEGMENTS[route]}`, href).toString();
}

/** True when the value is one of the app's routes. */
function isAppRoute(value: unknown): value is AppRoute {
  return typeof value === 'string' && (APP_ROUTES as readonly string[]).includes(value);
}

/** True when a usable sessionStorage is present (absent in SSR and some privacy modes). */
function hasSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Remember which screen to return to once the OAuth round trip completes.
 *
 * Signing in leaves the app entirely — Intervals.icu redirects to `./callback`
 * — so the requested screen has to survive outside the URL, or every athlete
 * who deep-links to the pace curve while signed out lands on the dashboard.
 */
export function rememberReturnRoute(route: AppRoute): void {
  if (!hasSessionStorage()) return;
  try {
    sessionStorage.setItem(RETURN_ROUTE_KEY, route);
  } catch {
    // Storage full or blocked: the athlete lands on the dashboard instead.
  }
}

/**
 * Read and clear the remembered screen.
 *
 * Nothing here is trusted: any script on the origin can write to
 * sessionStorage, so a value that is not one of this app's own routes is
 * discarded rather than used to build a URL. `callback` is rejected too — it
 * is a transient page, and returning to it would restart the exchange with a
 * code that has already been spent.
 */
export function takeReturnRoute(): AppRoute {
  if (!hasSessionStorage()) return 'dashboard';
  try {
    const stored = sessionStorage.getItem(RETURN_ROUTE_KEY);
    sessionStorage.removeItem(RETURN_ROUTE_KEY);
    return isAppRoute(stored) && stored !== 'callback' ? stored : 'dashboard';
  } catch {
    return 'dashboard';
  }
}
