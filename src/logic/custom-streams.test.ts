import { describe, it, expect } from 'vitest';
import { IntervalsCustomStreams } from './custom-streams';

/**
 * Tests for README §5 — API & Webhook Specifications
 *
 * The NFI custom stream payload must be in the format expected
 * by the Intervals.icu PUT custom streams API.
 */
describe('IntervalsCustomStreams.generateNFIStreamPayload (§5)', () => {
  it('returns a valid stream payload with required fields', () => {
    const payload = IntervalsCustomStreams.generateNFIStreamPayload([0.98, 0.95, 1.0]);

    expect(payload).toHaveProperty('name');
    expect(payload).toHaveProperty('data');
    expect(payload.data).toEqual([0.98, 0.95, 1.0]);
  });

  it('includes NFI-related naming', () => {
    const payload = IntervalsCustomStreams.generateNFIStreamPayload([1.0]);
    expect(payload.name).toMatch(/Neural Fatigue Index|NFI/i);
    expect(payload.short_name).toBe('NFI');
  });

  it('handles empty data array', () => {
    const payload = IntervalsCustomStreams.generateNFIStreamPayload([]);
    expect(payload.data).toEqual([]);
  });
});
