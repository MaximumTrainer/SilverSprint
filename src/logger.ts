type LogLevel = 'info' | 'warn' | 'error';

const isDev = import.meta.env.DEV;

/**
 * Client-side logger for authentication & API data flows.
 *
 * Development: browser console + relayed to server log file via POST /__client-log
 * Production:  errors logged to console (extend with remote sink if needed)
 *
 * All error-level logs include the athleteId when available.
 */
function format(level: LogLevel, message: string, athleteId?: string): string {
  const parts = [`[${new Date().toISOString()}]`, `[${level.toUpperCase()}]`];
  if (athleteId) parts.push(`[athlete:${athleteId}]`);
  parts.push(message);
  return parts.join(' ');
}

/** Fire-and-forget POST to the Vite dev server log relay. */
function relayToServer(level: LogLevel, message: string, athleteId?: string, data?: unknown): void {
  if (!isDev) return;
  try {
    const serializedData = data instanceof Error
      ? { message: data.message, stack: data.stack }
      : data;
    fetch('/__client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, athleteId, data: serializedData }),
    }).catch(() => { /* ignore relay failures */ });
  } catch { /* ignore */ }
}

export const clientLogger = {
  info(message: string, athleteId?: string, data?: unknown): void {
    if (isDev) {
      console.log(format('info', message, athleteId), data ?? '');
      relayToServer('info', message, athleteId, data);
    }
  },

  warn(message: string, athleteId?: string, data?: unknown): void {
    if (isDev) {
      console.warn(format('warn', message, athleteId), data ?? '');
      relayToServer('warn', message, athleteId, data);
    }
  },

  error(message: string, athleteId?: string, data?: unknown): void {
    console.error(format('error', message, athleteId), data ?? '');
    relayToServer('error', message, athleteId, data);
  },
};
