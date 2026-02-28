/** Base URL for Intervals.icu API: direct in production, proxied in development */
export const INTERVALS_BASE = import.meta.env.PROD ? 'https://intervals.icu' : '/intervals';
