import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../../api/index';

/**
 * Tests for README §5 — API & Webhook Specifications
 *
 * Endpoint: /api/webhook (POST)
 * 1. Receives an Activity ID
 * 2. Fetches the velocity stream from Intervals.icu
 * 3. Parses sprint metrics
 * 4. Pushes an NFI custom stream back via PUT
 */

// Helper to create mock req/res objects
function createMockReq(method: string, body: any = {}) {
  return { method, body };
}

function createMockRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    sentText: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    send(text: string) {
      res.sentText = text;
      return res;
    },
  };
  return res;
}

// Mock activity returned by Intervals.icu
const mockActivity = {
  id: 'act_001',
  type: 'Run',
  velocity_smooth: [0, 0.5, 2.0, 5.0, 8.0, 9.5, 9.8, 9.5, 3.0, 0.5, 0],
  max_speed: 9.8,
  icu_training_load: 74,
  icu_atl: 55,
  icu_ctl: 42,
};

const mockRecentActivities = [
  { id: 'act_002', type: 'Run', max_speed: 9.5 },
  { id: 'act_003', type: 'Run', max_speed: 9.7 },
  { id: 'act_004', type: 'Run', max_speed: 9.3 },
];

const mockIntervals = [
  { type: 'WORK', distance: 30, moving_time: 4, max_speed: 9.5, average_speed: 8.0 },
  { type: 'REST', distance: 5, moving_time: 60, max_speed: 1.0, average_speed: 0.5 },
  { type: 'WORK', distance: 60, moving_time: 7, max_speed: 9.8, average_speed: 8.6 },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Webhook handler — method validation (§5)', () => {
  it('rejects non-POST requests with 405', async () => {
    const req = createMockReq('GET');
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.sentText).toBe('Method Not Allowed');
  });

  it('rejects PUT requests with 405', async () => {
    const req = createMockReq('PUT');
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('Webhook handler — payload validation (§5)', () => {
  it('returns 400 when id is missing', async () => {
    const req = createMockReq('POST', { athleteId: 'i123', apiKey: 'key' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  it('returns 400 when athleteId is missing', async () => {
    const req = createMockReq('POST', { id: 'act_001', apiKey: 'key' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when apiKey is missing', async () => {
    const req = createMockReq('POST', { id: 'act_001', athleteId: 'i123' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('Webhook handler — full pipeline with mocked fetch (§5)', () => {
  it('fetches activity, parses metrics, calculates NFI, and pushes stream', async () => {
    // Track all fetch calls
    const fetchCalls: { url: string; method: string }[] = [];

    const mockFetch = vi.fn(async (url: string, opts?: any) => {
      fetchCalls.push({ url, method: opts?.method || 'GET' });

      // Intervals fetch (checked before activity to avoid ambiguity with the domain name)
      if (url.includes('/api/v1/activity/act_001/intervals')) {
        return {
          ok: true,
          json: async () => mockIntervals,
        };
      }

      // Activity fetch
      if (url.includes('/api/v1/activity/act_001') && !url.includes('/streams')) {
        return {
          ok: true,
          json: async () => mockActivity,
        };
      }

      // Streams fetch (GET)
      if (url.includes('/api/v1/activity/act_001/streams') && (!opts?.method || opts.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            velocity_smooth: { data: mockActivity.velocity_smooth },
          }),
        };
      }

      // Recent activities fetch
      if (url.includes('/activities')) {
        return {
          ok: true,
          json: async () => mockRecentActivities,
        };
      }

      // PUT stream (push NFI back)
      if (url.includes('/streams') && opts?.method === 'PUT') {
        return { ok: true, json: async () => ({}) };
      }

      return { ok: false, json: async () => ({}) };
    }) as any;

    vi.stubGlobal('fetch', mockFetch);

    const req = createMockReq('POST', {
      id: 'act_001',
      athleteId: 'i12345',
      apiKey: 'test_key',
    });
    const res = createMockRes();

    await handler(req, res);

    // Should succeed
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.activityId).toBe('act_001');

    // NFI should be calculated (9.8 / avg of [9.5, 9.7, 9.3])
    const expectedAvg = (9.5 + 9.7 + 9.3) / 3; // 9.5
    const expectedNFI = parseFloat((9.8 / expectedAvg).toFixed(3));
    expect(res.body.nfi).toBeCloseTo(expectedNFI, 2);

    // NFI status should be present
    expect(['green', 'amber', 'red']).toContain(res.body.nfiStatus);

    // Should have parsed intervals
    expect(typeof res.body.intervals).toBe('number');

    // Stream should have been pushed
    expect(res.body.streamPushed).toBe(true);

    // Verify the right API calls were made:
    // 1. GET activity, 2. GET streams, 3. GET intervals, 4. GET recent activities, 5. PUT streams
    const getMethods = fetchCalls.filter(c => c.method === 'GET');
    const putMethods = fetchCalls.filter(c => c.method === 'PUT');
    expect(getMethods.length).toBeGreaterThanOrEqual(4);
    expect(putMethods.length).toBe(1);

    // Intervals endpoint should have been called
    expect(getMethods.some(c => c.url.includes('/intervals'))).toBe(true);

    // PUT should target the streams endpoint
    expect(putMethods[0].url).toContain('/streams');

    vi.unstubAllGlobals();
  });

  it('returns 502 when Intervals.icu activity fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })));

    const req = createMockReq('POST', {
      id: 'act_bad',
      athleteId: 'i12345',
      apiKey: 'test_key',
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Failed to fetch/);

    vi.unstubAllGlobals();
  });

  it('returns 422 when activity data fails Zod validation', async () => {
    const invalidActivity = {
      id: 'act_invalid',
      type: 'Ride', // Not 'Run' — should fail literal check
      velocity_smooth: [1, 2, 3],
      max_speed: 5.0,
      icu_training_load: 50,
      icu_atl: 30,
      icu_ctl: 25,
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
      if (url.includes('/activity/') && !url.includes('/streams')) {
        return { ok: true, json: async () => invalidActivity };
      }
      if (url.includes('/streams')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    }));

    const req = createMockReq('POST', {
      id: 'act_invalid',
      athleteId: 'i12345',
      apiKey: 'test_key',
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/validation failed/i);

    vi.unstubAllGlobals();
  });

  it('uses correct auth header format (Basic with API_KEY prefix)', async () => {
    let capturedAuthHeader = '';

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
      if (opts?.headers?.Authorization) {
        capturedAuthHeader = opts.headers.Authorization;
      }
      if (url.includes('/activity/') && !url.includes('/streams')) {
        return { ok: true, json: async () => mockActivity };
      }
      if (url.includes('/streams') && (!opts?.method || opts.method === 'GET')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes('/activities')) {
        return { ok: true, json: async () => [] };
      }
      if (opts?.method === 'PUT') {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    }));

    const req = createMockReq('POST', {
      id: 'act_001',
      athleteId: 'i12345',
      apiKey: 'my_secret_key',
    });
    const res = createMockRes();
    await handler(req, res);

    // Auth header should be Basic + base64 of "API_KEY:<key>"
    expect(capturedAuthHeader).toMatch(/^Basic /);
    const decoded = Buffer.from(capturedAuthHeader.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('API_KEY:my_secret_key');

    vi.unstubAllGlobals();
  });

  it('uses API interval data when the /intervals endpoint returns valid intervals', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
      if (url.includes('/api/v1/activity/act_001/intervals')) {
        return { ok: true, json: async () => mockIntervals };
      }
      if (url.includes('/activity/act_001') && !url.includes('/streams')) {
        return { ok: true, json: async () => mockActivity };
      }
      if (url.includes('/streams') && (!opts?.method || opts.method === 'GET')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes('/activities')) {
        return { ok: true, json: async () => mockRecentActivities };
      }
      if (opts?.method === 'PUT') {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    }));

    const req = createMockReq('POST', { id: 'act_001', athleteId: 'i12345', apiKey: 'test_key' });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // mockIntervals has 2 WORK intervals (REST is filtered out) → intervals count = 2
    expect(res.body.intervals).toBe(2);

    vi.unstubAllGlobals();
  });

  it('falls back to velocity stream parsing when /intervals returns non-array', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
      if (url.includes('/api/v1/activity/act_001/intervals')) {
        return { ok: true, json: async () => ({ error: 'no intervals' }) };
      }
      if (url.includes('/activity/act_001') && !url.includes('/streams')) {
        return { ok: true, json: async () => mockActivity };
      }
      if (url.includes('/streams') && (!opts?.method || opts.method === 'GET')) {
        return { ok: true, json: async () => ({ velocity_smooth: { data: mockActivity.velocity_smooth } }) };
      }
      if (url.includes('/activities')) {
        return { ok: true, json: async () => mockRecentActivities };
      }
      if (opts?.method === 'PUT') {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    }));

    const req = createMockReq('POST', { id: 'act_001', athleteId: 'i12345', apiKey: 'test_key' });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Falls back to velocity stream parsing — should still report a number
    expect(typeof res.body.intervals).toBe('number');

    vi.unstubAllGlobals();
  });
});
