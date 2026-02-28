import { SprintParser } from '../src/domain/sprint/parser';
import { SilverSprintLogic } from '../src/domain/sprint/core';
import { IntervalsCustomStreams } from '../src/domain/sprint/custom-streams';
import { IntervalsActivitySchema } from '../src/domain/schema';
import { logger } from './logger';
import { z } from 'zod';

/** Zod schema for webhook request body */
const WebhookBodySchema = z.object({
  id: z.string(),
  athleteId: z.string(),
  apiKey: z.string(),
});

interface ServerlessRequest {
  method: string;
  body: unknown;
}

interface ServerlessResponse {
  status(code: number): ServerlessResponse;
  send(body: string): void;
  json(body: unknown): void;
}

/**
 * §5 — Webhook Handler
 *
 * Endpoint: /api/webhook (POST)
 * 1. Receives an Activity ID
 * 2. Fetches the velocity stream from Intervals.icu
 * 3. Parses sprint metrics
 * 4. Pushes an NFI custom stream back via PUT
 */
export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  if (req.method !== 'POST') {
    logger.warn('Rejected non-POST request', undefined, { method: req.method });
    return res.status(405).send('Method Not Allowed');
  }

  const bodyResult = WebhookBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    logger.warn('Invalid webhook request body', undefined, bodyResult.error.issues);
    return res.status(400).json({ error: 'Missing required fields: id, athleteId, apiKey' });
  }

  const { id, athleteId, apiKey } = bodyResult.data;

  logger.info(`Webhook received for activity ${id}`, athleteId);

  try {
    const authHeader = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const headers = {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    };

    // 1. Fetch the activity with velocity stream
    logger.info(`Fetching activity ${id} from Intervals.icu`, athleteId);
    const activityRes = await fetch(
      `https://intervals.icu/api/v1/activity/${id}`,
      { headers }
    );

    if (!activityRes.ok) {
      logger.error(`Failed to fetch activity ${id} — HTTP ${activityRes.status}`, athleteId);
      return res.status(502).json({ error: 'Failed to fetch activity from Intervals.icu' });
    }

    const rawActivity = await activityRes.json();

    // 2. Fetch the velocity stream separately
    const streamRes = await fetch(
      `https://intervals.icu/api/v1/activity/${id}/streams`,
      { headers }
    );
    const streams = streamRes.ok ? await streamRes.json() : {};
    const velocitySmooth = streams.velocity_smooth?.data || rawActivity.velocity_smooth || [];

    const activity = {
      ...rawActivity,
      velocity_smooth: velocitySmooth,
    };

    // Validate with schema
    const parsed = IntervalsActivitySchema.safeParse(activity);
    if (!parsed.success) {
      logger.error(`Activity ${id} schema validation failed`, athleteId, parsed.error.issues);
      return res.status(422).json({ error: 'Activity data validation failed', details: parsed.error.issues });
    }

    // 3. Parse sprint metrics
    const intervals = SprintParser.parseTrackSession(parsed.data);
    const todayVmax = parsed.data.max_speed;

    // Fetch recent activities for 30-day baseline
    const recentRes = await fetch(
      `https://intervals.icu/api/v1/athlete/${athleteId}/activities?oldest=${getDateDaysAgo(30)}`,
      { headers }
    );
    const recentActivities: Array<{ type?: string; id?: string; max_speed?: number }> = recentRes.ok ? await recentRes.json() : [];
    const validVmaxes = recentActivities
      .filter((a) => a.type === 'Run' && a.id !== id && (a.max_speed ?? 0) > 0)
      .map((a) => a.max_speed!);

    const avgVmax = validVmaxes.length > 0
      ? validVmaxes.reduce((a, b) => a + b, 0) / validVmaxes.length
      : todayVmax;

    const nfi = SilverSprintLogic.calculateNFI(todayVmax, avgVmax);

    // 4. Push NFI custom stream back to Intervals.icu via PUT
    const nfiPayload = IntervalsCustomStreams.generateNFIStreamPayload(
      velocitySmooth.map(() => nfi) // NFI value for each second of the stream
    );

    const putRes = await fetch(
      `https://intervals.icu/api/v1/activity/${id}/streams`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify(nfiPayload),
      }
    );

    logger.info(`Webhook complete for activity ${id} — NFI=${nfi.toFixed(3)}, streamPushed=${putRes.ok}`, athleteId);

    return res.status(200).json({
      status: 'ok',
      activityId: id,
      nfi,
      nfiStatus: SilverSprintLogic.getNFIStatus(nfi),
      intervals: intervals.length,
      streamPushed: putRes.ok,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(`Webhook failed for activity ${id}: ${message}`, athleteId, { stack });
    return res.status(500).json({ error: 'Internal server error', message });
  }
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}